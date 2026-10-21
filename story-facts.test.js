import test from 'node:test';
import assert from 'node:assert/strict';
import { storyFacts } from './story-facts.js';
import { createInvestigationTools } from './investigation-tools.js';
import { comparisonFixture } from './comparison-fixture.js';
import { matchChange } from './match-change.js';
import { matchPicture } from './match-picture.js';

const input = { kind: 'extended', seed: 101, time: 30, anchorId: 'extended-101-0-shot' };
function outputs(
  request = input,
  names = ['get_event_sequence', 'score_at_moment', 'measure_moment', 'get_match_patterns'],
) {
  const tools = createInvestigationTools(request);
  return Object.fromEntries(names.map((name) => [name, tools.execute(name, {})]));
}

const comparativeInput = {
  kind: 'sustained',
  seed: 17,
  time: 120,
  anchorId: 'comparison-sustained-17-shot-116',
};
test('comparative fact independently matches exact counts and complete received window inventory', () => {
  const received = outputs(comparativeInput),
    saved = structuredClone(received),
    catalog = storyFacts(received);
  const fact = catalog.facts.find((f) => f.kind === 'window-shot-change');
  assert.ok(fact);
  assert.deepEqual(fact.values, {
    team: 'home',
    previousCount: 1,
    recentCount: 3,
    previousStart: 56,
    previousEnd: 86,
    recentStart: 86,
    recentEnd: 116,
    direction: 'increase',
  });
  assert.equal(fact.evidence.length, 25);
  const expected = [
    'flight-107@1',
    'flight-75@1',
    'flight-97@1',
    'pass-100@2',
    'pass-102@2',
    'pass-110@2',
    'pass-62@2',
    'pass-68@2',
    'pass-80@2',
    'pass-90@2',
    'receive-104@1',
    'receive-114@1',
    'receive-60@1',
    'receive-72@1',
    'receive-84@1',
    'receive-94@1',
    'recovery-102@1',
    'recovery-108@1',
    'recovery-66@1',
    'recovery-76@1',
    'recovery-98@1',
    'shot-106@1',
    'shot-116@2',
    'shot-74@1',
    'shot-96@2',
  ];
  assert.deepEqual(
    fact.evidence.map((ref) => `${ref.id}@${ref.revision}`),
    expected.map((suffix) => `comparison-sustained-17-${suffix}`),
  );
  assert.ok(fact.evidence.some((ref) => ref.id === 'comparison-sustained-17-receive-72'));
  assert.ok(
    fact.evidence.some((ref) => ref.id === comparativeInput.anchorId && ref.revision === 2),
    'Confirmed goal anchor supports full recent inventory',
  );
  assert.ok(
    fact.evidence.some(
      (ref) => ref.id === 'comparison-sustained-17-shot-116' && ref.revision === 2,
    ),
  );
  assert.deepEqual(received, saved);
});

test('comparative facts reject inflated counts, unavailable inventory, unequal windows and forged signals', () => {
  const original = outputs(comparativeInput);
  for (const mutate of [
    (p) => (p.comparison.teams[0].recentShots = 99),
    (p) => (p.comparison.signal.delta = 99),
    (p) => (p.comparison.signal.direction = 'pressure'),
    (p) => p.comparison.windows.previous.start++,
    (p) => p.comparison.windows.recent.evidence.pop(),
    (p) => p.comparisonInputs.pop(),
    (p) => (p.comparisonInputs[0].arrivedAt = 121),
    (p) => (p.comparison.scope.observedAt = 119),
    (p) =>
      (p.references = p.references.filter(
        (ref) => ref.id !== 'comparison-sustained-17-receive-72',
      )),
    (p) => (p.comparison.teams = {}),
  ]) {
    const changed = structuredClone(original);
    mutate(changed.get_match_patterns);
    assert.equal(
      storyFacts(changed).facts.some((f) => f.kind === 'window-shot-change'),
      false,
    );
  }
});

test('late revised window evidence changes fact identity, and withdrawal removes the comparative signal', () => {
  const original = outputs(comparativeInput),
    raw = comparisonFixture().events;
  const refresh = (received, records) => {
    const picture = matchPicture(records, 120),
      dictionary = new Map(
        records
          .filter((row) => row.arrivedAt <= 120)
          .map((row) => [`${row.id}@${row.revision}`, row]),
      );
    const current = picture.evidence.map((ref) => dictionary.get(`${ref.id}@${ref.revision}`));
    const comparison = matchChange(records, 116, { observedAt: 120 }),
      pattern = received.get_match_patterns;
    pattern.comparison = {
      status: comparison.status,
      time: comparison.time,
      scope: comparison.scope,
      windows: comparison.windows,
      teams: comparison.teams,
      signal: comparison.signal,
    };
    pattern.comparisonInputs = current
      .filter((row) => row.time > 56 && row.time <= 116)
      .map(({ id, revision, time, arrivedAt, type, team }) => ({
        id,
        revision,
        time,
        arrivedAt,
        type,
        team,
      }));
    pattern.references = [
      ...new Map(
        [
          ...pattern.references,
          ...comparison.windows.previous.evidence,
          ...comparison.windows.recent.evidence,
        ].map((ref) => [ref.id, ref]),
      ).values(),
    ];
  };
  const first = storyFacts(original).facts.find((f) => f.kind === 'window-shot-change'),
    shot = raw.find((row) => row.id === 'comparison-sustained-17-shot-96' && row.revision === 2);
  const corrected = structuredClone(original);
  refresh(corrected, [...raw, { ...shot, revision: 3, arrivedAt: 120, outcome: 'blocked' }]);
  const next = storyFacts(corrected).facts.find((f) => f.kind === 'window-shot-change');
  assert.ok(next);
  assert.notEqual(next.id, first.id);
  assert.ok(next.evidence.some((ref) => ref.id === shot.id && ref.revision === 3));
  const withdrawn = structuredClone(original);
  refresh(withdrawn, [
    ...raw,
    { id: shot.id, revision: 3, time: 96, arrivedAt: 120, operation: 'delete' },
  ]);
  assert.equal(
    storyFacts(withdrawn).facts.some((f) => f.kind === 'window-shot-change'),
    false,
  );
});

test('specific shot wording is grounded in a confirmed explicit outcome, never inferred from no goal', () => {
  const request = { kind: 'extended', seed: 17, time: 122, anchorId: 'extended-17-3-shot' };
  const received = outputs(request, ['get_event_sequence']);
  const moment = storyFacts(received).facts.find((f) => f.kind === 'moment');
  assert.equal(moment.values.outcome, 'no-goal');
  assert.equal(moment.values.shotOutcome, 'off-target');
  assert.deepEqual(moment.evidence, [{ type: 'event', id: request.anchorId, revision: 2 }]);
  for (const outcome of ['off-target', 'saved', 'blocked', 'on-target']) {
    const changed = structuredClone(received);
    changed.get_event_sequence.events.find((e) => e.id === request.anchorId).outcome = outcome;
    assert.equal(
      storyFacts(changed).facts.find((f) => f.kind === 'moment').values.shotOutcome,
      outcome,
    );
  }
  for (const result of [undefined, null, true]) {
    const changed = structuredClone(received);
    Object.assign(
      changed.get_event_sequence.events.find((e) => e.id === request.anchorId),
      { result, outcome: 'saved' },
    );
    assert.equal(
      Object.hasOwn(
        storyFacts(changed).facts.find((f) => f.kind === 'moment').values,
        'shotOutcome',
      ),
      false,
    );
  }
  const generic = structuredClone(received);
  generic.get_event_sequence.events.find((e) => e.id === request.anchorId).outcome =
    'not-specified';
  assert.equal(
    Object.hasOwn(storyFacts(generic).facts.find((f) => f.kind === 'moment').values, 'shotOutcome'),
    false,
  );
});

test('catalog gives received outcome, exact boundary chronology and completed-pass support', () => {
  const catalog = storyFacts(outputs());
  const moment = catalog.facts.find((f) => f.kind === 'moment');
  assert.equal(moment.values.outcome, 'goal');
  assert.equal(moment.values.time, 28);
  assert.deepEqual(moment.evidence, [{ type: 'event', id: input.anchorId, revision: 2 }]);
  const chronology = catalog.facts.find((f) => f.kind === 'recovery-before-shot');
  assert.equal(chronology.values.seconds, 8);
  assert.equal(chronology.evidence.length, 2);
  const passes = catalog.facts.find((f) => f.kind === 'completed-passes-between');
  assert.equal(passes.values.count, 1);
  assert.deepEqual(
    new Set(passes.evidence.map((r) => r.id)),
    new Set(['extended-101-0-recovery', 'extended-101-0-pass', input.anchorId]),
  );
  assert.equal(passes.evidence.find((r) => r.id === 'extended-101-0-pass').revision, 2);
  assert.ok(catalog.facts.length <= 12);
});

test('score cites every goal, including goals outside the selected moment sequence', () => {
  const catalog = storyFacts(outputs({ ...input, time: 330, anchorId: 'extended-101-10-shot' }));
  const tally = catalog.facts.find((f) => f.kind === 'score');
  assert.deepEqual(tally.values, { time: 328, home: 2, away: 1 });
  assert.deepEqual(
    tally.evidence.map((r) => r.id),
    ['extended-101-0-shot', 'extended-101-10-shot', 'extended-101-5-shot'],
  );
});

test('spatial facts keep exact metric values, intervals and every input revision', () => {
  const received = outputs();
  const catalog = storyFacts(received);
  for (const [kind, metricKind] of [
    ['nearest-sampled-opponent', 'nearest-opponent'],
    ['player-sample-displacement-rate', 'player-displacement-rate'],
  ]) {
    const fact = catalog.facts.find((f) => f.kind === kind),
      metric = received.measure_moment.metrics.find((m) => m.kind === metricKind);
    assert.equal(fact.values.value, metric.value);
    assert.deepEqual(
      new Set(fact.evidence.map((r) => `${r.type}:${r.id}@${r.revision}`)),
      new Set(
        [{ type: 'metric', id: metric.id, revision: metric.revision }, ...metric.inputs].map(
          (r) => `${r.type}:${r.id}@${r.revision}`,
        ),
      ),
    );
  }
  const rate = catalog.facts.find((f) => f.kind === 'player-sample-displacement-rate');
  assert.equal(rate.values.start, 27);
  assert.equal(rate.values.end, 28);
});

test('partial tool gathering never creates absent facts; zero count and zero-score facts are omitted', () => {
  const sequenceOnly = storyFacts(outputs(input, ['get_event_sequence']));
  assert.ok(sequenceOnly.facts.every((f) => f.sourceTool === 'get_event_sequence'));
  const earlier = storyFacts(outputs({ ...input, time: 22, anchorId: 'extended-101-0-pass' }));
  assert.ok(!earlier.facts.some((f) => f.kind === 'score'));
  assert.ok(
    earlier.facts.filter((f) => f.kind === 'window-event-count').every((f) => f.values.count > 0),
  );
  const catalog = storyFacts({}, { anchorId: 'none', eventTime: 0, observedAt: 0 });
  assert.deepEqual(catalog.facts, []);
});

test('pattern counts retain all count inputs and inclusive window boundaries', () => {
  const received = outputs({ ...input, time: 330, anchorId: 'extended-101-10-shot' });
  const catalog = storyFacts(received);
  for (const fact of catalog.facts.filter((f) => f.kind === 'window-event-count')) {
    const count = received.get_match_patterns.analysis.metrics.find(
      (m) => m.team === fact.values.team && m.kind === fact.values.category,
    );
    assert.equal(fact.values.count, count.value);
    assert.equal(fact.evidence.length, count.value);
    assert.equal(fact.values.start, 208);
    assert.equal(fact.values.end, 328);
    assert.equal(fact.values.inclusive, true);
    assert.deepEqual(
      new Set(fact.evidence.map((r) => r.id)),
      new Set(count.evidence.map((r) => r.id)),
    );
  }
});

test('corrections invalidate fact IDs while supplied inputs remain unchanged', () => {
  const before = outputs({ ...input, time: 29 }),
    after = outputs();
  const saved = structuredClone(after);
  const previous = storyFacts(before),
    current = storyFacts(after);
  assert.notEqual(
    previous.facts.find((f) => f.kind === 'moment').id,
    current.facts.find((f) => f.kind === 'moment').id,
  );
  assert.notEqual(
    previous.facts.find((f) => f.kind === 'nearest-sampled-opponent').id,
    current.facts.find((f) => f.kind === 'nearest-sampled-opponent').id,
  );
  assert.deepEqual(after, saved);
  assert.deepEqual(storyFacts(after), current);
});

test('missing or stale required support suppresses whole facts instead of weakening citations', () => {
  const received = outputs();
  received.get_event_sequence.references = received.get_event_sequence.references.filter(
    (r) => !r.id.endsWith('-pass'),
  );
  received.measure_moment.references = received.measure_moment.references.filter(
    (r) => r.type !== 'frame',
  );
  const catalog = storyFacts(received);
  assert.ok(!catalog.facts.some((f) => f.kind === 'completed-passes-between'));
  assert.ok(!catalog.facts.some((f) => f.sourceTool === 'measure_moment'));
  assert.ok(catalog.facts.some((f) => f.kind === 'moment'));
});

test('an opposing recovery at either chronology boundary prevents an uninterrupted buildup claim', () => {
  const received = outputs(input, ['get_event_sequence']);
  const recovery = {
    ...received.get_event_sequence.events.find((e) => e.type === 'recovery'),
    id: 'opposing',
    team: 'away',
  };
  received.get_event_sequence.events.push(recovery);
  received.get_event_sequence.references.push({
    type: 'event',
    id: recovery.id,
    revision: recovery.revision,
  });
  assert.ok(
    !storyFacts(received).facts.some((f) =>
      ['recovery-before-shot', 'completed-passes-between'].includes(f.kind),
    ),
  );
});

test('unreceived events, unsupported scopes and inconsistent score records cannot provide facts', () => {
  const received = outputs();
  received.get_event_sequence.events.find((e) => e.id === input.anchorId).arrivedAt = 100;
  received.score_at_moment.score.home = 99;
  const facts = storyFacts(received).facts;
  assert.ok(
    !facts.some((f) =>
      ['moment', 'score', 'recovery-before-shot', 'completed-passes-between'].includes(f.kind),
    ),
  );
  assert.throws(() => storyFacts(null), TypeError);
  assert.throws(
    () => storyFacts({}, { anchorId: 'none', eventTime: 2, observedAt: 1 }),
    RangeError,
  );
});

test('mixed observation scopes cannot silently combine stale measurements with corrected events', () => {
  const received = outputs();
  received.measure_moment = outputs({ ...input, time: 29 }).measure_moment;
  const facts = storyFacts(received).facts;
  assert.ok(facts.some((f) => f.kind === 'moment'));
  assert.ok(!facts.some((f) => f.sourceTool === 'measure_moment'));
});

test('repeated citations cannot support an inflated event count', () => {
  const received = outputs();
  const count = received.get_match_patterns.analysis.metrics.find(
    (m) => m.kind === 'completedPasses' && m.team === 'home',
  );
  count.value = 2;
  count.evidence.push({ ...count.evidence[0] });
  assert.ok(
    !storyFacts(received).facts.some(
      (f) =>
        f.kind === 'window-event-count' &&
        f.values.category === 'completedPasses' &&
        f.values.team === 'home',
    ),
  );
});

function scoreChangeOutputs(beforeHome, beforeAway, team = 'home') {
  const anchor = {
    id: 'current-goal',
    revision: 2,
    time: 20,
    arrivedAt: 21,
    team,
    type: 'shot',
    result: true,
    player: 'A. Reed',
    playerId: 'home-10',
  };
  const scope = { anchorId: anchor.id, eventTime: 20, observedAt: 21 };
  const goals = [
    ...Array.from({ length: beforeHome }, (_, i) => ({
      id: `home-goal-${i}`,
      revision: 1,
      time: i + 1,
      arrivedAt: i + 1,
      team: 'home',
      type: 'shot',
      result: true,
    })),
    ...Array.from({ length: beforeAway }, (_, i) => ({
      id: `away-goal-${i}`,
      revision: 1,
      time: i + 10,
      arrivedAt: i + 10,
      team: 'away',
      type: 'shot',
      result: true,
    })),
    anchor,
  ];
  const reference = (e) => ({ type: 'event', id: e.id, revision: e.revision });
  return {
    get_event_sequence: { scope, events: [anchor], references: [reference(anchor)] },
    score_at_moment: {
      scope,
      goals,
      score: {
        home: beforeHome + (team === 'home' ? 1 : 0),
        away: beforeAway + (team === 'away' ? 1 : 0),
      },
      references: goals.map(reference),
    },
  };
}

test('goal score significance derives all four effects for both teams with complete score support', () => {
  for (const team of ['home', 'away'])
    for (const [effect, own, other] of [
      ['equalized', 0, 1],
      ['took-lead', 1, 1],
      ['extended-lead', 2, 1],
      ['reduced-deficit', 0, 2],
    ]) {
      const beforeHome = team === 'home' ? own : other,
        beforeAway = team === 'away' ? own : other;
      const received = scoreChangeOutputs(beforeHome, beforeAway, team),
        catalog = storyFacts(received);
      const change = catalog.facts.find((f) => f.kind === 'goal-score-change');
      assert.deepEqual(change.values, {
        anchorId: 'current-goal',
        time: 20,
        team,
        player: 'A. Reed',
        beforeHome,
        beforeAway,
        afterHome: received.score_at_moment.score.home,
        afterAway: received.score_at_moment.score.away,
        effect,
      });
      assert.equal(change.evidence.length, beforeHome + beforeAway + 1);
      assert.deepEqual(
        new Set(change.evidence.map((r) => `${r.id}@${r.revision}`)),
        new Set(received.score_at_moment.references.map((r) => `${r.id}@${r.revision}`)),
      );
      assert.equal(catalog.facts[0].kind, 'moment');
      assert.ok(catalog.facts.indexOf(change) < catalog.facts.findIndex((f) => f.kind === 'score'));
      assert.doesNotMatch(change.text, /winning goal|match winner|won the match/i);
    }
});

test('score significance is omitted without both executed tools, received anchor support or complete goal citations', () => {
  const received = scoreChangeOutputs(1, 0);
  for (const packet of [
    { get_event_sequence: received.get_event_sequence },
    { score_at_moment: received.score_at_moment },
  ])
    assert.ok(!storyFacts(packet).facts.some((f) => f.kind === 'goal-score-change'));
  for (const mutate of [
    (packet) => packet.score_at_moment.references.shift(),
    (packet) => packet.get_event_sequence.references.splice(0),
    (packet) => (packet.get_event_sequence.events[0].result = null),
    (packet) => (packet.get_event_sequence.events[0].arrivedAt = 22),
    (packet) => (packet.score_at_moment.scope.observedAt = 20),
    (packet) => (packet.score_at_moment.goals.at(-1).revision = 1),
    (packet) => {
      packet.score_at_moment.goals.push({ ...packet.score_at_moment.goals[0] });
      packet.score_at_moment.score.home++;
    },
  ]) {
    const packet = structuredClone(received);
    mutate(packet);
    assert.ok(!storyFacts(packet).facts.some((f) => f.kind === 'goal-score-change'));
  }
});

test('simultaneous other goals suppress score-order claims rather than choosing an arbitrary event order', () => {
  const received = scoreChangeOutputs(0, 0);
  const other = {
    id: 'simultaneous',
    revision: 1,
    time: 20,
    arrivedAt: 20,
    team: 'away',
    type: 'shot',
    result: true,
  };
  received.score_at_moment.goals.push(other);
  received.score_at_moment.references.push({ type: 'event', id: other.id, revision: 1 });
  received.score_at_moment.score.away = 1;
  const catalog = storyFacts(received);
  assert.ok(!catalog.facts.some((f) => f.kind === 'goal-score-change'));
  assert.ok(catalog.facts.some((f) => f.kind === 'score'));
});

test('score significance identities follow anchor and earlier-goal corrections without mutating received inputs', () => {
  const before = scoreChangeOutputs(1, 0),
    saved = structuredClone(before);
  const original = storyFacts(before).facts.find((f) => f.kind === 'goal-score-change');
  const anchorCorrection = structuredClone(before);
  for (const output of Object.values(anchorCorrection)) {
    for (const event of output.events || output.goals)
      if (event.id === 'current-goal') {
        event.revision = 3;
        event.player = 'J. Cole';
      }
    for (const ref of output.references) if (ref.id === 'current-goal') ref.revision = 3;
  }
  const corrected = storyFacts(anchorCorrection).facts.find((f) => f.kind === 'goal-score-change');
  assert.notEqual(corrected.id, original.id);
  assert.equal(corrected.values.player, 'J. Cole');
  assert.equal(corrected.evidence.find((r) => r.id === 'current-goal').revision, 3);
  const earlierCorrection = structuredClone(before);
  earlierCorrection.score_at_moment.goals.shift();
  earlierCorrection.score_at_moment.references.shift();
  earlierCorrection.score_at_moment.score.home = 1;
  const changed = storyFacts(earlierCorrection).facts.find((f) => f.kind === 'goal-score-change');
  assert.equal(changed.values.effect, 'took-lead');
  assert.notEqual(changed.id, original.id);
  assert.deepEqual(before, saved);
});

test('confirmed central and wide passes expose exact sampled endpoint separation with all inputs', () => {
  for (const kind of ['central', 'wide']) {
    const request = { kind, seed: 17, time: 4, anchorId: `${kind}-17-receive` };
    const registry = createInvestigationTools(request),
      packet = outputs(request, ['get_event_sequence', 'measure_moment']);
    const fact = storyFacts(packet).facts.find((f) => f.kind === 'pass-endpoint-displacement');
    const metric = packet.measure_moment.metrics.find((m) => m.kind === 'pass-displacement');
    const frames = registry.execute('get_position_samples', {}).positions;
    const start = frames.find((f) => f.time === 2),
      end = frames.find((f) => f.time === 4);
    assert.equal(
      fact.values.value,
      Math.hypot(end.ball.x - start.ball.x, end.ball.y - start.ball.y),
    );
    assert.deepEqual(fact.values, {
      anchorId: request.anchorId,
      passId: `${kind}-17-pass`,
      start: 2,
      end: 4,
      value: metric.value,
      unit: 'metres',
      formula: 'ball-endpoint-displacement-v1',
    });
    assert.deepEqual(
      new Set(fact.evidence.map(identity)),
      new Set(
        [{ type: 'metric', id: metric.id, revision: metric.revision }, ...metric.inputs].map(
          identity,
        ),
      ),
    );
    assert.equal(fact.evidence.length, 5);
    assert.match(fact.text, /Endpoint separation is not the actual ball path/);
  }
});
const identity = (ref) => `${ref.type}:${ref.id}@${ref.revision}`;

test('confirmed-pass facts reject pending outcomes, wrong participants, interruptions and incomplete metric support', () => {
  const request = { kind: 'central', seed: 17, time: 4, anchorId: 'central-17-receive' };
  const received = outputs(request, ['get_event_sequence', 'measure_moment']);
  const pass = (packet) => packet.get_event_sequence.events.find((e) => e.type === 'pass');
  const anchor = (packet) =>
    packet.get_event_sequence.events.find((e) => e.id === request.anchorId);
  const metric = (packet) =>
    packet.measure_moment.metrics.find((m) => m.kind === 'pass-displacement');
  const mutations = [
    (packet) => (pass(packet).result = null),
    (packet) => delete pass(packet).result,
    (packet) => (pass(packet).receiverId = 'another-player'),
    (packet) => (anchor(packet).type = 'shot'),
    (packet) => {
      delete pass(packet).receiverId;
      delete anchor(packet).playerId;
    },
    (packet) => (metric(packet).passId = 'unrelated'),
    (packet) => (metric(packet).interval.start = 1),
    (packet) => (metric(packet).formula = 'unsupported'),
    (packet) => (metric(packet).unit = 'kilometres'),
    (packet) => metric(packet).inputs.splice(2, 1),
    (packet) => (metric(packet).inputs[2] = null),
    (packet) => (metric(packet).inputs[3] = { ...metric(packet).inputs[2] }),
    (packet) =>
      packet.measure_moment.references.splice(
        packet.measure_moment.references.findIndex((r) => r.type === 'frame'),
        1,
      ),
    (packet) =>
      packet.get_event_sequence.references.splice(
        packet.get_event_sequence.references.findIndex((r) => r.id.endsWith('-pass')),
        1,
      ),
  ];
  for (const mutate of mutations) {
    const packet = structuredClone(received);
    mutate(packet);
    assert.ok(!storyFacts(packet).facts.some((f) => f.kind === 'pass-endpoint-displacement'));
  }
  for (const time of [2, 3, 4]) {
    const packet = structuredClone(received),
      opponent = {
        id: 'opponent-recovery',
        revision: 1,
        type: 'recovery',
        team: 'away',
        time,
        arrivedAt: time,
      };
    packet.get_event_sequence.events.push(opponent);
    packet.get_event_sequence.references.push({ type: 'event', id: opponent.id, revision: 1 });
    assert.ok(!storyFacts(packet).facts.some((f) => f.kind === 'pass-endpoint-displacement'));
  }
  assert.ok(
    !storyFacts({ measure_moment: received.measure_moment }).facts.some(
      (f) => f.kind === 'pass-endpoint-displacement',
    ),
  );
});

test('linked shot-flight facts retain exact sampled ball rate and corrected shot/frame references', () => {
  const request = { kind: 'extended', seed: 17, time: 30, anchorId: 'extended-17-0-flight' };
  const registry = createInvestigationTools(request),
    packet = outputs(request, ['get_event_sequence', 'measure_moment']);
  const fact = storyFacts(packet).facts.find(
    (f) => f.kind === 'shot-ball-sample-displacement-rate',
  );
  const metric = packet.measure_moment.metrics.find(
    (m) => m.kind === 'shot-ball-displacement-rate',
  );
  const frames = registry.execute('get_position_samples', {}).positions,
    start = frames.find((f) => f.time === 28),
    end = frames.find((f) => f.time === 29);
  assert.equal(
    fact.values.value,
    Math.hypot(end.ball.x - start.ball.x, end.ball.y - start.ball.y) / (end.time - start.time),
  );
  assert.deepEqual(fact.values, {
    anchorId: request.anchorId,
    shotId: 'extended-17-0-shot',
    start: 28,
    end: 29,
    value: metric.value,
    unit: 'metres/second',
    formula: 'shot-sample-displacement-over-time-v1',
  });
  assert.equal(fact.evidence.length, 5);
  assert.deepEqual(
    new Set(fact.evidence.map(identity)),
    new Set(
      [{ type: 'metric', id: metric.id, revision: metric.revision }, ...metric.inputs].map(
        identity,
      ),
    ),
  );
  assert.equal(fact.evidence.find((r) => r.id === 'extended-17-0-shot').revision, 2);
  assert.equal(fact.evidence.find((r) => r.id === 'extended-17-frame-28').revision, 2);
  const earlier = storyFacts(
    outputs({ ...request, time: 29 }, ['get_event_sequence', 'measure_moment']),
  ).facts.find((f) => f.kind === 'shot-ball-sample-displacement-rate');
  assert.notEqual(earlier.id, fact.id);
  assert.match(fact.text, /sampled interval, not maximum speed/);
});

test('shot-ball rate facts require the exact received shot-flight link, interval and complete references', () => {
  const request = { kind: 'extended', seed: 17, time: 30, anchorId: 'extended-17-0-flight' };
  const received = outputs(request, ['get_event_sequence', 'measure_moment']);
  const anchor = (packet) =>
    packet.get_event_sequence.events.find((e) => e.id === request.anchorId);
  const shot = (packet) => packet.get_event_sequence.events.find((e) => e.type === 'shot');
  const metric = (packet) =>
    packet.measure_moment.metrics.find((m) => m.kind === 'shot-ball-displacement-rate');
  for (const mutate of [
    (packet) => (anchor(packet).shotId = 'wrong'),
    (packet) => (anchor(packet).type = 'receive'),
    (packet) => (metric(packet).shotId = 'wrong'),
    (packet) => (shot(packet).type = 'pass'),
    (packet) => (metric(packet).interval.start = 27),
    (packet) => (metric(packet).interval.end = 30),
    (packet) => (metric(packet).unit = 'metres'),
    (packet) => (metric(packet).formula = 'unsupported'),
    (packet) => metric(packet).inputs.splice(3, 1),
    (packet) =>
      packet.get_event_sequence.references.splice(
        packet.get_event_sequence.references.findIndex((r) => r.id.endsWith('-shot')),
        1,
      ),
    (packet) =>
      packet.measure_moment.references.splice(
        packet.measure_moment.references.findIndex(
          (r) => r.type === 'metric' && r.id === metric(packet).id,
        ),
        1,
      ),
  ]) {
    const packet = structuredClone(received);
    mutate(packet);
    assert.ok(
      !storyFacts(packet).facts.some((f) => f.kind === 'shot-ball-sample-displacement-rate'),
    );
  }
  assert.ok(
    !storyFacts({ measure_moment: received.measure_moment }).facts.some(
      (f) => f.kind === 'shot-ball-sample-displacement-rate',
    ),
  );
});
