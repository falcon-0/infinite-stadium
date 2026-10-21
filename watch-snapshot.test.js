import test from 'node:test';
import assert from 'node:assert/strict';
import { watchSnapshot } from './watch-snapshot.js';
import { watchStats } from './watch-stats.js';

const shot = {
  id: 'shot',
  revision: 1,
  time: 10,
  arrivedAt: 10,
  type: 'shot',
  team: 'home',
  result: null,
};
test('received future confirmation does not spoil the displayed outcome', () => {
  const rows = [shot, { ...shot, revision: 2, arrivedAt: 12, result: true }];
  assert.deepEqual(watchSnapshot(rows, 9).score, { home: 0, away: 0 });
  assert.equal(watchSnapshot(rows, 10).totals.home.shots, 1);
  assert.equal(watchSnapshot(rows, 11).totals.home.onTarget, 0);
  assert.equal(watchSnapshot(rows, 11).score.home, 0);
  assert.equal(watchSnapshot(rows, 12).score.home, 1);
  assert.equal(watchSnapshot(rows, 12).totals.home.onTarget, 1);
});
test('rewinding reconstructs the previous result and respects later withdrawals', () => {
  const rows = [
    { ...shot, result: true },
    { ...shot, revision: 2, arrivedAt: 14, operation: 'delete' },
  ];
  assert.equal(watchSnapshot(rows, 14).totals.home.shots, 0);
  assert.equal(watchSnapshot(rows, 13).score.home, 1);
  assert.equal(watchSnapshot(rows, 9).totals.home.shots, 0);
  assert.equal(rows.length, 2);
});

test('starting possession is not a ball win and later recovery corrections respect replay time', () => {
  const start = {
    id: 'start',
    revision: 1,
    time: 0,
    arrivedAt: 0,
    type: 'recovery',
    team: 'home',
    recoveryKind: 'segment-start',
  };
  const win = {
    id: 'win',
    revision: 1,
    time: 8,
    arrivedAt: 8,
    type: 'recovery',
    team: 'away',
    recoveryKind: 'loose-ball',
  };
  const correction = { ...win, revision: 2, arrivedAt: 10, recoveryKind: 'segment-start' };
  const rows = [start, win, correction];
  assert.equal(watchSnapshot(rows, 0).totals.home.ballWins, 0);
  assert.equal(watchSnapshot(rows, 9).totals.away.ballWins, 1);
  assert.equal(watchSnapshot(rows, 10).totals.away.ballWins, 0);
  assert.equal(watchStats([start, win]).home.ballWins, 0);
  assert.equal(watchStats([start, win]).away.ballWins, 1);
});

test('unclassified recoveries do not become a proven zero ball-win total', () => {
  const row = { id: 'unknown', revision: 1, time: 2, arrivedAt: 2, type: 'recovery', team: 'away' };
  const total = watchSnapshot([row], 2).totals.away;
  assert.equal(total.ballWins, 0);
  assert.equal(total.ballWinsUnknown, 1);
  assert.equal(watchStats([row]).away.ballWinsUnknown, 1);
});
