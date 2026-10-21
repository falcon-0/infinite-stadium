import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { exportSyntheticDataset } from './dataset-export.js';
import { integratedFeed, matchState } from './match-stream.js';

const exportAt = (kind, time, seed = 17) =>
  exportSyntheticDataset({ kind, seed, observedAt: time });
const identity = (ref) => `${ref.type}:${ref.id}:${ref.revision}`;
function resolve(dataset, type) {
  const rows = dataset.received[type === 'event' ? 'events' : 'frames'];
  const dictionary = new Map(rows.map((row) => [`${type}:${row.id}:${row.revision}`, row]));
  return dataset.current[type === 'event' ? 'eventRefs' : 'frameRefs'].map((ref) => {
    assert.equal(ref.type, type);
    assert.ok(dictionary.has(identity(ref)), 'reference resolves exactly');
    return dictionary.get(identity(ref));
  });
}
// Independent consumer replay: it does not call snapshot/observed or exporter helpers.
function replay(rows, time) {
  const latest = new Map();
  for (const row of rows) {
    if (row.time > time || row.arrivedAt > time) continue;
    if (!latest.has(row.id) || latest.get(row.id).revision < row.revision) latest.set(row.id, row);
  }
  return [...latest.values()]
    .filter((row) => row.operation !== 'delete')
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}
function hash(value) {
  const ordered = (entry) =>
    Array.isArray(entry)
      ? entry.map(ordered)
      : entry && typeof entry === 'object'
        ? Object.fromEntries(
            Object.entries(entry)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, ordered(item)]),
          )
        : entry;
  const { contentHash, ...payload } = value;
  return createHash('sha256')
    .update(JSON.stringify(ordered(payload)))
    .digest('hex');
}

test('full extended export has independently expected counts and replayable exact revisions', () => {
  const dataset = exportAt('extended', 362);
  assert.equal(dataset.schema, 'infinite-stadium.synthetic-dataset.v1');
  assert.equal(dataset.synthetic, true);
  assert.deepEqual(dataset.counts, {
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
  assert.equal(dataset.current.stats.home.goals, 2);
  assert.equal(dataset.current.stats.away.goals, 1);
  assert.equal(dataset.current.stats.home.shots, 2);
  assert.equal(dataset.current.stats.away.shots, 5);
  assert.deepEqual(resolve(dataset, 'event'), replay(dataset.received.events, 362));
  assert.deepEqual(resolve(dataset, 'frame'), replay(dataset.received.frames, 362));
  assert.equal(dataset.contentHash.value, hash(dataset));
  assert.ok(Buffer.byteLength(JSON.stringify(dataset), 'utf8') < 1024 * 1024);
});

test('withdrawal preserves actual minimal tombstone while independently removing goal from current state', () => {
  const before = exportAt('withdrawal', 8),
    corrected = exportAt('withdrawal', 10),
    withdrawn = exportAt('withdrawal', 11);
  assert.equal(before.current.stats.home.goals, 1);
  assert.equal(corrected.current.stats.home.goals, 1);
  assert.equal(withdrawn.current.stats.home.goals, 0);
  assert.equal(withdrawn.counts.currentEvents, 2);
  assert.equal(resolve(before, 'event').find((row) => row.type === 'shot').revision, 1);
  assert.equal(resolve(corrected, 'event').find((row) => row.type === 'shot').revision, 2);
  assert.equal(
    resolve(withdrawn, 'event').some((row) => row.type === 'shot'),
    false,
  );
  const tombstone = withdrawn.received.events.find((row) => row.operation === 'delete');
  assert.deepEqual(tombstone, {
    id: 'withdrawal-17-shot',
    revision: 3,
    time: 8,
    arrivedAt: 11,
    operation: 'delete',
    reason: 'Synthetic provider withdraws the goal event.',
  });
  assert.deepEqual(
    tombstone,
    integratedFeed('withdrawal', 17).events.find((row) => row.operation === 'delete'),
  );
  assert.equal(Object.hasOwn(tombstone, 'type'), false);
  assert.equal(Object.hasOwn(tombstone, 'phase'), false);
  assert.ok(
    withdrawn.received.phaseLabels.some(
      (label) => label.withdrawal && label.reference.revision === 3,
    ),
  );
  assert.deepEqual(resolve(withdrawn, 'event'), replay(withdrawn.received.events, 11));
  assert.equal(withdrawn.counts.receivedEventDeletes, 1);
});

test('pending pass has null endpoints until outcome arrives, preserving original revision thereafter', () => {
  for (const [kind, pendingAt, confirmedAt] of [
    ['central', 2, 4],
    ['extended', 22, 24],
  ]) {
    const pending = exportAt(kind, pendingAt),
      confirmed = exportAt(kind, confirmedAt);
    const pass = resolve(pending, 'event').find((row) => row.type === 'pass');
    assert.equal(pass.result, null);
    assert.equal(pass.endX, null);
    assert.equal(pass.endY, null);
    assert.equal(pending.current.passOutcomes.pending, 1);
    assert.equal(pending.current.passOutcomes.accuracy, null);
    const completed = resolve(confirmed, 'event').find((row) => row.id === pass.id);
    assert.equal(completed.revision, 2);
    assert.equal(completed.result, true);
    assert.ok(Number.isFinite(completed.endX) && Number.isFinite(completed.endY));
    assert.deepEqual(
      confirmed.received.events.find((row) => row.id === pass.id && row.revision === 1),
      pass,
    );
    assert.equal(confirmed.current.passOutcomes.pending, 0);
    assert.equal(confirmed.current.passOutcomes.completed, 1);
  }
});

test('arrival cutoff distinguishes available tracking sample from delayed action and correction', () => {
  const before = exportAt('extended', 28.999),
    arrived = exportAt('extended', 29),
    corrected = exportAt('extended', 30);
  assert.ok(before.received.frames.some((row) => row.time === 28));
  assert.equal(
    before.received.events.some((row) => row.type === 'shot'),
    false,
  );
  assert.equal(arrived.received.events.filter((row) => row.type === 'shot').length, 1);
  assert.equal(resolve(arrived, 'event').find((row) => row.type === 'shot').revision, 1);
  const versions = corrected.received.events.filter((row) => row.id === 'extended-17-0-shot');
  assert.deepEqual(
    versions.map((row) => row.revision),
    [1, 2],
  );
  assert.notEqual(versions[0].x, versions[1].x);
  assert.equal(resolve(corrected, 'event').find((row) => row.type === 'shot').revision, 2);
  for (const dataset of [before, arrived, corrected])
    for (const row of [...dataset.received.events, ...dataset.received.frames]) {
      assert.ok(row.time <= dataset.observedAt);
      assert.ok(row.arrivedAt <= dataset.observedAt);
    }
});

test('explicit twenty-second resets are separate labels and do not alter raw records', () => {
  const dataset = exportAt('extended', 362),
    feed = integratedFeed('extended', 17);
  assert.equal(dataset.resets.durationSeconds, 20);
  assert.equal(dataset.resets.phasePeriodSeconds, 30);
  const resetLabels = dataset.received.phaseLabels.filter((label) => label.scriptedReset);
  assert.equal(resetLabels.length, 240);
  assert.ok(resetLabels.every((label) => label.reference.type === 'frame'));
  const first = dataset.received.frames.find((row) => row.time === 0);
  assert.deepEqual(
    first,
    feed.frames.find((row) => row.id === first.id && row.revision === first.revision),
  );
  assert.equal(Object.hasOwn(first, 'scriptedReset'), false);
  assert.equal(exportAt('central', 12).resets.enabled, false);
  assert.match(dataset.resets.limitation, /not observed football play/);
});

test('four fixture kinds and three seeds reproduce materialized state within bounds', () => {
  for (const kind of ['central', 'wide', 'extended', 'withdrawal'])
    for (const seed of [17, 101, 902]) {
      const time = kind === 'extended' ? 362 : 12,
        dataset = exportAt(kind, time, seed);
      const state = matchState({ kind, seed, time });
      assert.deepEqual(resolve(dataset, 'event'), state.events);
      assert.deepEqual(resolve(dataset, 'frame'), state.frames);
      assert.deepEqual(dataset.current.stats, state.stats);
      assert.deepEqual(dataset.current.passOutcomes, state.passOutcomes);
      assert.deepEqual(resolve(dataset, 'event'), replay(dataset.received.events, time));
      assert.deepEqual(resolve(dataset, 'frame'), replay(dataset.received.frames, time));
      assert.equal(
        new Set(dataset.received.eventRefs.map(identity)).size,
        dataset.received.events.length,
      );
      assert.equal(
        new Set(dataset.received.frameRefs.map(identity)).size,
        dataset.received.frames.length,
      );
      assert.equal(dataset.contentHash.value, hash(dataset));
      assert.ok(
        Buffer.byteLength(JSON.stringify(dataset), 'utf8') <= dataset.limits.maximumSerializedBytes,
      );
      assert.equal(dataset.fixture.seed, seed);
      assert.equal(dataset.fixture.kind, kind);
    }
});

test('content identity is reproducible and varies with seed or observation cutoff', () => {
  const first = exportAt('extended', 362),
    second = exportAt('extended', 362);
  assert.deepEqual(first, second);
  assert.notEqual(first.contentHash.value, exportAt('extended', 362, 18).contentHash.value);
  assert.notEqual(first.contentHash.value, exportAt('extended', 361).contentHash.value);
  assert.equal(first.contentHash.algorithm, 'sha256');
  assert.match(first.contentHash.limitation, /not signed provenance/);
});

test('export snapshots are detached, including records, refs and metadata', () => {
  const dataset = exportAt('central', 12),
    original = structuredClone(dataset);
  dataset.received.events[0].result = 'tampered';
  dataset.received.frames[0].players[0].x = -999;
  dataset.current.eventRefs[0].revision = 999;
  dataset.fixture.pitch.length = 999;
  dataset.received.phaseLabels[0].reference.id = 'tampered';
  assert.deepEqual(exportAt('central', 12), original);
});

test('strict bounded input rejects malformed or additional user data', () => {
  const valid = { kind: 'central', seed: 17, observedAt: 12 };
  for (const input of [
    null,
    [],
    {},
    { ...valid, personalData: 'no' },
    { ...valid, seed: undefined },
    { ...valid, kind: 'real' },
    { ...valid, seed: -1 },
    { ...valid, seed: 1.5 },
    { ...valid, seed: '17' },
    { ...valid, seed: 100001 },
    { ...valid, observedAt: -1 },
    { ...valid, observedAt: 13 },
    { ...valid, observedAt: Infinity },
    { ...valid, observedAt: NaN },
    { ...valid, observedAt: '12' },
    { kind: 'extended', seed: 17, observedAt: 363 },
  ])
    assert.throws(() => exportSyntheticDataset(input));
  assert.equal(exportAt('central', 0, 0).observedAt, 0);
  assert.equal(exportAt('extended', 362, 100000).fixture.seed, 100000);
});
