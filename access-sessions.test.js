import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessSessions } from './access-sessions.js';

const token = 'private-test-access-credential-'.repeat(2),
  origin = 'https://stadium.example';
const request = (headers) => ({ headers });
const bearer = () => request({ authorization: `Bearer ${token}`, origin });
function response() {
  const headers = new Map();
  return {
    setHeader: (key, value) => headers.set(key, value),
    getHeader: (key) => headers.get(key),
  };
}
const cookie = (res) => res.getHeader('Set-Cookie').split(';')[0];
function setup(publicHost = true) {
  let time = 1000,
    counter = 0;
  const sessions = createAccessSessions(
    { token, publicHost, origins: [origin] },
    { clock: () => time, random: (size) => Buffer.alloc(size, ++counter) },
  );
  return {
    sessions,
    setTime: (value) => {
      time = value;
    },
  };
}

test('authentication creates only an opaque scoped HttpOnly cookie and retains bearer access', () => {
  const { sessions } = setup(),
    res = response();
  assert.equal(sessions.authenticate(bearer(), res), true);
  assert.match(
    res.getHeader('Set-Cookie'),
    /^stadium_session=[a-f0-9]{64}; Max-Age=3600; Path=\/api; HttpOnly; SameSite=Strict; Secure$/,
  );
  assert.ok(!res.getHeader('Set-Cookie').includes(token));
  assert.equal(sessions.isAuthorized(request({ cookie: cookie(res) })), true);
  assert.equal(sessions.status(request({ cookie: cookie(res) })), true);
  assert.equal(sessions.isAuthorized(bearer()), true);
  assert.equal(sessions.isAuthorized(request({})), false);
  const local = setup(false),
    localRes = response();
  local.sessions.authenticate(bearer(), localRes);
  assert.doesNotMatch(localRes.getHeader('Set-Cookie'), /Secure/);
});

test('sessions expire at exactly one hour and reads never extend the lifetime', () => {
  const { sessions, setTime } = setup(),
    res = response();
  sessions.authenticate(bearer(), res);
  const req = request({ cookie: cookie(res) });
  setTime(3600999);
  assert.equal(sessions.isAuthorized(req), true);
  setTime(3601000);
  assert.equal(sessions.isAuthorized(req), false);
  assert.equal(sessions.status(req), false);
});

test('authentication rejects bad credentials and origins without issuing cookies', () => {
  const { sessions } = setup();
  for (const header of [undefined, 'Bearer wrong', `Basic ${token}`, ['Bearer ' + token]]) {
    const res = response();
    assert.throws(
      () => sessions.authenticate(request({ authorization: header, origin }), res),
      (error) => error.status === 401,
    );
    assert.equal(res.getHeader('Set-Cookie'), undefined);
  }
  for (const bad of ['https://attacker.example', 'null', [origin]]) {
    const res = response();
    assert.throws(
      () => sessions.authenticate(request({ authorization: `Bearer ${token}`, origin: bad }), res),
      (error) => error.status === 403,
    );
    assert.equal(res.getHeader('Set-Cookie'), undefined);
    assert.throws(
      () => sessions.clear(request({ origin: bad }), res),
      (error) => error.status === 403,
    );
  }
  const cli = response();
  assert.equal(sessions.authenticate(request({ authorization: `Bearer ${token}` }), cli), true);
});

test('logout invalidates the cookie session without revoking the configured bearer credential', () => {
  const { sessions } = setup(),
    res = response();
  sessions.authenticate(bearer(), res);
  const req = request({ cookie: cookie(res), origin });
  const logout = response();
  assert.equal(sessions.clear(req, logout), true);
  assert.equal(sessions.isAuthorized(req), false);
  assert.equal(sessions.isAuthorized(bearer()), true);
  assert.equal(
    logout.getHeader('Set-Cookie'),
    'stadium_session=; Max-Age=0; Path=/api; HttpOnly; SameSite=Strict; Secure',
  );
});

test('the seventeenth session evicts the oldest without growing unbounded or refreshing earlier sessions', () => {
  const { sessions } = setup(),
    cookies = [];
  for (let i = 0; i < 17; i++) {
    const res = response();
    sessions.authenticate(bearer(), res);
    cookies.push(cookie(res));
  }
  assert.equal(sessions.isAuthorized(request({ cookie: cookies[0] })), false);
  assert.ok(cookies.slice(1).every((value) => sessions.isAuthorized(request({ cookie: value }))));
  assert.equal(new Set(cookies).size, 17);
});

test('duplicate, malformed, oversized and fabricated cookies fail closed without evaluating input', () => {
  const { sessions } = setup(),
    res = response();
  sessions.authenticate(bearer(), res);
  const valid = cookie(res);
  for (const value of [
    valid + '; ' + valid,
    valid + '; stadium_session=wrong',
    valid + '; stadium_session',
    'stadium_session=wrong',
    valid + '=extra',
    'stadium_session=' + 'f'.repeat(64),
    valid + '; padding=' + 'x'.repeat(4096),
    valid + '; ' + Array(65).fill('a=b').join('; '),
    ['' + valid],
  ])
    assert.equal(sessions.isAuthorized(request({ cookie: value })), false);
  assert.equal(sessions.isAuthorized(request({ cookie: 'unrelated=hello; ' + valid })), true);
  assert.equal(
    sessions.isAuthorized(request({ cookie: 'stadium_session=' + 'A'.repeat(64) })),
    false,
  );
});

test('tokenless deployment needs no session and cross-origin mutation checks still apply', () => {
  const sessions = createAccessSessions({ token: null, publicHost: false, origins: [origin] }),
    res = response();
  assert.equal(sessions.isAuthorized(request({})), true);
  assert.equal(sessions.status(request({})), true);
  assert.equal(sessions.authenticate(request({ origin }), res), true);
  assert.equal(res.getHeader('Set-Cookie'), undefined);
  assert.throws(
    () => sessions.authenticate(request({ origin: 'https://attacker.example' }), res),
    (error) => error.status === 403,
  );
});

test('session randomness is bounded and an invalid or colliding generator cannot replace an existing session', () => {
  const fixed = Buffer.alloc(32, 1),
    sessions = createAccessSessions({ token, origins: [origin] }, { random: () => fixed });
  const first = response();
  sessions.authenticate(bearer(), first);
  assert.throws(
    () => sessions.authenticate(bearer(), response()),
    (error) => error.status === 503,
  );
  assert.equal(sessions.isAuthorized(request({ cookie: cookie(first) })), true);
  const invalid = createAccessSessions(
    { token, origins: [origin] },
    { random: () => Buffer.alloc(1) },
  );
  assert.throws(
    () => invalid.authenticate(bearer(), response()),
    (error) => error.status === 503,
  );
});
