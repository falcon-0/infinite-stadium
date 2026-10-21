import test from 'node:test';
import assert from 'node:assert/strict';
import { momentMeaning } from './moment-meaning.js';
import { integratedFeed } from './match-stream.js';

const event = (id, time, type = 'shot', result = true, extra = {}) => ({
  id,
  time,
  arrivedAt: time,
  revision: 1,
  operation: 'upsert',
  type,
  result,
  team: 'home',
  player: 'A. Reed',
  ...(type === 'recovery' ? { recoveryKind: 'loose-ball' } : {}),
  ...extra,
});
const meaning = (rows, id, options = {}) =>
  momentMeaning(rows, id, { observedAt: 120, ...options });

test('goals explain lead, equalizer, extending and reducing the deficit', () => {
  const goal = event('goal', 20);
  const cases = [
    { before: [], kind: 'took-lead', text: '0–0 to 1–0' },
    {
      before: [event('away', 2, 'shot', true, { team: 'away' })],
      kind: 'equalized',
      text: '0–1 to 1–1',
    },
    { before: [event('home', 2)], kind: 'extended-lead', text: '1–0 to 2–0' },
    {
      before: [
        event('away1', 2, 'shot', true, { team: 'away' }),
        event('away2', 4, 'shot', true, { team: 'away' }),
      ],
      kind: 'reduced-deficit',
      text: '0–2 to 1–2',
    },
  ];
  for (const item of cases) {
    const output = meaning([...item.before, goal], 'goal');
    assert.equal(output.kind, item.kind);
    assert.ok(output.why.includes(item.text));
    assert.equal(output.status, 'insight');
    assert.equal(output.evidence.length, item.before.length + 1);
    assert.match(output.scope.scoreLabel, /synthetic segment/);
  }
});

test('a miss explains a missed equalizer without claiming a save or ball possession', () => {
  const output = meaning(
    [
      event('home', 5),
      event('miss', 20, 'shot', false, { team: 'away', player: 'D. Silva', outcome: 'off-target' }),
    ],
    'miss',
  );
  assert.equal(output.headline, 'D. Silva shoots off target');
  assert.match(output.why, /chance to draw level/);
  assert.match(output.why, /1–0/);
  assert.doesNotMatch(output.why, /keeper|saved|possession|pressure|deserved/);
});

test('pending shots never become misses and earlier unresolved shots suppress score consequences', () => {
  const pending = event('pending', 5, 'shot', null, { outcome: 'saved' }),
    goal = event('goal', 20);
  const shot = meaning([pending], 'pending');
  assert.equal(shot.kind, 'pending-outcome');
  assert.match(shot.why, /still pending/);
  assert.doesNotMatch(shot.headline, /saved|scores/);
  const scored = meaning([pending, goal], 'goal');
  assert.equal(scored.kind, null);
  assert.equal(scored.why, null);
  const miss = meaning([pending, event('miss', 20, 'shot', false)], 'miss');
  assert.equal(
    miss.why,
    'This attempt adds no goal. Its outcome does not tell us who controls the next ball.',
  );
});

test('selected historical moment excludes later goals and unreceived revisions', () => {
  const shot = event('shot', 20, 'shot', false),
    later = event('later', 30),
    correction = { ...shot, result: true, revision: 2, arrivedAt: 40 };
  const output = meaning([later, shot, correction], 'shot', { observedAt: 35 });
  assert.equal(output.score.home, 0);
  assert.equal(output.kind, 'no-goal');
  assert.deepEqual(output.evidence, [{ type: 'event', id: 'shot', revision: 1 }]);
  assert.match(meaning([later, shot, correction], 'shot', { observedAt: 40 }).why, /0–0 to 1–0/);
});

test('latest received revisions and withdrawals replace old score implications', () => {
  const old = event('prior', 5),
    deleted = { id: 'prior', time: 5, arrivedAt: 25, revision: 2, operation: 'delete' },
    goal = event('goal', 20);
  assert.equal(meaning([old, goal, deleted], 'goal', { observedAt: 20 }).kind, 'extended-lead');
  assert.equal(meaning([old, goal, deleted], 'goal', { observedAt: 25 }).kind, 'took-lead');
  assert.equal(meaning([old, deleted], 'prior').status, 'unavailable');
  const corrected = { ...goal, revision: 2, arrivedAt: 25, result: false, outcome: 'blocked' };
  assert.equal(meaning([goal, corrected], 'goal').kind, 'no-goal');
  assert.equal(meaning([goal, corrected], 'goal').corrected, true);
  assert.equal(
    meaning(
      [
        { ...goal, result: null },
        { ...goal, revision: 2, arrivedAt: 25 },
      ],
      'goal',
    ).corrected,
    false,
  );
});

test('meaningful revisions are distinguished from routine pass and shot confirmations', () => {
  const pending = event('shot', 20, 'shot', null),
    confirmed = { ...pending, revision: 2, arrivedAt: 21, result: true };
  assert.equal(meaning([pending, confirmed], 'shot').corrected, false);
  const renamed = { ...confirmed, revision: 3, arrivedAt: 22, player: 'J. Cole' };
  assert.equal(meaning([pending, confirmed, renamed], 'shot').corrected, true);
  assert.equal(meaning([renamed], 'shot').corrected, false);
});

test('same-time goals cannot invent an ordering that establishes who took the lead', () => {
  const output = meaning([event('a', 20), event('b', 20, 'shot', true, { team: 'away' })], 'a');
  assert.equal(output.kind, null);
  assert.equal(output.why, null);
  assert.equal(output.score.home, 1);
  assert.equal(output.score.away, 1);
});

test('a connected recovery and completed passes produce a chronological journey', () => {
  const rows = [
    event('r', 10, 'recovery', false, { player: 'J. Cole' }),
    event('p', 12, 'pass', true),
    event('s', 20),
  ];
  const output = meaning([...rows].reverse(), 's');
  assert.match(output.buildup, /J\. Cole.*one completed pass.*10 seconds/);
  assert.deepEqual(
    output.steps.map((step) => step.id),
    ['r', 'p', 's'],
  );
  assert.deepEqual(
    output.steps.map((step) => step.time),
    [10, 12, 20],
  );
  assert.equal(output.evidence.length, 3);
  assert.doesNotMatch(output.buildup, /caused|pressure|counterattack/);
});

test('opponent touches, failed passes, ambiguous recovery and old recovery break the journey', () => {
  const rows = [event('r', 10, 'recovery', false), event('p', 12, 'pass', true), event('s', 20)];
  for (const breakEvent of [
    event('opp', 11, 'receive', false, { team: 'away' }),
    event('fail', 15, 'pass', false),
    event('pending', 15, 'pass', null),
    event('r2', 10, 'recovery', false),
    event('attempt', 15, 'shot', false),
  ]) {
    assert.equal(meaning([...rows, breakEvent], 's').buildup, null);
  }
  assert.equal(
    meaning([{ ...rows[0], time: 1, arrivedAt: 1 }, ...rows.slice(1)], 's').buildup,
    null,
  );
});

test('an explicitly linked reception explains a shot even without a recent recovery', () => {
  const rows = [
    event('p', 8, 'pass', true, { player: 'J. Cole', playerId: 'home-7', receiverId: 'home-10' }),
    event('r', 12, 'receive', false, { playerId: 'home-10' }),
    event('s', 16, 'shot', false, { playerId: 'home-10' }),
  ];
  const output = meaning(rows, 's');
  assert.match(output.buildup, /received J\. Cole's pass 4 seconds/);
  assert.deepEqual(
    output.steps.map((step) => step.id),
    ['p', 'r', 's'],
  );
  for (const interruption of [
    event('opponent', 10, 'receive', false, { team: 'away' }),
    event('touch', 14, 'receive', false, { playerId: 'home-7' }),
    event('pass2', 13, 'pass', true),
  ])
    assert.equal(meaning([...rows, interruption], 's').buildup, null);
  assert.equal(
    meaning([{ ...rows[0], receiverId: 'home-9' }, ...rows.slice(1)], 's').buildup,
    null,
  );
});

test('a correction moving an event beyond the anchor removes it before score and sequence calculations', () => {
  const old = event('prior', 5),
    moved = { ...old, time: 25, arrivedAt: 30, revision: 2 },
    anchor = event('anchor', 20);
  const output = meaning([old, moved, anchor], 'anchor');
  assert.equal(output.kind, 'took-lead');
  assert.equal(output.evidence.length, 1);
});

test('routine involvement does not turn an arbitrary event count into a story', () => {
  const rows = [event('r', 1, 'recovery', false), event('p', 3, 'pass', true)];
  const output = meaning(rows, 'p');
  assert.equal(output.status, 'context');
  assert.equal(output.why, null);
  assert.equal(output.buildup, null);
});

test('a material shot-pattern change is bounded at the selected event', () => {
  const rows = [
    event('s1', 40, 'shot', false),
    event('s2', 50, 'shot', false),
    event('p', 60, 'pass', true),
    event('future', 80),
  ];
  const output = meaning(rows, 'p');
  assert.equal(output.kind, 'shot-pattern');
  assert.match(output.why, /0 shots.*2 shots/);
  assert.ok(output.evidence.every((ref) => ref.id !== 'future'));
});

test('all four languages localize consequence and buildup without altering their evidence', () => {
  const rows = [event('r', 10, 'recovery', false), event('p', 12, 'pass', true), event('s', 20)];
  const outputs = ['en', 'es', 'fr', 'pt'].map((language) => meaning(rows, 's', { language }));
  assert.equal(new Set(outputs.map((output) => output.why)).size, 4);
  assert.equal(new Set(outputs.map((output) => output.buildup)).size, 4);
  for (const output of outputs) {
    assert.deepEqual(output.evidence, outputs[0].evidence);
    assert.match(output.why, /0–0.*1–0/);
  }
  assert.equal(meaning(rows, 's', { language: 'unknown' }).language, 'en');
});

test('actual sustained passage produces bounded, current explanations at each shot', () => {
  const feed = integratedFeed('sustained', 17);
  for (const shot of feed.events.filter((e) => e.type === 'shot')) {
    const output = meaning(feed.events, shot.id, { observedAt: shot.arrivedAt });
    assert.notEqual(output.status, 'unavailable');
    assert.equal(output.scope.eventTime, shot.time);
    for (const reference of output.evidence) {
      const event = feed.events.find(
        (e) => e.id === reference.id && e.revision === reference.revision,
      );
      assert.ok(event.time <= shot.time && event.arrivedAt <= shot.arrivedAt);
    }
  }
});

test('the pure function leaves input records untouched and rejects conflicting current revisions', () => {
  const rows = [event('shot', 20)],
    before = JSON.stringify(rows);
  meaning(rows, 'shot');
  assert.equal(JSON.stringify(rows), before);
  assert.throws(() => meaning([rows[0], { ...rows[0], result: false }], 'shot'), /Conflicting/);
  assert.throws(() => momentMeaning(rows, 'shot', {}), RangeError);
});
