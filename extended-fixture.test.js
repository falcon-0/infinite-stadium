import test from 'node:test';
import assert from 'node:assert/strict';
import { extendedFeed } from './extended-fixture.js';
import { integratedMatch } from './match-stream.js';
import { buildRequest } from './ai.js';

test('extended data is reproducible, bounded, and has continuous canonical tracks', () => {
  const feed = extendedFeed(101);
  assert.deepEqual(extendedFeed(101), feed);
  const frames = feed.frames.filter((f) => f.revision === 1).sort((a, b) => a.time - b.time);
  assert.equal(frames.length, 361);
  for (const frame of frames) {
    assert.equal(frame.players.length, 22);
    for (const p of frame.players) {
      assert.ok(p.x >= 0 && p.x <= 105 && p.y >= 0 && p.y <= 68);
    }
    if (frame.time) {
      const prev = frames[frame.time - 1];
      for (const p of frame.players) {
        const before = prev.players.find((q) => q.id === p.id);
        assert.ok(Math.hypot(p.x - before.x, p.y - before.y) < 6, `${p.id} at ${frame.time}`);
      }
    }
  }
});
test('extended segment includes both clubs, delayed shot outcomes and independent final totals', () => {
  const at28 = integratedMatch({ kind: 'extended', seed: 101, time: 28 });
  assert.equal(at28.state.stats.home.shots, 0);
  assert.equal(at28.recap.score.home, 0);
  const at29 = integratedMatch({
    kind: 'extended',
    seed: 101,
    time: 29,
    anchorId: 'extended-101-0-flight',
  });
  assert.equal(at29.recap.score.home, 1);
  assert.ok(
    at29.explanation.metrics.some((m) => m.kind === 'shot-ball-displacement-rate' && m.value > 15),
  );
  const final = integratedMatch({ kind: 'extended', seed: 101, time: 362 });
  assert.deepEqual(final.recap.score, { home: 2, away: 1 });
  assert.equal(final.state.stats.home.shots, 2);
  assert.equal(final.state.stats.away.shots, 5);
  assert.equal(final.state.passOutcomes.attempts, 12);
  assert.equal(final.state.passOutcomes.completed, 9);
  assert.equal(final.state.passOutcomes.accuracy, 75);
  assert.equal(final.state.stats.home.recoveries, 7);
  assert.equal(final.state.stats.away.recoveries, 8);
  assert.equal(final.state.events.length, 50);
  assert.ok(final.state.frames.length <= 31);
  assert.equal(final.recap.status, 'demo-segment-complete');
});
test('late location repair invalidates shot-flight metrics and recap while preserving score', () => {
  const input = { kind: 'extended', seed: 902, anchorId: 'extended-902-0-flight' };
  const before = integratedMatch({ ...input, time: 29 }),
    after = integratedMatch({ ...input, time: 30 });
  assert.deepEqual(before.recap.score, after.recap.score);
  const metric = (b) => b.explanation.metrics.find((m) => m.kind === 'shot-ball-displacement-rate');
  assert.notEqual(metric(before).id, metric(after).id);
  assert.ok(metric(after).value < metric(before).value);
  assert.notEqual(before.recap.entries[0].key, after.recap.entries[0].key);
});
test('recap AI context is bounded even for the longer fixture', () => {
  const { explanation } = buildRequest({
    source: 'integrated-match',
    mode: 'recap',
    kind: 'extended',
    seed: 101,
    time: 360,
    audience: 'analyst',
  });
  assert.ok(explanation.positions.length <= 10);
  assert.equal(explanation.sequence.length, 50);
  assert.ok(explanation.positions.every((f) => f.time <= 360 && f.arrivedAt <= 360));
});

test('authored interceptions follow the receiving opponent and suppress nonexistent shots', () => {
  const feed = extendedFeed(101);
  for (const phase of [2, 6, 9]) {
    const offset = phase * 30,
      id = `extended-101-${phase}-`;
    const pending = feed.events.find((e) => e.id === id + 'pass' && e.revision === 1);
    const confirmed = feed.events.find((e) => e.id === pending.id && e.revision === 2);
    const recovery = feed.events.find((e) => e.id === id + 'interception');
    assert.equal(pending.result, null);
    assert.equal(pending.endX, null);
    assert.equal(pending.endY, null);
    assert.equal(confirmed.result, false);
    assert.equal(confirmed.arrivedAt, offset + 24);
    assert.notEqual(recovery.team, pending.team);
    assert.equal(recovery.time, offset + 24);
    assert.ok(
      !feed.events.some(
        (e) => e.id.startsWith(id) && ['shot', 'flight', 'receive'].includes(e.type),
      ),
    );
    for (let time = offset + 24; time <= offset + 29; time++) {
      const frame = feed.frames.find((f) => f.time === time && f.revision === 1),
        owner = frame.players.find((p) => p.id === recovery.playerId);
      assert.deepEqual(frame.ball, { x: owner.x, y: owner.y });
      assert.equal(frame.scenePhase, 'intercepted-pass');
    }
    const at24 = feed.frames.find((f) => f.time === offset + 24);
    assert.equal(confirmed.endX, (at24.ball.x / 105) * 100);
    assert.equal(confirmed.endY, (at24.ball.y / 68) * 100);
    const before = integratedMatch({
      kind: 'extended',
      seed: 101,
      time: offset + 23,
    }).state.events.find((e) => e.id === pending.id);
    assert.equal(before.result, null);
    assert.equal(before.endX, null);
  }
});

test('possession scenes retain the ball with the receiver and add no shot or shot correction', () => {
  const feed = extendedFeed(101);
  for (const phase of [4, 8]) {
    const offset = phase * 30,
      id = `extended-101-${phase}-`,
      received = feed.events.find((e) => e.id === id + 'receive');
    assert.ok(received);
    assert.equal(received.scenePhase, 'possession');
    assert.ok(!feed.events.some((e) => e.id.startsWith(id) && ['shot', 'flight'].includes(e.type)));
    for (let time = offset + 24; time <= offset + 29; time++) {
      const frame = feed.frames.find((f) => f.time === time),
        owner = frame.players.find((p) => p.id === received.playerId);
      assert.deepEqual(frame.ball, { x: owner.x, y: owner.y });
      assert.equal(frame.scenePhase, 'possession');
    }
    assert.ok(!feed.frames.some((f) => f.time === offset + 28 && f.revision > 1));
  }
});

test('completed pass endpoints are received samples and retained goal scenes stay explicit', () => {
  const feed = extendedFeed(101);
  for (const pass of feed.events.filter((e) => e.type === 'pass' && e.revision === 2 && e.result)) {
    const frame = feed.frames.find((f) => f.time === pass.arrivedAt && f.revision === 1);
    assert.equal(pass.endX, (frame.ball.x / 105) * 100);
    assert.equal(pass.endY, (frame.ball.y / 68) * 100);
  }
  const goals = feed.events.filter((e) => e.type === 'shot' && e.revision === 1 && e.result);
  assert.deepEqual(
    goals.map((e) => e.id),
    ['extended-101-0-shot', 'extended-101-5-shot', 'extended-101-10-shot'],
  );
  assert.ok(goals.every((e) => e.outcome === 'goal'));
  assert.ok(
    feed.events
      .filter((e) => e.type === 'shot' && !e.result)
      .every((e) => e.outcome === 'off-target'),
  );
});
