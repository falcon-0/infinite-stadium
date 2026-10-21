import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPicture } from './match-picture.js';
import { integratedFeed } from './match-stream.js';
const home = (picture) => picture.teams[0].cells;
const event = (id, type, result, outcome, extra = {}) => ({
  id,
  type,
  team: 'home',
  revision: 1,
  time: 1,
  arrivedAt: 1,
  result,
  ...(outcome ? { outcome } : {}),
  ...extra,
});

test('full authored segment compares received counts and exact supporting current versions', () => {
  const feed = integratedFeed('extended', 17),
    saved = structuredClone(feed.events),
    picture = matchPicture(feed.events, 362);
  const h = picture.teams[0].cells,
    a = picture.teams[1].cells;
  assert.equal(h.goals.value + a.goals.value, 3);
  assert.equal(h.shots.value + a.shots.value, 7);
  assert.equal(h.completedPasses.value + a.completedPasses.value, 9);
  assert.equal(h.passAccuracy.knownCount + a.passAccuracy.knownCount, 12);
  assert.equal(h.passAccuracy.pendingCount + a.passAccuracy.pendingCount, 0);
  assert.equal(picture.evidence.length, 50);
  assert.equal(picture.synthetic, true);
  for (const side of picture.teams)
    for (const metric of Object.values(side.cells))
      for (const reference of metric.evidence) {
        assert.ok(
          feed.events.some((row) => row.id === reference.id && row.revision === reference.revision),
        );
        assert.ok(
          picture.evidence.some(
            (ref) => ref.id === reference.id && ref.revision === reference.revision,
          ),
        );
      }
  assert.deepEqual(feed.events, saved);
  assert.deepEqual(picture, matchPicture(feed.events, 362));
});

test('actual shot correction replaces evidence and received withdrawal removes its goal', () => {
  const feed = integratedFeed('withdrawal', 17),
    before = matchPicture(feed.events, 8),
    corrected = matchPicture(feed.events, 10),
    deleted = matchPicture(feed.events, 11);
  assert.equal(home(before).goals.value, 1);
  assert.equal(home(corrected).goals.value, 1);
  assert.equal(home(deleted).goals.value, 0);
  assert.equal(home(before).goals.evidence[0].revision, 1);
  assert.equal(home(corrected).goals.evidence[0].revision, 2);
  assert.equal(home(deleted).shots.value, 0);
  assert.notEqual(before.key, corrected.key);
  assert.notEqual(corrected.key, deleted.key);
});

test('on-target classification separates known misses and unknown outcomes without inventing precision', () => {
  const rows = [
    event('goal', 'shot', true),
    event('saved', 'shot', false, 'saved'),
    event('target', 'shot', false, 'on-target'),
    event('blocked', 'shot', false, 'blocked'),
    event('off', 'shot', false, 'off-target'),
    event('unknown', 'shot', false),
    event('pending', 'shot', null),
  ];
  const cells = home(matchPicture(rows, 1));
  assert.equal(cells.goals.value, 1);
  assert.equal(cells.shots.value, 7);
  assert.equal(cells.onTarget.value, 3);
  assert.equal(cells.onTarget.knownCount, 5);
  assert.equal(cells.onTarget.unknownCount, 2);
  assert.deepEqual(
    cells.onTarget.evidence.map((ref) => ref.id),
    ['goal', 'saved', 'target'],
  );
  assert.deepEqual(
    cells.onTarget.unknownEvidence.map((ref) => ref.id),
    ['pending', 'unknown'],
  );
});

test('pass accuracy uses confirmed true and false only while pending remains visible separately', () => {
  const rows = [
    event('complete', 'pass', true),
    event('failed', 'pass', false),
    event('pending', 'pass', null),
    event('missing', 'pass', undefined),
  ];
  const cells = home(matchPicture(rows, 1));
  assert.equal(cells.completedPasses.value, 1);
  assert.equal(cells.completedPasses.pendingCount, 2);
  assert.equal(cells.passAccuracy.value, 50);
  assert.equal(cells.passAccuracy.knownCount, 2);
  assert.deepEqual(
    cells.passAccuracy.evidence.map((ref) => ref.id),
    ['complete', 'failed'],
  );
  assert.equal(home(matchPicture([rows[2]], 1)).passAccuracy.value, null);
});

test('only received revisions affect the current picture and confirmed passes replace pending rows', () => {
  const feed = integratedFeed('central', 17),
    pending = matchPicture(feed.events, 2),
    confirmed = matchPicture(feed.events, 4);
  assert.equal(home(pending).completedPasses.pendingCount, 1);
  assert.equal(home(pending).passAccuracy.value, null);
  assert.equal(home(confirmed).completedPasses.pendingCount, 0);
  assert.equal(home(confirmed).passAccuracy.value, 100);
  assert.equal(home(confirmed).completedPasses.evidence[0].revision, 2);
  const late = event('late', 'shot', true, undefined, { time: 1, arrivedAt: 5 });
  assert.equal(home(matchPicture([late], 4)).shots.value, 0);
  assert.equal(
    home(matchPicture([event('future', 'shot', true, undefined, { time: 5, arrivedAt: 5 })], 4))
      .shots.value,
    0,
  );
});

test('same-content duplicates count once, conflicting received revisions fail closed', () => {
  const row = event('shot', 'shot', true),
    equivalent = Object.fromEntries(Object.entries(row).reverse());
  assert.equal(home(matchPicture([row, equivalent], 1)).shots.value, 1);
  assert.throws(() => matchPicture([row, { ...row, result: false }], 1), /Conflicting/);
  assert.equal(
    home(matchPicture([row, { ...row, revision: 2, result: false, arrivedAt: 3 }], 1)).goals.value,
    1,
  );
});

test('four language labels preserve accents and identical evidence without unsupported metrics', () => {
  const rows = integratedFeed('extended', 17).events,
    english = matchPicture(rows, 362);
  for (const [language, label] of Object.entries({
    en: 'Pass accuracy',
    es: 'Precisión de pases',
    fr: 'Précision des passes',
    pt: 'Precisão dos passes',
  })) {
    const picture = matchPicture(rows, 362, { language });
    assert.equal(picture.labels.passAccuracy, label);
    assert.deepEqual(picture.teams, english.teams);
    assert.deepEqual(picture.evidence, english.evidence);
    assert.equal(picture.key, english.key);
    assert.deepEqual(Object.keys(picture.teams[0].cells), [
      'goals',
      'shots',
      'onTarget',
      'completedPasses',
      'passAccuracy',
      'recoveries',
    ]);
  }
});

test('malformed or oversized inventories reject, and output snapshots do not alias inputs', () => {
  const row = event('pass', 'pass', true);
  for (const input of [
    [{ ...row, result: 'true' }],
    [{ ...row, revision: 0 }],
    [{ ...row, arrivedAt: 0 }],
    [{ ...row, time: NaN }],
    [{ ...row, team: 'unknown' }],
    Array(10001).fill(row),
  ])
    assert.throws(() => matchPicture(input, 1), RangeError);
  assert.throws(() => matchPicture([row], Infinity));
  assert.throws(() => matchPicture([row], 1, { language: 'de' }));
  const picture = matchPicture([row], 1),
    key = picture.key;
  picture.teams[0].cells.completedPasses.evidence[0].revision = 999;
  picture.labels.goals = 'changed';
  picture.scope.end = 9;
  assert.equal(row.revision, 1);
  assert.equal(matchPicture([row], 1).key, key);
  assert.equal(matchPicture([row], 1).labels.goals, 'Goals');
});

test('ball-win coverage follows explicit classification, current corrections and withdrawals', () => {
  const start = event('start', 'recovery', undefined, undefined, { recoveryKind: 'segment-start' }),
    unknown = event('win', 'recovery', undefined),
    fixed = { ...unknown, revision: 2, arrivedAt: 3, recoveryKind: 'loose-ball' },
    deleted = { ...fixed, revision: 3, arrivedAt: 5, operation: 'delete' };
  const rows = [start, unknown, fixed, deleted];
  const before = home(matchPicture(rows, 2)).recoveries;
  assert.equal(before.value, 0);
  assert.equal(before.complete, false);
  assert.equal(before.unknownCount, 1);
  assert.deepEqual(before.unknownEvidence, [{ type: 'event', id: 'win', revision: 1 }]);
  const after = home(matchPicture(rows, 3)).recoveries;
  assert.equal(after.value, 1);
  assert.equal(after.complete, true);
  assert.equal(after.unknownCount, 0);
  assert.deepEqual(after.evidence, [{ type: 'event', id: 'win', revision: 2 }]);
  assert.equal(home(matchPicture(rows, 5)).recoveries.value, 0);
});
