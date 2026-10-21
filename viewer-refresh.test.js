import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStream } from './stream-state.js';
import { preferenceRefreshSnapshot, ViewerRefresh } from './viewer-refresh.js';

test('changing a profile retains received evidence and score but withdraws old personalized stories', () => {
  const original = {
    ...emptyStream(),
    matchId: 'match',
    time: 120,
    score: { home: 1, away: 0 },
    events: new Map([['goal', { id: 'goal', revision: 1 }]]),
    positions: new Map([['frame', { time: 116 }]]),
    summary: 'Old-language recap',
    recap: new Map([['old', { text: 'Old-language story' }]]),
    overlays: new Map([['old', { text: 'Old player' }]]),
  };
  const snapshot = preferenceRefreshSnapshot(original);
  for (const key of [
    'matchId',
    'time',
    'score',
    'events',
    'eventHistory',
    'positions',
    'positionHistory',
  ])
    assert.equal(snapshot[key], original[key]);
  assert.equal(snapshot.summary, '');
  assert.equal(snapshot.recap.size, 0);
  assert.equal(snapshot.overlays.size, 0);
  assert.equal(original.recap.size, 1);
  assert.equal(original.overlays.size, 1);
});

test('rapid profile switches reject a late success and late error without unlocking the newest profile', () => {
  const gate = new ViewerRefresh(),
    french = gate.begin(true),
    player = gate.begin(true);
  assert.equal(gate.finish(french), false);
  assert.equal(gate.fail(french), false);
  assert.equal(gate.blocked, true);
  assert.equal(gate.isCurrent(player), true);
  assert.equal(gate.finish(player), true);
  assert.equal(gate.blocked, false);
});

test('failed refresh remains unavailable until a new matching response or an explicit seek', () => {
  const gate = new ViewerRefresh(),
    failed = gate.begin(true);
  gate.fail(failed);
  assert.equal(gate.status, 'failed');
  assert.equal(gate.blocked, true);
  const retry = gate.begin(true);
  assert.equal(gate.finish(failed), false);
  gate.finish(retry);
  assert.equal(gate.blocked, false);
  gate.begin(true);
  gate.begin(false);
  assert.equal(gate.blocked, false);
});
