import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedRuntimeStore } from './shared-runtime-store.js';

import { memoryRedis } from './shared-runtime-fixture.js';

const options = {
  url: 'https://test-redis.upstash.io',
  token: 'test-only-storage-token',
  namespace: 'test-stadium',
};

test('two independent instances share one atomic allowance and fail closed on storage loss', async () => {
  const redis = memoryRedis(),
    a = createSharedRuntimeStore({ ...options, fetcher: redis.fetcher }).budget(3),
    b = createSharedRuntimeStore({ ...options, fetcher: redis.fetcher }).budget(3);
  const results = await Promise.allSettled([a.take(), b.take(), a.take(), b.take(), a.take()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 429));
  assert.equal((await b.snapshot()).calls, 3);
  redis.setOutage(true);
  await assert.rejects(a.take(), (e) => e.status === 503);
  await assert.rejects(a.snapshot(), (e) => e.status === 503);
});

test('shared sessions survive instance changes, revoke globally and separate rotated credentials', async () => {
  const redis = memoryRedis();
  let now = new Date('2026-10-16T12:00:00Z');
  const store = () =>
      createSharedRuntimeStore({ ...options, fetcher: redis.fetcher, clock: () => now }),
    settings = {
      token: 'private-test-access-token-32-chars-plus',
      origins: ['https://stadium.example'],
      publicHost: true,
    };
  const a = store().access(settings),
    b = store().access(settings),
    headers = { origin: 'https://stadium.example', authorization: `Bearer ${settings.token}` };
  let cookie;
  await a.authenticate(
    { headers },
    {
      setHeader: (_name, value) => {
        cookie = value;
      },
    },
  );
  assert.match(cookie, /HttpOnly; SameSite=Strict; Secure/);
  assert.ok(!cookie.includes(settings.token));
  const request = { headers: { origin: headers.origin, cookie: cookie.split(';')[0] } };
  assert.equal(await b.isAuthorized(request), true);
  assert.equal(
    await store()
      .access({ ...settings, token: settings.token + 'rotated' })
      .isAuthorized(request),
    false,
  );
  await b.clear(request, { setHeader() {} });
  assert.equal(await a.isAuthorized(request), false);
  await a.authenticate(
    { headers },
    {
      setHeader: (_name, value) => {
        cookie = value;
      },
    },
  );
  now = new Date('2026-10-16T13:00:01Z');
  assert.equal(await b.isAuthorized({ headers: { cookie: cookie.split(';')[0] } }), false);
  await assert.rejects(
    a.authenticate(
      { headers: { ...headers, origin: 'https://attacker.example' } },
      { setHeader() {} },
    ),
    (e) => e.status === 403,
  );
});

test('shared allowance separates UTC days and rejects corrupt counters and unsafe endpoints', async () => {
  const redis = memoryRedis();
  let now = new Date('2026-10-16T23:59:59Z');
  const b = createSharedRuntimeStore({
    ...options,
    fetcher: redis.fetcher,
    clock: () => now,
  }).budget(1);
  await b.take();
  now = new Date('2026-10-17T00:00:00Z');
  assert.equal((await b.snapshot()).calls, 0);
  await b.take();
  redis.values.set('test-stadium:budget:2026-10-17', 'corrupt');
  await assert.rejects(b.take(), (e) => e.status === 503);
  for (const url of [
    'http://test.example',
    'https://user:password@test.example',
    'https://test.example/private',
  ])
    assert.throws(() => createSharedRuntimeStore({ ...options, url }));
});
