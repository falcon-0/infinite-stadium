import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedFeed } from './match-stream.js';
import { validateFixture } from './fixture-validation.js';

test('all authored fixture kinds satisfy the explicit synthetic contracts at received horizons', () => {
  for (const kind of ['central', 'wide', 'extended', 'withdrawal'])
    for (const seed of [17, 101, 902]) {
      const feed = integratedFeed(kind, seed),
        before = structuredClone(feed),
        report = validateFixture(feed);
      assert.deepEqual(report.errors, [], `${kind}/${seed}`);
      assert.equal(report.valid, true);
      assert.deepEqual(report.warnings, []);
      assert.deepEqual(feed, before);
    }
});

test('coordinate scales, actual pass endpoints and intended roster identities are audited separately', () => {
  for (const [mutate, code] of [
    [
      (feed) => {
        feed.events.find((e) => e.type === 'pass' && e.revision === 2).endX = 0;
      },
      'pass-endpoint',
    ],
    [
      (feed) => {
        feed.events.find((e) => e.type === 'pass' && e.revision === 1).endX = 50;
      },
      'pass-endpoint-schema',
    ],
    [
      (feed) => {
        feed.events.find((e) => e.type === 'receive').x = 1;
      },
      'event-location',
    ],
    [
      (feed) => {
        feed.events.find((e) => e.type === 'pass' && e.revision === 2).receiverId = 'missing';
      },
      'pass-receiver',
    ],
    [
      (feed) => {
        feed.frames[1].players[0].team = 'away';
      },
      'frame-roster',
    ],
    [
      (feed) => {
        feed.frames[1].players[0].id = 'replacement';
      },
      'roster-changed',
    ],
    [
      (feed) => {
        feed.frames[1].ball.x = 106;
      },
      'ball-bounds',
    ],
  ]) {
    const feed = integratedFeed('central', 101);
    mutate(feed);
    assert.ok(
      validateFixture(feed).errors.some((e) => e.code === code),
      code,
    );
  }
});

test('intercepted passes need opposing linked recoveries and no false reception assumptions', () => {
  const feed = integratedFeed('extended', 101);
  assert.equal(validateFixture(feed).valid, true);
  feed.events = feed.events.filter((e) => !e.id.endsWith('2-interception'));
  assert.ok(
    validateFixture(feed).errors.some(
      (e) => e.code === 'pass-outcome-link' && e.reference.id === 'extended-101-2-pass',
    ),
  );
});

test('observation-time folding preserves pending passes and original samples until repairs arrive', () => {
  const feed = integratedFeed('extended', 101);
  const at22 = validateFixture(feed, { observedAt: 22 }),
    at29 = validateFixture(feed, { observedAt: 29 }),
    at30 = validateFixture(feed, { observedAt: 30 });
  assert.equal(at22.valid, true);
  assert.equal(at22.stats.receivedEvents, 2);
  assert.equal(at29.valid, true);
  assert.equal(at30.valid, true);
  assert.equal(at29.stats.receivedEvents, 5);
  assert.equal(at30.stats.receivedEvents, 5);
  assert.ok(at29.stats.maxPlayerSampleRate > at30.stats.maxPlayerSampleRate);
});

test('duplicate deliveries are harmless, conflicting revisions and impossible record times are errors', () => {
  const feed = integratedFeed('central', 101);
  assert.equal(
    validateFixture({
      events: [...feed.events, ...feed.events].reverse(),
      frames: [...feed.frames, ...feed.frames].reverse(),
    }).valid,
    true,
  );
  const conflict = structuredClone(feed.events[0]);
  conflict.player = 'different payload';
  feed.events.push(conflict);
  assert.ok(validateFixture(feed).errors.some((e) => e.code === 'revision-conflict'));
  feed.events[0].arrivedAt = feed.events[0].time - 1;
  assert.ok(validateFixture(feed).errors.some((e) => e.code === 'record-schema'));
});

test('sample-rate limits are configurable warnings rather than claims of invalid football physics', () => {
  const feed = integratedFeed('central', 101),
    report = validateFixture(feed, { playerRateWarning: 1, ballRateWarning: 5 });
  assert.equal(report.valid, true);
  assert.ok(report.warnings.some((w) => w.code === 'player-sample-rate'));
  assert.ok(report.warnings.some((w) => w.code === 'ball-sample-rate'));
  assert.ok(
    report.warnings.every((w) => w.unit === 'metres/second' && w.interval.end > w.interval.start),
  );
  assert.deepEqual(
    validateFixture(feed, {
      playerRateWarning: null,
      ballRateWarning: null,
      sampleIntervalWarning: null,
    }).warnings,
    [],
  );
});

test('reset frames are excluded from movement heuristics while structural bounds still apply', () => {
  const feed = integratedFeed('extended', 101);
  const report = validateFixture(feed, { playerRateWarning: 1, ballRateWarning: 5 });
  assert.ok(report.stats.rateIntervalsSkipped > 0);
  assert.ok(
    report.warnings.every(
      (w) => !feed.frames.some((f) => f.time === w.interval.end && f.phase === 'reset'),
    ),
  );
  feed.frames.find((f) => f.phase === 'reset').players[0].x = -1;
  assert.ok(validateFixture(feed).errors.some((e) => e.code === 'frame-roster'));
});

test('authored receptions cannot exist without a pass or silently duplicate its ending event', () => {
  const orphan = integratedFeed('central', 101);
  orphan.events = orphan.events.filter((e) => e.type !== 'pass');
  assert.ok(validateFixture(orphan).errors.some((e) => e.code === 'orphan-reception'));
  const duplicate = integratedFeed('central', 101);
  duplicate.events.push({
    ...duplicate.events.find((e) => e.type === 'receive'),
    id: 'duplicate-reception',
  });
  assert.ok(validateFixture(duplicate).errors.some((e) => e.code === 'ambiguous-pass-ending'));
});

test('malformed roster payloads are returned as contract errors rather than crashing the audit', () => {
  const feed = integratedFeed('central', 101);
  feed.frames[1].players[0] = null;
  assert.ok(validateFixture(feed).errors.some((e) => e.code === 'frame-roster'));
  assert.throws(() => validateFixture(feed, { playerRateWarning: 0 }), RangeError);
  assert.throws(() => validateFixture(feed, { observedAt: Infinity }), RangeError);
});
