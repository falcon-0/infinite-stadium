import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from './server.js';
import { recapViewKey } from './recap-view.js';

const token = 'recap-test-access-'.padEnd(32, 'x');
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const preferences = {
  kind: 'extended',
  seed: 2039,
  audience: 'analyst',
  language: 'en',
  favoriteClub: null,
  favoritePlayer: null,
};
const input = { ...preferences, source: 'integrated-match', time: 362 };
const genericError =
  'Recap is unavailable or superseded. Create a current canonical recap before exporting.';

async function start(t, options = {}) {
  const server = createServer({
    env: {
      APP_ACCESS_TOKEN: token,
      AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'test',
      AZURE_OPENAI_API_KEY: 'test',
      MAX_DAILY_MODEL_CALLS: '4',
    },
    ...options,
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
  return `http://127.0.0.1:${server.address().port}`;
}
function transport() {
  let calls = 0;
  return {
    count: () => calls,
    fetcher: async (_url, options) => {
      calls++;
      const request = JSON.parse(options.body),
        packet = JSON.parse(request.messages.at(-1).content);
      let raw;
      if (calls % 2 === 1) {
        assert.equal(request.response_format.type, 'json_schema');
        const fields = Object.keys(request.response_format.json_schema.schema.properties).filter(
          (field) => field !== 'overviewFactId',
        );
        raw = {
          overviewFactId: packet.catalog.facts[0].id,
          ...Object.fromEntries(fields.map((field) => [field, null])),
        };
        if (packet.requiredFactIds.length) raw[fields.at(-1)] = packet.requiredFactIds[0];
        if (packet.audience === 'analyst') {
          raw.context1 = packet.catalog.facts.find(
            (f) => f.kind === 'recap-team-shots' && f.values.team === 'away',
          ).id;
          raw.context2 = packet.catalog.facts.find(
            (f) => f.kind === 'recap-team-passes' && f.values.team === 'home',
          ).id;
        }
      } else
        raw = {
          decision: 'approve',
          issues: [],
          suggestions: ['This editorial suggestion is unverified and must not enter the rundown.'],
        };
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    },
  };
}
async function canonical(base, settings = input) {
  const generated = await fetch(`${base}/api/agent/recap`, {
    method: 'POST',
    headers,
    body: JSON.stringify(settings),
  });
  assert.equal(generated.status, 200);
  const draft = await generated.json();
  assert.equal(draft.status, 'draft');
  const profile = {
    kind: settings.kind,
    seed: settings.seed,
    audience: settings.audience,
    language: settings.language,
    favoriteClub: settings.favoriteClub ?? null,
    favoritePlayer: settings.favoritePlayer ?? null,
  };
  const match = await (
    await fetch(
      `${base}/api/match?${new URLSearchParams({ kind: settings.kind, seed: settings.seed, time: settings.time })}`,
    )
  ).json();
  return {
    draft,
    time: settings.time,
    preferences: profile,
    requestKey: recapViewKey(match.state.events, settings.time, profile),
  };
}
const exportRequest = (base, body, extra = {}) =>
  fetch(`${base}/api/studio/recap-cue`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...extra,
  });

test('HTTP recap export preserves a canonical received rundown and consumes no further model budget', async (t) => {
  const mock = transport(),
    base = await start(t, { fetcher: mock.fetcher }),
    payload = await canonical(base);
  assert.equal(mock.count(), 2);
  assert.equal(payload.draft.reviewSuggestions.length, 1);
  const before = (await (await fetch(`${base}/api/ai/status`, { headers })).json()).modelBudget;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await exportRequest(base, payload);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const cue = await response.json();
    assert.equal(cue.schema, 'infinite-stadium.recap-cue.v1');
    assert.equal(cue.status, 'human-review-required');
    assert.equal(cue.synthetic, true);
    assert.equal(cue.scope.observedAt, 362);
    assert.equal(cue.scope.fixture.seed, 2039);
    assert.equal(cue.overview.home, 2);
    assert.equal(cue.overview.away, 1);
    assert.equal(cue.overview.eventCount, 50);
    assert.equal(cue.dependencies.length, 50);
    assert.equal(cue.evidence.length, 50);
    assert.deepEqual(
      cue.segments.map((segment) => segment.text),
      payload.draft.claims.map((claim) => claim.text),
    );
    assert.deepEqual(
      cue.segments.map((segment) => segment.evidence),
      payload.draft.claims.map((claim) => claim.evidence),
    );
    assert.deepEqual(
      cue.segments.map((segment) => segment.order),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      cue.segments.map((segment) => segment.timing.startOffsetSeconds),
      [0, 6, 12, 18],
    );
    assert.equal(cue.timing.durationSeconds, 24);
    assert.equal(cue.timing.livePublishing, false);
    assert.equal(cue.timing.synchronization, 'reviewed-rundown-relative');
    assert.equal(cue.segments[0].eventTime, null);
    assert.deepEqual(cue.segments[0].eventWindow, { start: 0, end: 362, inclusive: true });
    assert.equal(cue.segments.at(-1).eventTime, 328);
    assert.equal(cue.segments.at(-1).eventWindow, null);
    assert.ok(!Object.hasOwn(cue, 'execution'));
    assert.ok(!Object.hasOwn(cue, 'trace'));
    assert.ok(!Object.hasOwn(cue, 'reviewSuggestions'));
    assert.doesNotMatch(
      JSON.stringify(cue),
      /This editorial suggestion|recap-test-access|AZURE_OPENAI_API_KEY/,
    );
  }
  assert.equal(mock.count(), 2);
  assert.deepEqual(
    (await (await fetch(`${base}/api/ai/status`, { headers })).json()).modelBudget,
    before,
  );
});

test('recap export route enforces access, origin, content type and bounded UTF-8 body before reconstruction', async (t) => {
  let calls = 0;
  const base = await start(t, {
    fetcher: () => {
      calls++;
      throw new Error('No model calls permitted.');
    },
  });
  assert.equal(
    (await exportRequest(base, {}, { headers: { 'Content-Type': 'application/json' } })).status,
    401,
  );
  assert.equal(
    (
      await exportRequest(
        base,
        {},
        { headers: { ...headers, Origin: 'https://untrusted.example' } },
      )
    ).status,
    403,
  );
  assert.equal(
    (await exportRequest(base, {}, { headers: { ...headers, 'Content-Type': 'text/plain' } }))
      .status,
    415,
  );
  const oversized = await fetch(`${base}/api/studio/recap-cue`, {
    method: 'POST',
    headers,
    body: ' '.repeat(131073),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'Request is too large.' });
  const multibyte = await fetch(`${base}/api/studio/recap-cue`, {
    method: 'POST',
    headers,
    body: 'é'.repeat(65537),
  });
  assert.equal(multibyte.status, 413);
  for (const body of [
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ draft: {}, time: 362, preferences, requestKey: 'x', extra: true }),
    JSON.stringify({ draft: {}, time: 362, preferences, requestKey: 'x'.repeat(4097) }),
  ]) {
    const response = await fetch(`${base}/api/studio/recap-cue`, { method: 'POST', headers, body });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test('tampered prose, facts, scope, time and preferences cannot export as a current canonical rundown', async (t) => {
  const mock = transport(),
    base = await start(t, { fetcher: mock.fetcher }),
    valid = await canonical(base);
  for (const change of [
    (body) => {
      body.draft.claims[0].text = 'A fabricated real match winner.';
    },
    (body) => {
      body.draft.claims[0].evidence.pop();
    },
    (body) => {
      body.draft.selectedFacts[0].values.home = 99;
    },
    (body) => {
      body.draft.dependencies.pop();
    },
    (body) => {
      body.draft.scope.observedAt = 360;
    },
    (body) => {
      body.time = 359;
    },
    (body) => {
      body.preferences.language = 'fr';
    },
    (body) => {
      body.preferences.favoriteClub = 'away';
    },
    (body) => {
      body.preferences.seed = 2040;
    },
    (body) => {
      body.draft.status = 'withheld';
    },
    (body) => {
      body.draft.source = 'azure-ai';
      body.draft.authorship.wording = 'model-prose';
    },
  ]) {
    const payload = structuredClone(valid);
    change(payload);
    const response = await exportRequest(base, payload);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: genericError });
  }
  assert.equal(mock.count(), 2, 'Invalid exports must not invoke a model or repair workflow.');
});

test('a provider-withdrawn synthetic goal invalidates its earlier recap at the export boundary', async (t) => {
  const mock = transport(),
    base = await start(t, { fetcher: mock.fetcher });
  const payload = await canonical(base, {
    source: 'integrated-match',
    kind: 'withdrawal',
    seed: 17,
    time: 10,
    audience: 'newcomer',
    language: 'en',
  });
  const before = await exportRequest(base, payload);
  assert.equal(before.status, 200);
  assert.equal((await before.json()).overview.home, 1);
  const withdrawn = { ...payload, time: 11 };
  const response = await exportRequest(base, withdrawn);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: genericError });
  assert.equal(mock.count(), 2);
});
