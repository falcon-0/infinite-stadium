import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createVercelHandler } from './vercel-handler.js';
import { memoryRedis } from './shared-runtime-fixture.js';
const env = {
  APP_ACCESS_TOKEN: 'private-test-access-token-32-chars-plus',
  VERCEL_URL: 'preview.example',
  VERCEL_PROJECT_PRODUCTION_URL: 'stadium.example',
  MAX_DAILY_MODEL_CALLS: '5',
  AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
  AZURE_OPENAI_DEPLOYMENT: 'test',
  AZURE_OPENAI_API_KEY: 'fake-test-key',
};
async function start(t, handler, parsed = false) {
  const server = http.createServer(async (req, res) => {
    if (parsed && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      req.body = JSON.parse(body);
    }
    return handler(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('serverless routes serve the watch page but expose no private files and require durable storage for AI', async (t) => {
  let calls = 0;
  const base = await start(
    t,
    createVercelHandler({
      env,
      fetcher: async () => {
        calls++;
        throw new Error('No provider call expected');
      },
    }),
  );
  assert.equal((await fetch(base + '/')).status, 200);
  for (const path of [
    '/.env.azure',
    '/shared-runtime-store.js',
    '/.runtime/azure-model-budget.json',
  ])
    assert.equal((await fetch(base + path)).status, 404);
  const status = await fetch(base + '/api/ai/status').then((r) => r.json());
  assert.equal(status.configured, true);
  assert.equal(status.available, false);
  const access = await fetch(base + '/api/access', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.APP_ACCESS_TOKEN}`, Origin: 'https://stadium.example' },
  });
  assert.equal(access.status, 503);
  assert.equal(calls, 0);
});

test('two serverless instances accept shared cookies, trusted aliases and already-parsed bodies', async (t) => {
  const redis = memoryRedis(),
    runtime = {
      ...env,
      APP_ACCESS_CODE: 'TESTER',
      UPSTASH_REDIS_REST_URL: 'https://test-redis.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-only-storage-token',
    };
  const a = await start(t, createVercelHandler({ env: runtime, storeFetcher: redis.fetcher })),
    b = await start(t, createVercelHandler({ env: runtime, storeFetcher: redis.fetcher }), true);
  const wrong = await fetch(a + '/api/access', {
    method: 'POST',
    headers: { Authorization: 'Bearer WRONG!', Origin: 'https://preview.example' },
  });
  assert.equal(wrong.status, 401);
  const login = await fetch(a + '/api/access', {
    method: 'POST',
    headers: { Authorization: 'Bearer TESTER', Origin: 'https://preview.example' },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const status = await fetch(b + '/api/ai/status', { headers: { Cookie: cookie } }).then((r) =>
    r.json(),
  );
  assert.equal(status.authRequired, false);
  assert.equal(status.available, true);
  const response = await fetch(b + '/api/agent/question', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'https://stadium.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind: 'sustained', seed: 17, time: 0, question: 'j' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).execution.modelCalls, 0);
  const logout = await fetch(b + '/api/access', {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: 'https://stadium.example' },
  });
  assert.equal(logout.status, 200);
  const revoked = await fetch(a + '/api/ai/status', { headers: { Cookie: cookie } }).then((r) =>
    r.json(),
  );
  assert.equal(revoked.authRequired, true);
});
