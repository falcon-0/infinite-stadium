import { randomBytes } from 'node:crypto';
import { authorized } from './server-settings.js';
import { GenerationError } from './ai.js';

const COOKIE = 'stadium_session',
  TTL = 3600000,
  MAXIMUM = 16;

/** Process-local, bounded access sessions. No credentials are stored in cookies.
 * Restarting the server invalidates sessions; bearer access remains supported.
 */
export function createAccessSessions(
  { token = null, publicHost = false, origins = [] },
  { clock = Date.now, random = randomBytes } = {},
) {
  const sessions = new Map();
  const now = () => Number(clock());
  const prune = () => {
    const time = now();
    for (const [id, expiresAt] of sessions) if (expiresAt <= time) sessions.delete(id);
  };
  const originAllowed = (req) => {
    const origin = req?.headers?.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !origins.includes(origin)))
      throw new GenerationError('Access request origin is not allowed.', 403);
  };
  const cookieId = (req) => {
    const header = req?.headers?.cookie;
    if (typeof header !== 'string' || header.length > 4096) return null;
    const parts = header.split(';');
    if (parts.length > 64) return null;
    let id = null,
      count = 0;
    for (const part of parts) {
      const item = part.trim(),
        separator = item.indexOf('=');
      if (separator < 0) {
        if (item === COOKIE) {
          count++;
          id = null;
        }
        continue;
      }
      if (item.slice(0, separator).trim() !== COOKIE) continue;
      count++;
      id = item.slice(separator + 1);
    }
    return count === 1 && /^[a-f0-9]{64}$/.test(id) ? id : null;
  };
  const setCookie = (res, id, maxAge) => {
    const value = `${COOKIE}=${id}; Max-Age=${maxAge}; Path=/api; HttpOnly; SameSite=Strict${publicHost ? '; Secure' : ''}`;
    const previous = res.getHeader?.('Set-Cookie');
    res.setHeader(
      'Set-Cookie',
      previous === undefined
        ? value
        : [...(Array.isArray(previous) ? previous : [previous]), value],
    );
  };
  const isAuthorized = (req) => {
    if (authorized(req?.headers?.authorization, token)) return true;
    prune();
    const id = cookieId(req);
    return id !== null && sessions.has(id);
  };
  return {
    authenticate(req, res) {
      originAllowed(req);
      if (!authorized(req?.headers?.authorization, token))
        throw new GenerationError('Invalid access credential.', 401);
      if (!token) return true;
      prune();
      let id = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const bytes = random(32);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32)
          throw new GenerationError('Could not create an access session.', 503);
        const candidate = Buffer.from(bytes).toString('hex');
        if (!sessions.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (!id) throw new GenerationError('Could not create a unique access session.', 503);
      while (sessions.size >= MAXIMUM) sessions.delete(sessions.keys().next().value);
      sessions.set(id, now() + TTL);
      setCookie(res, id, 3600);
      return true;
    },
    isAuthorized,
    clear(req, res) {
      originAllowed(req);
      prune();
      const id = cookieId(req);
      if (id !== null) sessions.delete(id);
      setCookie(res, '', 0);
      return true;
    },
    status: isAuthorized,
  };
}
