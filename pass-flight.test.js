import test from 'node:test';
import assert from 'node:assert/strict';
import { passFlight } from './pass-flight.js';
import { comparisonFixture } from './comparison-fixture.js';
import { pitchMotion } from './pitch-motion.js';
test('authored pass flights keep contact endpoints while loft and outside-foot bend differ', () => {
  const from = { x: 10, y: 20 },
    to = { x: 60, y: 20 };
  for (const style of [
    { passType: 'short' },
    { passType: 'long' },
    { passType: 'cross' },
    { technique: 'trivela' },
  ]) {
    const start = passFlight(from, to, 0, style),
      end = passFlight(from, to, 1, style);
    assert.equal(start.x, from.x);
    assert.equal(start.y, from.y);
    assert.ok(Math.abs(end.x - to.x) < 1e-8 && Math.abs(end.y - to.y) < 1e-8);
    assert.ok(end.height < 1e-8);
  }
  assert.equal(passFlight(from, to, 0.5).height, 0);
  assert.equal(passFlight(from, to, 0.5, { passType: 'long' }).height, 4);
  assert.equal(passFlight(from, to, 0.5, { technique: 'trivela' }).y, 24);
});
test('wide passage contains an outside-foot ball followed by an authored cross into the box', () => {
  const feed = comparisonFixture(1001, { scenario: 'duel' }),
    passes = feed.events.filter((e) => e.type === 'pass' && e.revision === 1);
  const trivela = passes.find((e) => e.technique === 'trivela'),
    cross = passes.find((e) => e.passType === 'cross');
  assert.ok(trivela && cross);
  assert.equal(cross.playerId, trivela.receiverId);
  assert.equal(cross.receiverId, 'home-10');
  const flight = feed.frames.filter((f) => f.time > cross.time && f.ballState.cause === cross.id);
  assert.ok(flight.some((f) => f.ball.height > 1));
  const receive = feed.events.find((e) => e.type === 'receive' && e.passId === cross.id);
  const endpoint = feed.frames[receive.time];
  const receiver = endpoint.players.find((p) => p.id === receive.playerId);
  assert.ok(Math.hypot(endpoint.ball.x - receiver.x, endpoint.ball.y - receiver.y) < 1e-8);
});
test('display interpolation smooths ball height without changing received samples', () => {
  const a = { time: 0, players: [], ball: { x: 0, y: 0, height: 0 } },
    b = { time: 1, players: [], ball: { x: 4, y: 2, height: 3 } };
  const original = structuredClone([a, b]);
  assert.equal(pitchMotion(a, b, 0.5).ball.height, 1.5);
  assert.deepEqual([a, b], original);
});
