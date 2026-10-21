import { createHash, randomBytes } from 'node:crypto';
import { authorized } from './server-settings.js';
import { GenerationError } from './ai.js';

const unavailable = () =>
  new GenerationError('Shared runtime storage is unavailable.', 503, 'shared-storage-unavailable');
const reservation = `local v=redis.call('GET',KEYS[1]); local n=tonumber(v or '0'); if not n or n<0 or n%1~=0 then return -2 end; if n>=tonumber(ARGV[1]) then return -1 end; n=redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],172800); return n`;
const sessionIssue = `local pairs=redis.call('HGETALL',KEYS[1]); local oldest=nil; local oldestTime=nil; local count=0; for i=1,#pairs,2 do local expiry=tonumber(pairs[i+1]); if not expiry or expiry<=tonumber(ARGV[1]) then redis.call('HDEL',KEYS[1],pairs[i]); else count=count+1; if not oldestTime or expiry<oldestTime then oldest=pairs[i]; oldestTime=expiry end end end; if redis.call('HEXISTS',KEYS[1],ARGV[2])==1 then return 0 end; if count>=16 then redis.call('HDEL',KEYS[1],oldest) end; redis.call('HSET',KEYS[1],ARGV[2],ARGV[3]); redis.call('EXPIRE',KEYS[1],3600); return 1`;

/** REST commands are server-created arrays; client input never supplies Redis
 * commands or scripts. A failed reservation never starts an Azure request. */
export function createSharedRuntimeStore({
  url,
  token,
  namespace = 'infinite-stadium',
  fetcher = fetch,
  clock = () => new Date(),
  random = randomBytes,
} = {}) {
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw unavailable();
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    typeof token !== 'string' ||
    token.length < 16 ||
    !/^[-a-zA-Z0-9_:]{1,80}$/.test(namespace)
  )
    throw unavailable();
  const command = async (parts) => {
    try {
      const response = await fetcher(endpoint.href, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parts),
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json();
      if (!response.ok || !data || data.error || !Object.hasOwn(data, 'result'))
        throw unavailable();
      return data.result;
    } catch {
      throw unavailable();
    }
  };
  const today = () => {
    const date = clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw unavailable();
    return date.toISOString().slice(0, 10);
  };
  const readCount = (value) => {
    if (value === null) return 0;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    if (
      typeof value === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      Number.isSafeInteger(Number(value))
    )
      return Number(value);
    throw unavailable();
  };
  return {
    budget(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw unavailable();
      return {
        durable: true,
        kind: 'shared-redis',
        async snapshot() {
          const day = today(),
            calls = readCount(await command(['GET', `${namespace}:budget:${day}`]));
          return { day, calls, limit };
        },
        async take() {
          const value = await command([
            'EVAL',
            reservation,
            '1',
            `${namespace}:budget:${today()}`,
            String(limit),
          ]);
          if (value === -1) throw new GenerationError('Daily model-call limit reached.', 429);
          if (!Number.isSafeInteger(value) || value < 1 || value > limit) throw unavailable();
          return value;
        },
      };
    },
    access({ token: accessToken, origins = [], publicHost = true }) {
      if (typeof accessToken !== 'string' || accessToken.length < 32) throw unavailable();
      const scope = createHash('sha256').update(accessToken).digest('hex'),
        key = `${namespace}:sessions:${scope}`;
      const originAllowed = (req) => {
        if (req.headers?.origin !== undefined && !origins.includes(req.headers.origin))
          throw new GenerationError('Access request origin is not allowed.', 403);
      };
      const cookieId = (req) => {
        const value = req.headers?.cookie;
        if (typeof value !== 'string' || value.length > 4096) return null;
        const parts = value
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p.split('=')[0] === 'stadium_session');
        return parts.length === 1 && /^stadium_session=[a-f0-9]{64}$/.test(parts[0])
          ? parts[0].slice(16)
          : null;
      };
      const cookie = (res, id, age) =>
        res.setHeader(
          'Set-Cookie',
          `stadium_session=${id}; Max-Age=${age}; Path=/api; HttpOnly; SameSite=Strict${publicHost ? '; Secure' : ''}`,
        );
      const now = () => {
        const date = clock();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw unavailable();
        return date.getTime();
      };
      const isAuthorized = async (req) => {
        if (authorized(req.headers?.authorization, accessToken)) return true;
        const id = cookieId(req);
        if (!id) return false;
        const value = await command(['HGET', key, id]);
        if (value === null) return false;
        const expiry = Number(value);
        if (!Number.isSafeInteger(expiry)) throw unavailable();
        return expiry > now();
      };
      return {
        isAuthorized,
        status: isAuthorized,
        async authenticate(req, res) {
          originAllowed(req);
          if (!authorized(req.headers?.authorization, accessToken))
            throw new GenerationError('Invalid access credential.', 401);
          for (let attempt = 0; attempt < 4; attempt++) {
            const bytes = random(32);
            if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) throw unavailable();
            const id = Buffer.from(bytes).toString('hex'),
              time = now();
            const created = await command([
              'EVAL',
              sessionIssue,
              '1',
              key,
              String(time),
              id,
              String(time + 3600000),
            ]);
            if (created === 1) {
              cookie(res, id, 3600);
              return true;
            }
            if (created !== 0) throw unavailable();
          }
          throw unavailable();
        },
        async clear(req, res) {
          originAllowed(req);
          const id = cookieId(req);
          if (id) await command(['HDEL', key, id]);
          cookie(res, '', 0);
          return true;
        },
      };
    },
  };
}
