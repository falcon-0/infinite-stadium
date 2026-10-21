import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPatterns } from './pattern-insights.js';
const event = (id, time, type, extra = {}) => ({
  id,
  revision: 1,
  time,
  arrivedAt: time,
  team: 'home',
  type,
  ...extra,
});
test('bounded counts use explicit outcomes and cite every input and sequence boundary', () => {
  const records = [
    event('r', 20, 'recovery'),
    event('p', 22, 'pass', { result: true }),
    event('pending', 23, 'pass', { result: null }),
    event('unknown', 24, 'pass'),
    event('missed', 25, 'pass', { result: false }),
    event('s', 28, 'shot', { result: true }),
  ];
  const result = matchPatterns(records, 32);
  assert.deepEqual(result.teams.home, {
    shots: 1,
    completedPasses: 1,
    pendingPasses: 2,
    recoveries: 1,
  });
  assert.deepEqual(result.teams.away, {
    shots: 0,
    completedPasses: 0,
    pendingPasses: 0,
    recoveries: 0,
  });
  const pattern = result.patterns[0];
  assert.equal(pattern.seconds, 8);
  assert.equal(pattern.completedPasses, 1);
  assert.deepEqual(pattern.evidence, [
    { type: 'event', id: 'r', revision: 1 },
    { type: 'event', id: 'p', revision: 1 },
    { type: 'event', id: 's', revision: 1 },
  ]);
  assert.match(pattern.text, /recorded sequence/);
});
test('late corrections and deletions fold by revision regardless of input ordering', () => {
  const pass = event('p', 22, 'pass', { result: null }),
    recovery = event('r', 20, 'recovery'),
    shot = event('s', 28, 'shot');
  const correction = { ...pass, result: true, revision: 2, arrivedAt: 30 },
    deletion = { ...shot, operation: 'delete', revision: 2, arrivedAt: 33 };
  const records = [correction, deletion, shot, pass, recovery];
  assert.equal(matchPatterns(records, 29).teams.home.pendingPasses, 1);
  assert.equal(matchPatterns(records, 32).patterns[0].completedPasses, 1);
  assert.equal(matchPatterns(records, 33).teams.home.shots, 0);
  assert.equal(matchPatterns(records, 33).patterns.length, 0);
  assert.equal(matchPatterns(records, 32, { anchorTime: 28 }).patterns[0].evidence[1].revision, 2);
});
test('future arrivals, revised future event times, and outside-window recoveries cannot support patterns', () => {
  const records = [
    event('r', 20, 'recovery'),
    event('p', 22, 'pass', { result: true }),
    event('s', 28, 'shot', { arrivedAt: 30 }),
  ];
  assert.equal(matchPatterns(records, 29).teams.home.shots, 0);
  assert.equal(matchPatterns(records, 30, { windowSeconds: 8 }).patterns.length, 0);
  assert.equal(
    matchPatterns([...records, { ...records[2], time: 31, arrivedAt: 31, revision: 2 }], 32, {
      anchorTime: 28,
    }).teams.home.shots,
    0,
  );
  assert.deepEqual(matchPatterns([], 0).window, {
    start: 0,
    end: 0,
    requestedSeconds: 120,
    inclusive: true,
    truncatedAtStart: true,
  });
});
test('latest recovery and interruptions constrain associations, including ambiguous timestamp ties', () => {
  const base = [
    event('old', 10, 'recovery'),
    event('r', 20, 'recovery'),
    event('p', 22, 'pass', { result: true }),
    event('s', 28, 'shot'),
  ];
  assert.equal(matchPatterns(base, 30).patterns[0].recoveryId, 'r');
  for (const time of [20, 24, 28])
    assert.equal(
      matchPatterns([...base, event('opponent', time, 'recovery', { team: 'away' })], 30).patterns
        .length,
      0,
    );
  assert.equal(
    matchPatterns([event('r', 20, 'recovery'), event('s', 20, 'shot')], 20).patterns.length,
    0,
  );
  assert.equal(
    matchPatterns(
      [event('r', 20, 'recovery'), event('same-time', 20, 'recovery'), event('s', 28, 'shot')],
      28,
    ).patterns.length,
    0,
  );
  assert.equal(
    matchPatterns([event('r', 10, 'recovery'), event('s', 21, 'shot')], 21).patterns.length,
    0,
  );
  const tied = [
    event('r', 20, 'recovery'),
    event('s', 28, 'shot'),
    event('a', 20, 'pass', { result: true }),
    event('b', 28, 'pass', { result: true }),
  ];
  assert.equal(matchPatterns(tied, 28).patterns[0].completedPasses, 0);
  assert.deepEqual(matchPatterns(base, 30), matchPatterns([...base].reverse(), 30));
});
test('invalid horizons, unsupported options and malformed revisions are rejected', () => {
  for (const time of [-1, NaN, Infinity]) assert.throws(() => matchPatterns([], time));
  for (const options of [
    { anchorTime: 31 },
    { windowSeconds: 0 },
    { windowSeconds: 3601 },
    { pressure: true },
    null,
  ])
    assert.throws(() => matchPatterns([], 30, options));
  for (const extra of [
    { revision: 0 },
    { team: 'unknown' },
    { arrivedAt: 19 },
    { result: 'goal' },
    { operation: 'invented' },
  ])
    assert.throws(() => matchPatterns([event('bad', 20, 'shot', extra)], 30));
  assert.throws(
    () => matchPatterns([event('same', 20, 'shot'), event('same', 21, 'shot')], 30),
    /Conflicting/,
  );
});
