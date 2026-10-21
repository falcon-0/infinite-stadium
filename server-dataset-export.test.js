import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from './server.js';

const token = 'dataset-test-access-'.padEnd(32, 'x');
const headers = { Authorization: `Bearer ${token}` };
async function start(t) {
  let providerCalls = 0;
  const server = createServer({
    env: {
      APP_ACCESS_TOKEN: token,
      AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'test',
      AZURE_OPENAI_API_KEY: 'test',
      MAX_DAILY_MODEL_CALLS: '4',
    },
    fetcher: async () => {
      providerCalls++;
      throw new Error('Dataset export must not call a model.');
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
  return { base: `http://127.0.0.1:${server.address().port}`, calls: () => providerCalls };
}
const budget = async (base) =>
  (await (await fetch(`${base}/api/ai/status`, { headers })).json()).modelBudget;
async function dataset(base, query = '') {
  const response = await fetch(`${base}/api/data/synthetic${query}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
const refKey = (ref) => `${ref.type}:${ref.id}@${ref.revision}`;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
function verifyInventory(data) {
  for (const [type, plural] of [
    ['event', 'events'],
    ['frame', 'frames'],
  ]) {
    const rows = data.received[plural],
      refs = data.received[`${type}Refs`];
    const dictionary = new Map(
      rows.map((row) => [refKey({ type, id: row.id, revision: row.revision }), row]),
    );
    assert.equal(dictionary.size, rows.length, 'every actual revision occurs once');
    assert.deepEqual(refs.map(refKey).sort(), [...dictionary.keys()].sort());
    const latest = new Map();
    for (const row of rows) {
      assert.ok(
        row.time <= data.observedAt &&
          row.arrivedAt <= data.observedAt &&
          row.arrivedAt >= row.time,
      );
      if (!latest.has(row.id) || row.revision > latest.get(row.id).revision)
        latest.set(row.id, row);
    }
    const expected = [...latest.values()]
      .filter((row) => row.operation !== 'delete')
      .map((row) => refKey({ type, id: row.id, revision: row.revision }))
      .sort();
    assert.deepEqual(
      data.current[`${type}Refs`].map(refKey).sort(),
      expected,
      'snapshot uses highest received revision, removing deletes',
    );
    for (const ref of data.current[`${type}Refs`]) assert.ok(dictionary.has(refKey(ref)));
  }
  const { contentHash, ...payload } = data;
  assert.equal(contentHash.algorithm, 'sha256');
  assert.equal(
    contentHash.value,
    createHash('sha256')
      .update(JSON.stringify(canonical(payload)))
      .digest('hex'),
  );
  assert.ok(Buffer.byteLength(JSON.stringify(data), 'utf8') <= data.limits.maximumSerializedBytes);
}

test('public dataset export retains exact full received revisions and leaves authenticated AI budget untouched', async (t) => {
  const { base, calls } = await start(t),
    before = await budget(base);
  const locked = await (await fetch(`${base}/api/ai/status`)).json();
  assert.equal(locked.authRequired, true);
  const empty = await dataset(base);
  assert.equal(empty.fixture.kind, 'extended');
  assert.equal(empty.fixture.seed, 17);
  assert.equal(empty.observedAt, 0);
  assert.equal(empty.received.events.length, 0);
  assert.equal(empty.current.eventRefs.length, 0);
  verifyInventory(empty);
  const data = await dataset(base, '?kind=extended&seed=17&observedAt=362');
  assert.equal(data.schema, 'infinite-stadium.synthetic-dataset.v1');
  assert.equal(data.synthetic, true);
  assert.equal(data.fixture.kind, 'extended');
  assert.equal(data.fixture.seed, 17);
  assert.equal(data.observedAt, 362);
  assert.deepEqual(data.counts, {
    receivedEventRevisions: 69,
    receivedFrameRevisions: 368,
    currentEvents: 50,
    currentFrames: 361,
    receivedEventDeletes: 0,
    receivedFrameDeletes: 0,
    correctedEventRevisions: 19,
    correctedFrameRevisions: 7,
    resetFrameRevisions: 240,
  });
  assert.equal(data.current.stats.home.goals, 2);
  assert.equal(data.current.stats.away.goals, 1);
  assert.deepEqual(data.current.passOutcomes, {
    attempts: 12,
    pending: 0,
    completed: 9,
    accuracy: 75,
    denominator: 'passes with a known outcome',
  });
  assert.equal(data.resets.enabled, true);
  assert.equal(data.resets.durationSeconds, 20);
  assert.ok(data.received.phaseLabels.some((label) => label.scriptedReset));
  verifyInventory(data);
  assert.deepEqual(
    await dataset(base, '?kind=extended&seed=17&observedAt=362'),
    data,
    'same source scope has deterministic content identity',
  );
  for (const field of ['execution', 'trace', 'credentials', 'model', 'accessToken'])
    assert.equal(Object.hasOwn(data, field), false);
  assert.equal(calls(), 0);
  assert.deepEqual(await budget(base), before);
});

test('received cutoff exports pending outcomes honestly and never includes later confirmations', async (t) => {
  const { base, calls } = await start(t),
    data = await dataset(base, '?kind=extended&seed=17&observedAt=22');
  assert.equal(data.received.events.length, 2);
  assert.equal(data.current.eventRefs.length, 2);
  const pass = data.received.events.find((event) => event.type === 'pass');
  assert.ok(pass);
  assert.equal(pass.revision, 1);
  assert.equal(pass.result, null);
  assert.equal(pass.endX, null);
  assert.equal(pass.endY, null);
  assert.deepEqual(data.current.passOutcomes, {
    attempts: 1,
    pending: 1,
    completed: 0,
    accuracy: null,
    denominator: 'passes with a known outcome',
  });
  assert.equal(data.current.stats.home.goals, 0);
  assert.equal(data.current.stats.away.goals, 0);
  assert.equal(data.received.events.filter((event) => event.id === pass.id).length, 1);
  verifyInventory(data);
  assert.equal(calls(), 0);
});

test('actual minimal goal tombstone remains in raw data and removes the goal from current inventory', async (t) => {
  const { base, calls } = await start(t),
    before = await dataset(base, '?kind=withdrawal&seed=17&observedAt=10');
  const after = await dataset(base, '?kind=withdrawal&seed=17&observedAt=11');
  assert.equal(before.current.stats.home.goals, 1);
  assert.equal(before.current.stats.home.shots, 1);
  assert.equal(after.current.stats.home.goals, 0);
  assert.equal(after.current.stats.home.shots, 0);
  const revisions = after.received.events.filter((event) => event.id === 'withdrawal-17-shot');
  assert.deepEqual(
    revisions.map((event) => event.revision),
    [1, 2, 3],
  );
  assert.deepEqual(revisions[2], {
    id: 'withdrawal-17-shot',
    revision: 3,
    time: 8,
    arrivedAt: 11,
    operation: 'delete',
    reason: 'Synthetic provider withdraws the goal event.',
  });
  assert.equal(
    after.current.eventRefs.some((ref) => ref.id === 'withdrawal-17-shot'),
    false,
  );
  assert.equal(after.counts.receivedEventDeletes, 1);
  assert.equal(after.current.eventRefs.length, 2);
  assert.equal(after.resets.enabled, false);
  verifyInventory(before);
  verifyInventory(after);
  assert.equal(calls(), 0);
});

test('dataset route rejects invalid and ambiguous parameters without model calls', async (t) => {
  const { base, calls } = await start(t),
    before = await budget(base);
  for (const query of [
    '?kind=unknown',
    '?kind=extended&seed=not-a-number',
    '?seed=-1',
    '?seed=1.5',
    '?observedAt=-1',
    '?observedAt=Infinity',
    '?observedAt=NaN',
    '?kind=extended&observedAt=363',
    '?kind=central&observedAt=13',
    '?kind=extended&kind=wide',
    '?seed=17&seed=17',
    '?observedAt=0&observedAt=0',
    '?time=22',
    '?token=secret',
  ]) {
    const response = await fetch(`${base}/api/data/synthetic${query}`);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), {
      error: 'Choose a valid synthetic fixture, seed and received observation time.',
    });
  }
  assert.equal((await fetch(`${base}/api/data/synthetic`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/dataset-export.js`)).status, 404);
  assert.equal((await fetch(`${base}/BUILD_MANIFEST.json`)).status, 404);
  assert.equal(calls(), 0);
  assert.deepEqual(await budget(base), before);
});
