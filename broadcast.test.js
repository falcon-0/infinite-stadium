import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastFrame } from './broadcast.js';
import { integratedFeed } from './match-stream.js';
import { serverSettings, authorized, modelBudget } from './server-settings.js';
import { emptyStream, applyStream } from './stream-state.js';

test('fresh position snapshots omit exact duplicates without losing received history or changing deltas', () => {
  const cases = [
    ['central', 8],
    ['central', 10],
    ['wide', 10],
    ['withdrawal', 11],
    ['sustained', 0],
    ['sustained', 80],
    ['sustained', 120],
    ['extended', 122],
    ['extended', 362],
  ];
  for (const [kind, time] of cases) {
    const input = { kind, seed: 17, time },
      feed = integratedFeed(kind, 17);
    const snapshot = broadcastFrame(input, null, feed);
    const fullHistory = feed.frames.filter((f) => f.time <= time && f.arrivedAt <= time);
    const original = structuredClone(snapshot.message);
    original.positions.history = structuredClone(fullHistory);
    const current = new Set(snapshot.message.positions.upserts.map((f) => JSON.stringify(f)));
    assert.deepEqual(snapshot.message.positions.upserts, snapshot.bundle.state.frames);
    assert.deepEqual(
      snapshot.message.positions.history,
      fullHistory.filter((f) => !current.has(JSON.stringify(f))),
      `${kind}/${time}: retained order and content`,
    );
    const materialized = applyStream(emptyStream(), snapshot.message);
    const originalState = applyStream(emptyStream(), original);
    assert.deepEqual(materialized, originalState, `${kind}/${time}: complete received state`);
    const next = broadcastFrame(
      { ...input, time: Math.min(time + 1, snapshot.bundle.state.metadata.observationHorizon) },
      snapshot.bundle,
      feed,
    );
    assert.equal(next.message.positions.history, undefined);
    assert.deepEqual(
      next.message.positions.upserts,
      next.bundle.state.frames.filter(
        (frame) =>
          !snapshot.bundle.state.frames.some(
            (old) => old.id === frame.id && old.revision === frame.revision,
          ),
      ),
    );
    assert.deepEqual(
      applyStream(materialized, next.message),
      applyStream(originalState, next.message),
    );
  }
});

test('same position ID and revision with conflicting contents remains visible to client validation', () => {
  const input = { kind: 'central', seed: 17, time: 8 };
  const feed = structuredClone(integratedFeed(input.kind, input.seed));
  const original = feed.frames.find((frame) => frame.time === 7);
  assert.ok(original);
  const conflict = structuredClone(original);
  conflict.ball.x += 1;
  feed.frames.push(conflict);
  const { message } = broadcastFrame(input, null, feed);
  const records = [...message.positions.history, ...message.positions.upserts].filter(
    (frame) => frame.id === original.id && frame.revision === original.revision,
  );
  assert.ok(records.some((frame) => frame.ball.x === original.ball.x));
  assert.ok(records.some((frame) => frame.ball.x === conflict.ball.x));
  assert.throws(
    () => applyStream(emptyStream(), message),
    /Conflicting contents for a received position revision/,
  );
});

test('initial snapshot reduces repeated position bytes while retaining current records', () => {
  const { message } = broadcastFrame({ kind: 'sustained', seed: 17, time: 80, language: 'fr' });
  const full = structuredClone(message);
  full.positions.history = integratedFeed('sustained', 17).frames.filter(
    (frame) => frame.time <= 80 && frame.arrivedAt <= 80,
  );
  assert.equal(full.positions.history.length - message.positions.history.length, 31);
  assert.equal(message.positions.upserts.length, 31);
  assert.ok(
    Buffer.byteLength(JSON.stringify(message)) < Buffer.byteLength(JSON.stringify(full)) * 0.8,
  );
});

test('broadcast deltas repair active overlays and expire them without repeating unrelated events', () => {
  const input = { kind: 'extended', seed: 101, audience: 'analyst' },
    feed = integratedFeed(input.kind, input.seed);
  const original = broadcastFrame({ ...input, time: 29 }, null, feed);
  assert.equal(original.message.overlays.upserts.length, 1);
  const correction = broadcastFrame({ ...input, time: 30 }, original.bundle, feed);
  assert.equal(correction.message.overlays.upserts.length, 1);
  assert.equal(correction.message.recap.upserts.length, 1);
  assert.ok(correction.message.positions.upserts.some((f) => f.time === 28 && f.revision === 2));
  assert.equal(correction.message.events.upserts.filter((e) => e.type === 'shot').length, 1);
  const expired = broadcastFrame({ ...input, time: 48 }, correction.bundle, feed);
  assert.ok(expired.message.overlays.withdrawals.includes('narrative-extended-101-0-shot'));
  assert.equal(expired.message.overlays.upserts.length, 0);
});

test('actual received deletion revisions accompany delta and seek-snapshot withdrawals', () => {
  const input = { kind: 'extended', seed: 17 },
    feed = integratedFeed(input.kind, input.seed);
  const goal = feed.events.find((e) => e.id === 'extended-17-0-shot' && e.revision === 2);
  const deletion = {
    ...goal,
    revision: 3,
    arrivedAt: 32,
    operation: 'delete',
    reason: 'Synthetic provider withdraws the goal.',
  };
  const messages = { ...feed, events: [...feed.events, deletion] };
  const before = broadcastFrame({ ...input, time: 30 }, null, messages);
  const pending = broadcastFrame({ ...input, time: 31 }, before.bundle, messages);
  assert.deepEqual(pending.message.events.withdrawalRecords, []);
  const after = broadcastFrame({ ...input, time: 32 }, pending.bundle, messages);
  assert.ok(after.message.events.withdrawals.includes(goal.id));
  assert.deepEqual(after.message.events.withdrawalRecords, [deletion]);
  assert.deepEqual(after.message.score, { home: 0, away: 0 });
  const seek = broadcastFrame({ ...input, time: 32 }, null, messages);
  assert.deepEqual(seek.message.events.withdrawalRecords, [deletion]);
  assert.ok(seek.message.events.withdrawals.includes(goal.id));
  assert.ok(!seek.message.events.upserts.some((e) => e.id === goal.id));
  assert.deepEqual(
    broadcastFrame({ ...input, time: 33 }, after.bundle, messages).message.events.withdrawalRecords,
    [],
  );
});
test('public servers require credentials, HTTPS origins and bounded model budgets', () => {
  assert.throws(() => serverSettings({ HOST: '0.0.0.0' }), /APP_ACCESS_TOKEN/);
  assert.throws(() => serverSettings({ PUBLIC_ORIGIN: 'http://public.example' }), /HTTPS/);
  assert.throws(() => serverSettings({ PORT: 'wrong' }));
  const token = 'a'.repeat(32),
    settings = serverSettings({
      HOST: '0.0.0.0',
      PORT: '8080',
      APP_ACCESS_TOKEN: token,
      PUBLIC_ORIGIN: 'https://demo.example',
    });
  assert.ok(settings.origins.includes('https://demo.example'));
  assert.equal(authorized(undefined, token), false);
  assert.equal(authorized('Bearer wrong', token), false);
  assert.equal(authorized(`Bearer ${token}`, token), true);
  let today = new Date('2026-10-05T10:00:00Z');
  const budget = modelBudget(2, () => today);
  budget.take();
  budget.take();
  assert.throws(() => budget.take(), /limit reached/);
  today = new Date('2026-10-06T10:00:00Z');
  budget.take();
  assert.equal(budget.snapshot().calls, 1);
});
