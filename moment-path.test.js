import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedMomentPath } from './moment-path.js';
import { matchState, matchExplanation } from './match-stream.js';
const packet = (kind = 'extended', time = 30, anchorId = 'extended-17-0-shot') => {
  const state = matchState({ kind, seed: 17, time });
  return {
    explanation: structuredClone(matchExplanation(state, anchorId)),
    options: { observedAt: time, currentEvents: state.events, currentFrames: state.frames },
  };
};
const render = (p) => recordedMomentPath(p.explanation, p.options);

test('central and wide confirmed reception links exact pass endpoints with complete revision evidence', () => {
  for (const kind of ['central', 'wide']) {
    const p = packet(kind, 4, `${kind}-17-receive`),
      saved = structuredClone(p),
      lines = render(p);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].kind, 'pass-endpoint-link');
    assert.deepEqual(lines[0].start, { x: 65, y: 34, time: 2 });
    assert.deepEqual(lines[0].end, { x: 78.8, y: kind === 'central' ? 34 : 11, time: 4 });
    assert.deepEqual(
      lines[0].evidence.map((r) => [r.type, r.revision]),
      [
        ['event', 2],
        ['event', 1],
        ['frame', 1],
        ['frame', 1],
      ],
    );
    assert.match(lines[0].description, /sample endpoints.*not the ball trajectory/);
    lines[0].evidence[0].revision = 99;
    assert.deepEqual(p, saved);
  }
});
test('extended selected shot can show only received completed-pass and linked-flight sample endpoints', () => {
  const p = packet(),
    lines = render(p);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ['pass-endpoint-link', 'shot-endpoint-link'],
  );
  const shot = lines[1];
  assert.deepEqual(shot.start, { x: 85.6, y: 34, time: 28 });
  const endFrame = p.options.currentFrames.find((f) => f.time === 29);
  assert.deepEqual(shot.end, { ...endFrame.ball, time: 29 });
  assert.ok(shot.evidence.some((r) => r.id === 'extended-17-0-shot' && r.revision === 2));
  assert.ok(shot.evidence.some((r) => r.id === 'extended-17-frame-28' && r.revision === 2));
  assert.ok(shot.evidence.some((r) => r.id === 'extended-17-0-flight'));
  assert.doesNotMatch(shot.description, /goal line|goal path|caused|tactic/i);
  const flight = packet('extended', 30, 'extended-17-0-flight');
  assert.equal(render(flight).length, 2);
});
test('central correction at observed 10 keeps only pass link and never invents a goal endpoint', () => {
  const before = packet('central', 8, 'central-17-shot'),
    after = packet('central', 10, 'central-17-shot');
  assert.deepEqual(
    render(before).map((l) => l.kind),
    ['pass-endpoint-link'],
  );
  assert.deepEqual(
    render(after).map((l) => l.kind),
    ['pass-endpoint-link'],
  );
  before.options = after.options;
  assert.deepEqual(render(before), []);
});
test('stale, conflicting, missing, deleted and future dependencies fail closed', () => {
  const changes = [
    (p) => p.options.currentEvents.find((e) => e.type === 'shot').revision++,
    (p) => p.options.currentFrames.find((f) => f.time === 28).revision++,
    (p) => (p.options.currentFrames = p.options.currentFrames.filter((f) => f.time !== 28)),
    (p) => (p.options.currentEvents.find((e) => e.type === 'shot').operation = 'delete'),
    (p) => (p.options.currentFrames.find((f) => f.time === 28).arrivedAt = 31),
    (p) => p.options.currentFrames.push({ ...p.options.currentFrames[0], revision: 99 }),
    (p) =>
      p.options.currentEvents.push({ ...p.options.currentEvents[0], player: 'conflicting name' }),
    (p) => (p.options.currentFrames.find((f) => f.time === 28).unit = 'feet'),
    (p) => (p.options.currentFrames.find((f) => f.time === 28).ball.x = 106),
  ];
  for (const change of changes) {
    const p = structuredClone(packet());
    change(p);
    assert.deepEqual(render(p), []);
  }
  const noEnd = packet();
  noEnd.options.currentFrames = noEnd.options.currentFrames.filter((f) => f.time !== 29);
  assert.deepEqual(
    render(noEnd).map((l) => l.kind),
    ['pass-endpoint-link'],
  );
});
test('pending, failed or mismatched passes cannot draw reception endpoint links', () => {
  for (const result of [null, false, 'true']) {
    const p = structuredClone(packet('central', 4, 'central-17-receive'));
    for (const source of [p.options.currentEvents, p.explanation.sequence])
      source.find((e) => e.type === 'pass').result = result;
    assert.deepEqual(render(p), []);
  }
  const mismatch = structuredClone(packet('central', 4, 'central-17-receive'));
  for (const source of [mismatch.options.currentEvents, mismatch.explanation.sequence])
    source.find((e) => e.type === 'pass').receiverId = 'away-10';
  assert.deepEqual(render(mismatch), []);
});
test('opponent recovery at either endpoint or between reception and shot suppresses relevant linking', () => {
  for (const time of [22, 23, 24, 27, 28]) {
    const p = packet();
    p.options.currentEvents = [
      ...p.options.currentEvents,
      {
        id: `opponent-${time}`,
        revision: 1,
        operation: 'upsert',
        type: 'recovery',
        team: 'away',
        playerId: 'away-7',
        time,
        arrivedAt: time,
      },
    ];
    assert.ok(!render(p).some((l) => l.kind === 'pass-endpoint-link'));
  }
  const reset = packet();
  reset.options.currentFrames = structuredClone(reset.options.currentFrames);
  reset.options.currentFrames.find((f) => f.time === 23).phase = 'reset';
  assert.ok(!render(reset).some((l) => l.kind === 'pass-endpoint-link'));
  const intercepted = packet('extended', 90, 'extended-17-2-recovery');
  assert.deepEqual(render(intercepted), []);
  const ownRecovery = packet();
  ownRecovery.options.currentEvents.push({
    id: 'same-team-interruption',
    revision: 1,
    type: 'recovery',
    team: 'home',
    playerId: 'home-7',
    time: 27,
    arrivedAt: 27,
  });
  assert.ok(!render(ownRecovery).some((l) => l.kind === 'pass-endpoint-link'));
  const ambiguous = packet(),
    receive = ambiguous.options.currentEvents.find((e) => e.type === 'receive');
  ambiguous.options.currentEvents.push({ ...receive, id: 'other-reception' });
  assert.ok(!render(ambiguous).some((l) => l.kind === 'pass-endpoint-link'));
});
test('shot requires matching flight identity and available exact sample, not just a goal result', () => {
  for (const change of [
    (p) => (p.options.currentEvents = p.options.currentEvents.filter((e) => e.type !== 'flight')),
    (p) => (p.options.currentEvents.find((e) => e.type === 'flight').shotId = 'other-shot'),
    (p) => (p.options.currentEvents.find((e) => e.type === 'flight').playerId = 'away-10'),
    (p) => (p.options.currentFrames.find((f) => f.time === 29).phase = 'reset'),
    (p) => (p.options.currentFrames.find((f) => f.time === 29).id = 'unrelated-frame-29'),
  ]) {
    const p = structuredClone(packet());
    change(p);
    assert.ok(!render(p).some((l) => l.kind === 'shot-endpoint-link'));
  }
  const notReceived = packet();
  notReceived.options.observedAt = 28;
  assert.deepEqual(render(notReceived), []);
});
test('API accepts materialized Maps and rejects malformed or ambiguous sample inventories', () => {
  const p = packet();
  p.options.currentEvents = new Map(p.options.currentEvents.map((e) => [e.id, e]));
  p.options.currentFrames = new Map(p.options.currentFrames.map((f) => [f.id, f]));
  assert.equal(render(p).length, 2);
  assert.deepEqual(recordedMomentPath(null), []);
  assert.deepEqual(recordedMomentPath(p.explanation, { ...p.options, currentFrames: null }), []);
  const ambiguous = packet();
  ambiguous.options.currentFrames.push({
    ...ambiguous.options.currentFrames.find((f) => f.time === 28),
    id: 'another-frame-28',
  });
  assert.deepEqual(render(ambiguous), []);
});
