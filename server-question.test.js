import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from './server.js';

const token = 'question-route-test'.padEnd(32, 'x');
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const input = {
  kind: 'sustained',
  seed: 17,
  time: 96,
  question: 'Walk me through that chance',
  anchorId: 'comparison-sustained-17-shot-96',
};
const env = {
  APP_ACCESS_TOKEN: token,
  AZURE_OPENAI_ENDPOINT: 'https://mock.openai.azure.com',
  AZURE_OPENAI_DEPLOYMENT: 'test',
  AZURE_OPENAI_API_KEY: 'mock-only',
  MAX_DAILY_MODEL_CALLS: '3',
};
const draft = {
  scope: 'match',
  claims: [
    {
      text: 'Reed shot off target.',
      kind: 'observation',
      evidence: [{ type: 'event', id: input.anchorId, revision: 1 }],
    },
  ],
  followUp: '',
};
async function start(t, settings = env, answer = draft, review = { decision: 'approve' }) {
  let calls = 0;
  const requests = [];
  const server = createServer({
    env: settings,
    fetcher: async (_url, options) => {
      calls++;
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify(
                  calls % 3 === 1
                    ? { queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }] }
                    : calls % 3 === 2
                      ? answer
                      : {
                          requestCheck: {
                            requestedInformation: 'Mock question',
                            status: 'answered',
                            reason: 'Mock answer',
                            coverage: [
                              {
                                requestSpan: JSON.parse(options.body)
                                  .messages.map((m) => {
                                    try {
                                      return JSON.parse(m.content)?.evidence?.question;
                                    } catch {
                                      return null;
                                    }
                                  })
                                  .find(Boolean),
                                answerSpan: answer.claims[0].text,
                              },
                            ],
                          },
                          reason: 'Mock review',
                          checks: answer.claims.map((_, claimIndex) => ({
                            claimIndex,
                            actors: [],
                            inventedFacts: [],
                            counts: [],
                            shotOutcomeAssertions: ['bucket-count'],
                            supported: review.decision === 'approve',
                            reason: 'Mock scenario evidence',
                          })),
                          ...review,
                        },
                ),
              },
            },
          ],
          usage: { prompt_tokens: 123, completion_tokens: 30 },
        }),
      };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    base,
    calls: () => calls,
    requests,
    post: (path, body = input, requestHeaders = headers) =>
      fetch(base + path, {
        method: 'POST',
        headers: requestHeaders,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
  };
}

test('recorded question route needs no provider or credential and follows corrections', async (t) => {
  const s = await start(t, { APP_ACCESS_TOKEN: token });
  const plain = { 'Content-Type': 'application/json' },
    request = { ...input, question: 'How did this chance happen?' };
  const first = await s.post('/api/match/question', request, plain);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const old = await first.json();
  assert.equal(old.provenance.source, 'recorded-retrieval');
  assert.match(old.answer, /off target/);
  const revised = await (
    await s.post('/api/match/question', { ...request, time: 98 }, plain)
  ).json();
  assert.match(revised.answer, /saved/);
  assert.notEqual(revised.key, old.key);
  const unsupported = await (
    await s.post(
      '/api/match/question',
      { ...request, question: 'Predict the next World Cup winner' },
      plain,
    )
  ).json();
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(s.calls(), 0);
  for (const path of ['/match-questions.js', '/match-question-ai.js'])
    assert.equal((await fetch(s.base + path)).status, 404, 'Server evidence modules stay private');
});

test('Azure question route generates and separately reviews grounded prose after query planning in three bounded calls', async (t) => {
  const s = await start(t);
  const response = await s.post('/api/agent/question');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(s.calls(), 3);
  assert.equal(result.question, input.question);
  assert.equal(result.provenance.aiInterpreted, true);
  assert.equal(result.provenance.modelGenerated, true);
  assert.equal(result.execution.modelCalls, 3);
  assert.deepEqual(result.execution.usage, { promptTokens: 369, completionTokens: 90 });
  assert.ok(result.evidence.some((r) => r.id === input.anchorId && r.revision === 1));
  assert.equal(s.requests[0].max_completion_tokens, 900);
  assert.equal(s.requests[1].max_completion_tokens, 650);
  assert.equal(s.requests[2].max_completion_tokens, 530);
  const sent = JSON.parse(s.requests[1].messages.at(-1).content);
  assert.ok(
    sent.queryResults
      .flatMap((q) => q.rows)
      .every((e) => e.time <= input.time && e.arrivedAt <= input.time),
  );
  assert.ok(sent.queryResults.every((q) => q.scopeReference.type === 'scope'));
  assert.ok(!Object.hasOwn(sent, 'events'));
  assert.ok(!JSON.stringify(sent).includes('mock-only'));
  const reviewed = JSON.parse(s.requests[2].messages.at(-1).content);
  assert.match(reviewed.evidence.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(reviewed.evidence.queryResults.length < sent.queryResults.length);
  assert.equal(reviewed.evidence.relevanceContext.citable, false);
  assert.deepEqual(reviewed.answer, draft);
});

test('question routes enforce origin, authorization, content type and valid input before provider work', async (t) => {
  const s = await start(t);
  for (const path of ['/api/match/question', '/api/agent/question']) {
    assert.equal(
      (await s.post(path, input, { ...headers, Origin: 'https://untrusted.example' })).status,
      403,
    );
    assert.equal(
      (await s.post(path, input, { ...headers, 'Content-Type': 'text/plain' })).status,
      415,
    );
    for (const body of [
      '{',
      { ...input, question: '' },
      { ...input, question: 'x'.repeat(401) },
      { ...input, time: 121 },
      { ...input, unknown: true },
    ])
      assert.equal((await s.post(path, body)).status, 400);
  }
  assert.equal(
    (await s.post('/api/agent/question', input, { 'Content-Type': 'application/json' })).status,
    401,
  );
  assert.equal(
    (await s.post('/api/agent/question', input, { ...headers, Authorization: 'Bearer incorrect' }))
      .status,
    401,
  );
  assert.equal((await s.post('/api/agent/question', ' '.repeat(8193))).status, 413);
  assert.equal((await s.post('/api/match/question', ' '.repeat(262145))).status, 413);
  assert.equal(s.calls(), 0);
});

test('natural why questions reach both agents while withdrawn selections consume no allowance', async (t) => {
  const s = await start(t, env, {
    scope: 'match',
    claims: [
      {
        kind: 'limitation',
        text: 'We cannot establish why Cole chose not to pass from these events.',
        evidence: [],
      },
    ],
    followUp: '',
  });
  const response = await s.post('/api/agent/question', {
    ...input,
    question: 'Why did Cole not pass?',
  });
  assert.equal(response.status, 200);
  const causal = await response.json();
  assert.equal(causal.intent, 'open-conversation');
  assert.equal(causal.status, 'answered');
  assert.match(causal.answer, /cannot establish/);
  assert.equal(s.calls(), 3);
  const withdrawn = await s.post('/api/agent/question', {
    kind: 'withdrawal',
    seed: 17,
    time: 11,
    question: 'How did the goal happen?',
    anchorId: 'withdrawal-17-shot',
  });
  assert.equal(withdrawn.status, 200);
  assert.equal((await withdrawn.json()).status, 'no-results');
  assert.equal(s.calls(), 3);
});

test('budget exhaustion stops additional model transport while recorded answers remain available', async (t) => {
  const s = await start(t, { ...env, MAX_DAILY_MODEL_CALLS: '3' });
  assert.equal((await s.post('/api/agent/question')).status, 200);
  assert.equal(s.calls(), 3);
  const denied = await s.post('/api/agent/question');
  assert.equal(denied.status, 429);
  assert.match((await denied.json()).error, /Daily model-call limit/);
  assert.equal(s.calls(), 3);
  assert.equal(
    (await s.post('/api/match/question', { ...input, question: 'How did this chance happen?' }))
      .status,
    200,
  );
  assert.equal(
    (await s.post('/api/agent/question', { ...input, question: 'Who caused this?' })).status,
    429,
  );
  assert.equal(s.calls(), 3);
});

test('unreviewed draft is never returned when review is withheld or its allowance is exhausted', async (t) => {
  const withheld = await start(t, env, draft, { decision: 'withhold' });
  const response = await withheld.post('/api/agent/question');
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.ok(body.error);
  assert.ok(!Object.hasOwn(body, 'answer'));
  assert.ok(!JSON.stringify(body).includes(draft.claims[0].text));
  assert.equal(withheld.calls(), 3);
  const exhausted = await start(t, { ...env, MAX_DAILY_MODEL_CALLS: '2' });
  const denied = await exhausted.post('/api/agent/question');
  assert.equal(denied.status, 429);
  const error = await denied.json();
  assert.ok(!Object.hasOwn(error, 'answer'));
  assert.equal(exhausted.calls(), 0);
});

test('six-minute question context is bounded and omits positional sample payloads', async (t) => {
  const s = await start(t, env, {
    scope: 'match',
    claims: [
      { kind: 'limitation', text: 'These records cover a short synthetic segment.', evidence: [] },
    ],
    followUp: '',
  });
  const response = await s.post('/api/agent/question', {
    kind: 'extended',
    seed: 17,
    time: 362,
    question: 'Give me a quick summary',
  });
  assert.equal(response.status, 200);
  const packet = JSON.parse(s.requests[1].messages.at(-1).content),
    rows = packet.queryResults.flatMap((q) => q.rows);
  assert.ok(rows.length > 0 && rows.length <= 60);
  assert.ok(JSON.stringify(packet).length < 30000);
  assert.ok(!Object.hasOwn(packet, 'frames'));
  assert.ok(!Object.hasOwn(packet, 'events'));
  assert.ok(rows.every((e) => e.time <= 362 && e.arrivedAt <= 362 && !Object.hasOwn(e, 'players')));
  assert.equal(packet.observedAt, 362);
  assert.ok(packet.selectedAnchor);
  assert.ok(packet.linkedContext.rows.length <= 16);
  assert.ok(packet.linkedContext.rows.every((e) => e.time <= 362 && e.arrivedAt <= 362));
});
test('question availability preserves a remainder too small for all three model stages', async (t) => {
  const s = await start(t, { ...env, MAX_DAILY_MODEL_CALLS: '4' });
  const before = await (await fetch(s.base + '/api/ai/status')).json();
  assert.equal(before.questionAvailable, true);
  assert.equal((await s.post('/api/agent/question')).status, 200);
  const after = await (await fetch(s.base + '/api/ai/status')).json();
  assert.equal(after.available, true);
  assert.equal(after.questionAvailable, false);
  assert.equal(after.modelBudget.calls, 3);
  assert.equal((await s.post('/api/agent/question')).status, 429);
  assert.equal(s.calls(), 3);
});

test('a slow authorized upload does not hold the model generation slot', async (t) => {
  const s = await start(t);
  const received = once(s.server, 'request');
  const slow = http.request(
    s.base + '/api/agent/question',
    { method: 'POST', headers },
    (response) => response.resume(),
  );
  slow.on('error', () => {});
  t.after(() => slow.destroy());
  slow.write('{');
  await received;
  const response = await s.post('/api/agent/question');
  assert.equal(response.status, 200);
  assert.equal(s.calls(), 3);
  slow.end();
});
