import test from 'node:test';
import assert from 'node:assert/strict';
import { watchStats } from './watch-stats.js';
import { matchState } from './match-stream.js';
test('compact statistics follow received shot corrections and goal confirmations', () => {
  const at = (time) => watchStats(matchState({ kind: 'sustained', seed: 17, time }).events);
  assert.equal(at(96).home.onTarget, 0);
  assert.equal(at(98).home.onTarget, 1);
  assert.equal(at(116).home.onTarget, 1, 'pending goal is not confirmed on target');
  assert.equal(at(118).home.onTarget, 2);
  assert.equal(at(118).home.completedPasses, 6);
});
test('blocked, off-target and unknown shots do not count as shots on target', () => {
  const rows = ['blocked', 'off-target', undefined].map((outcome) => ({
    team: 'away',
    type: 'shot',
    result: false,
    outcome,
  }));
  rows.push({ team: 'away', type: 'shot', result: null, outcome: 'on-target' });
  rows.push({ team: 'away', type: 'shot', result: true, operation: 'delete' });
  assert.deepEqual(watchStats(rows).away, {
    shots: 4,
    onTarget: 0,
    completedPasses: 0,
    ballWins: 0,
  });
});

test('unknown recovery kinds retain incomplete coverage instead of becoming ball wins', () => {
  const rows = [
    'segment-start',
    'loose-ball',
    'defensive-block',
    'goalkeeper-hold',
    undefined,
    'new-kind',
  ].map((recoveryKind) => ({ type: 'recovery', team: 'home', recoveryKind }));
  rows.push({ type: 'recovery', team: 'home', recoveryKind: 'loose-ball', operation: 'delete' });
  const stats = watchStats(rows);
  assert.equal(stats.home.ballWins, 3);
  assert.equal(stats.home.ballWinsUnknown, 2);
  assert.equal(stats.away.ballWinsUnknown, undefined);
});
