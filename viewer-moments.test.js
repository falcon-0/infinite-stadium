import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerMoments } from './viewer-moments.js';
const shot = (id, time, extra = {}) => ({
  id,
  revision: 1,
  time,
  arrivedAt: time,
  type: 'shot',
  team: 'home',
  player: 'A. Reed',
  result: false,
  outcome: 'off-target',
  ...extra,
});
test('key moments retain the received outcome and never claim a pending shot was on target', () => {
  const result = viewerMoments([shot('a', 4), shot('b', 6, { result: null })], 6);
  assert.match(result.moments[0].text, /off target/);
  assert.match(result.moments[1].text, /pending/);
  assert.equal(result.moments[1].pending, true);
});
test('late corrections use their received cutoff and exact revision', () => {
  const events = [shot('a', 4), shot('a', 4, { revision: 2, arrivedAt: 8, result: true })];
  assert.match(viewerMoments(events, 7).moments[0].text, /off target/);
  const current = viewerMoments(events, 8).moments[0];
  assert.match(current.text, /scores/);
  assert.equal(current.evidence[0].revision, 2);
});
test('received withdrawal removes a moment while future deletion does not', () => {
  const events = [
    shot('a', 4),
    { id: 'a', revision: 2, time: 4, arrivedAt: 9, operation: 'delete' },
  ];
  assert.equal(viewerMoments(events, 8).total, 1);
  assert.equal(viewerMoments(events, 9).total, 0);
});
test('player view includes recorded actions but retains goals from the other side', () => {
  const events = [
    shot('goal', 3, { team: 'away', player: 'D. Silva', result: true }),
    shot('other', 4, { player: 'J. Cole' }),
    shot('pass', 5, { type: 'pass', result: true }),
  ];
  const result = viewerMoments(events, 6, {
    audience: 'player',
    favoritePlayer: 'A. Reed',
    favoriteClub: 'home',
  });
  assert.deepEqual(
    result.moments.map((e) => e.anchorId),
    ['goal', 'pass'],
  );
  assert.match(result.moments[1].text, /completes a pass/);
});
test('the bounded list is chronological and reports omitted moments', () => {
  const result = viewerMoments(
    Array.from({ length: 10 }, (_, i) => shot(String(i), i)).reverse(),
    10,
  );
  assert.equal(result.total, 10);
  assert.equal(result.omitted, 4);
  assert.deepEqual(
    result.moments.map((e) => e.time),
    [4, 5, 6, 7, 8, 9],
  );
});
test('story language applies to the navigator and rejects future/malformed evidence', () => {
  const result = viewerMoments(
    [
      shot('goal', 4, { result: true }),
      shot('future', 8),
      shot('malformed', 2, { arrivedAt: 1 }),
      null,
    ],
    5,
    { language: 'es' },
  );
  assert.equal(result.total, 1);
  assert.match(result.moments[0].text, /marca/);
});
