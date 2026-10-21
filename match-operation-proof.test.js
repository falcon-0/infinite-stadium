import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalOperationSelection,
  executeOperationPlan,
  operationPlanSchema,
} from './match-operation-proof.js';
import { matchState } from './match-stream.js';
import { executeMatchQuery } from './match-query.js';

const input = {
  kind: 'sustained',
  seed: 8341,
  time: 110,
  language: 'en',
  question: 'Which side has completed more passes so far, and by how many?',
};
const operation = (overrides = {}) => ({
  id: 'comparison',
  requestSpan: input.question,
  operator: 'difference',
  metric: 'completedPasses',
  subjects: ['home', 'away'],
  timeFrom: 0,
  timeTo: input.time,
  ...overrides,
});
const plan = (...obligations) => ({ version: 1, obligations });
const run = (obligation = operation(), options = {}, request = input) =>
  executeOperationPlan(request, plan(obligation), options);
const base = {
  time: 20,
  metadata: { id: 'operation-test', teams: { home: 'Home', away: 'Away' } },
  frames: [
    {
      time: 0,
      players: [
        { id: 'h1', name: 'Home One', team: 'home' },
        { id: 'h2', name: 'Home Two', team: 'home' },
        { id: 'a1', name: 'Away One', team: 'away' },
      ],
    },
  ],
  events: [],
};
const request = {
  kind: 'test',
  seed: 1,
  time: 20,
  language: 'en',
  question: 'Compare their attempts.',
};
const op = (overrides = {}) =>
  operation({ requestSpan: request.question, metric: 'attempts', timeTo: 20, ...overrides });
const event = (id, time, overrides = {}) => ({
  id,
  revision: 1,
  time,
  arrivedAt: time,
  type: 'shot',
  team: 'home',
  playerId: 'h1',
  player: 'Home One',
  result: false,
  outcome: 'saved',
  ...overrides,
});
const rate = (overrides = {}) =>
  op({ operator: 'ratio', metric: 'passCompletionRate', ...overrides });

test('pass completion ratio excludes pending outcomes and proves both team fractions with three scopes', () => {
  const request = {
    kind: 'sustained',
    seed: 84621,
    time: 110,
    language: 'en',
    question: 'What is the passing accuracy for each side?',
  };
  const result = run(
      operation({ operator: 'ratio', metric: 'passCompletionRate', requestSpan: request.question }),
      {},
      request,
    ),
    proof = result.proofs[0];
  assert.equal(result.queryCount, 3);
  assert.equal(proof.status, 'proved');
  const [home, away] = proof.values.teams;
  assert.deepEqual(
    [
      home.completed,
      home.failed,
      home.pending,
      home.numerator,
      home.denominator,
      home.ratio,
      home.displayPercent,
    ],
    [5, 0, 1, 5, 5, 1, '100'],
  );
  assert.deepEqual(
    [away.completed, away.failed, away.pending, away.denominator, away.displayPercent],
    [4, 2, 0, 6, '66.7'],
  );
  assert.equal(proof.values.pendingExcluded, true);
  assert.equal(proof.values.definition, 'completed/(completed+failed)');
  assert.deepEqual(
    proof.evidence,
    result.queryResults.map((q) => q.scopeReference),
  );
  assert.match(
    result.claims[0].text,
    /100%.*5 completed of 5.*1 awaiting.*66.7%.*4 completed of 6/,
  );
  assert.match(result.claims[0].text, /0 awaiting an outcome/);
  assert.ok(Object.isFrozen(proof.values.teams[0]));
});

test('ratio zero denominator is unavailable percentage, not zero percent; failed passes give a real zero', () => {
  const state = {
    ...base,
    events: [
      event('pending', 4, { type: 'pass', result: null }),
      event('failed', 6, { type: 'pass', result: false, team: 'away', playerId: 'a1' }),
    ],
  };
  const result = run(rate(), { state }, request),
    [home, away] = result.proofs[0].values.teams;
  assert.equal(home.denominator, 0);
  assert.equal(home.pending, 1);
  assert.equal(home.ratio, null);
  assert.equal(home.percentage, null);
  assert.equal(home.displayPercent, null);
  assert.equal(away.ratio, 0);
  assert.equal(away.displayPercent, '0');
  assert.match(result.claims[0].text, /Home: percentage unavailable.*Away: 0%/);
  const only = run(rate({ subjects: ['away'] }), { state }, request);
  assert.equal(only.proofs[0].values.teams.length, 1);
  assert.equal(only.proofs[0].values.teams[0].id, 'away');
});

test('ratio rejects missing or malformed classifications and unresolved team partitions', () => {
  for (const bad of [undefined, 'completed', 1]) {
    const record = event('bad', 4, { type: 'pass', result: bad });
    if (bad === undefined) delete record.result;
    const result = run(rate(), { state: { ...base, events: [record] } }, request);
    assert.equal(result.proofs[0].status, 'unavailable');
    assert.equal(result.proofs[0].values, null);
    assert.equal(result.claims[0].kind, 'limitation');
  }
  const result = run(
    rate(),
    {
      state: {
        ...base,
        events: [event('bad-team', 4, { type: 'pass', result: true, team: 'unknown' })],
      },
    },
    request,
  );
  assert.equal(result.proofs[0].status, 'unavailable');
  for (const change of [
    { subjects: ['h1'] },
    { subjects: ['home', 'h1'] },
    { operator: 'difference' },
    { metric: 'completedPasses' },
  ])
    assert.throws(() => run(rate(change), { state: base }, request), RangeError);
});

test('ratio uses current received revisions, deletions and exact window without future leakage', () => {
  const state = {
    ...base,
    events: [
      event('changed', 3, { type: 'pass', result: null }),
      event('changed', 3, { type: 'pass', result: true, revision: 2, arrivedAt: 7 }),
      event('changed', 3, { type: 'pass', result: false, revision: 3, arrivedAt: 30 }),
      event('gone', 8, { type: 'pass', result: false }),
      event('gone', 8, { type: 'pass', operation: 'delete', revision: 2, arrivedAt: 10 }),
      event('pending', 12, { type: 'pass', result: null }),
      event('future', 25, { type: 'pass', result: false }),
      event('invalid-future', 11, { type: 'pass', result: 'invalid', arrivedAt: 30 }),
    ],
  };
  const [home] = run(rate(), { state }, request).proofs[0].values.teams;
  assert.deepEqual([home.completed, home.failed, home.pending], [1, 0, 1]);
  const restricted = run(rate({ timeFrom: 10 }), { state }, request);
  assert.equal(restricted.proofs[0].values.teams[0].denominator, 0);
  assert.match(restricted.claims[0].text, /From 00:10 to 00:20/);
  assert.throws(() => run(rate({ timeTo: 21 }), { state }, request), RangeError);
  assert.throws(
    () => executeOperationPlan(request, plan(rate(), op({ id: 'extra' })), { state }),
    /three distinct queries/,
  );
});

test('ratio localizes canonical fractions in four languages and generalizes across seeds', () => {
  const state = {
    ...base,
    events: [
      event('yes', 1, { type: 'pass', result: true }),
      event('no1', 2, { type: 'pass', result: false }),
      event('no2', 3, { type: 'pass', result: false }),
    ],
  };
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const result = run(rate(), { state }, { ...request, language });
    assert.equal(
      result.proofs[0].values.teams[0].displayPercent,
      language === 'en' ? '33.3' : '33,3',
    );
    assert.match(
      result.claims[0].text,
      language === 'en'
        ? /known outcome/
        : language === 'es'
          ? /resultado conocido/
          : language === 'fr'
            ? /résultat connu/
            : /resultado conhecido/,
    );
  }
  for (const kind of ['sustained', 'counter', 'quiet'])
    for (const seed of [2, 407, 7391]) {
      const request = { kind, seed, time: 110, question: 'Give the completion fraction.' },
        state = matchState(request);
      const result = run(
        operation({
          operator: 'ratio',
          metric: 'passCompletionRate',
          requestSpan: request.question,
        }),
        { state },
        request,
      );
      for (const value of result.proofs[0].values.teams) {
        const passes = state.events.filter((e) => e.type === 'pass' && e.team === value.id);
        assert.equal(value.completed, passes.filter((e) => e.result === true).length);
        assert.equal(value.failed, passes.filter((e) => e.result === false).length);
        assert.equal(value.pending, passes.filter((e) => e.result === null).length);
        assert.equal(value.denominator, value.completed + value.failed);
      }
    }
});

test('operation schema is strict and typed with a two-obligation bound', () => {
  assert.equal(operationPlanSchema.additionalProperties, false);
  assert.equal(operationPlanSchema.properties.obligations.maxItems, 2);
  assert.equal(operationPlanSchema.properties.obligations.items.additionalProperties, false);
  assert.deepEqual(operationPlanSchema.properties.obligations.items.properties.operator.enum, [
    'difference',
    'orderedEndpoints',
    'ratio',
  ]);
});

test('difference computes both operands, signed delta, leader and explicit margin from one complete scope', () => {
  const result = run(),
    proof = result.proofs[0];
  assert.equal(result.queryCount, 1);
  assert.equal(proof.status, 'proved');
  assert.deepEqual(proof.values, {
    left: { id: 'home', label: 'Northbridge', count: 5 },
    right: { id: 'away', label: 'Harbour Athletic', count: 4 },
    signedDelta: 1,
    absoluteMargin: 1,
    leader: 'home',
    tie: false,
  });
  assert.match(
    result.claims[0].text,
    /5 completed passes.*4 completed passes.*Northbridge leads by 1 completed pass/,
  );
  assert.deepEqual(result.claims[0].evidence, [result.queryResults[0].scopeReference]);
  const reversed = run(operation({ subjects: ['away', 'home'] }));
  assert.equal(reversed.proofs[0].values.signedDelta, -1);
  assert.equal(reversed.proofs[0].values.leader, 'home');
  assert.throws(() => {
    result.proofs[0].values.left.count = 9;
  }, TypeError);
  assert.doesNotMatch(result.claims[0].text, /From 00:00/);
  assert.match(
    run(operation({ timeTo: 100 })).claims[0].text,
    /From 00:00 to 01:40/,
    'An earlier cutoff remains visible even when the interval starts at zero',
  );
});

test('complete zero and ties are proved for known teams and known players, not absent identities', () => {
  for (const subjects of [
    ['home', 'away'],
    ['h1', 'a1'],
  ]) {
    const result = run(op({ subjects }), { state: base }, request);
    assert.equal(result.proofs[0].values.signedDelta, 0);
    assert.equal(result.proofs[0].values.leader, null);
    assert.equal(result.proofs[0].values.tie, true);
    assert.match(
      result.claims[0].text,
      /0 attempts.*0 attempts.*Level: a difference of 0 attempts/,
    );
  }
  assert.throws(() => run(op({ subjects: ['h1', 'Messi'] }), { state: base }, request), RangeError);
  const state = {
    ...base,
    events: [event('a', 4), event('b', 8, { playerId: 'h2', player: 'Home Two' }), event('c', 12)],
  };
  const players = run(op({ subjects: ['h1', 'h2'] }), { state }, request);
  assert.equal(players.proofs[0].values.left.count, 2);
  assert.equal(players.proofs[0].values.right.count, 1);
});

test('invalid plans cannot inject values, unknown operations, identities, windows or request spans', () => {
  for (const change of [
    (o) => (o.id = ''),
    (o) => (o.operator = 'eval'),
    (o) => (o.metric = 'possession'),
    (o) => (o.requestSpan = 'a different question'),
    (o) => (o.requestSpan = '?'),
    (o) => (o.subjects = ['home', 'home']),
    (o) => (o.subjects = ['home', 'home-7']),
    (o) => (o.subjects = []),
    (o) => (o.subjects = ['invented', 'away']),
    (o) => (o.timeTo = 111),
    (o) => (o.timeFrom = -1),
    (o) => (o.timeFrom = 111),
    (o) => (o.timeFrom = NaN),
    (o) => (o.values = { left: 9 }),
    (o) => (o.extra = true),
  ]) {
    const obligation = operation();
    change(obligation);
    assert.throws(() => run(obligation), RangeError);
  }
  assert.throws(() => executeOperationPlan(input, plan(operation(), operation())), RangeError);
  assert.throws(() => executeOperationPlan(input, { version: 2, obligations: [] }), RangeError);
  assert.throws(
    () => executeOperationPlan(input, { ...plan(operation()), extra: true }),
    RangeError,
  );
  assert.throws(() => run(operation({ operator: 'orderedEndpoints' })), RangeError);
  assert.equal(
    run(operation({ requestSpan: input.question.slice(0, -1) })).proofs[0].status,
    'proved',
  );
});

test('queries are pinned once, deduplicated and capped before execution at three actual queries', () => {
  let calls = 0;
  const stateFactory = () => {
    calls++;
    return base;
  };
  const obligations = [op(), op({ id: 'ends', operator: 'orderedEndpoints', subjects: [] })];
  const result = executeOperationPlan(request, plan(...obligations), { stateFactory });
  assert.equal(calls, 1);
  assert.equal(result.queryCount, 3);
  assert.equal(
    executeOperationPlan(request, plan(op(), op({ id: 'same' })), { state: base }).queryCount,
    1,
  );
  assert.throws(
    () =>
      executeOperationPlan(
        request,
        plan(
          op({ operator: 'orderedEndpoints', subjects: [] }),
          op({ id: 'player', operator: 'orderedEndpoints', subjects: ['h1'] }),
        ),
        { state: base },
      ),
    RangeError,
  );
  assert.deepEqual(executeOperationPlan(request, plan(), { state: base }).claims, []);
  assert.throws(() => run(op(), { state: { ...base, time: 21 } }, request), RangeError);
  const futureRoster = {
    ...base,
    frames: [
      ...base.frames,
      { time: 21, players: [{ id: 'future', name: 'Future Player', team: 'home' }] },
    ],
  };
  assert.throws(
    () => run(op({ subjects: ['future', 'a1'] }), { state: futureRoster }, request),
    RangeError,
  );
});

test('missing metric classification and unknown actor fields never become zero', () => {
  const missing = { ...base, events: [event('pass', 5, { type: 'pass', result: undefined })] };
  const result = run(op({ metric: 'completedPasses' }), { state: missing }, request);
  assert.equal(result.proofs[0].status, 'unavailable');
  assert.equal(result.proofs[0].values, null);
  assert.equal(result.claims[0].kind, 'limitation');
  const unknown = {
    ...base,
    events: [event('unknown', 5, { playerId: undefined, player: undefined })],
  };
  assert.equal(
    run(op({ subjects: ['h1', 'h2'] }), { state: unknown }, request).proofs[0].status,
    'unavailable',
  );
});

test('two exact player counts remain complete when twenty-two contributing players overflow the group display', () => {
  const players = Array.from({ length: 22 }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    team: i < 11 ? 'home' : 'away',
  }));
  const crowded = {
    ...base,
    frames: [{ time: 0, players }],
    events: players.flatMap((p, i) =>
      Array.from({ length: i === 20 ? 1 : i === 21 ? 2 : 3 }, (_, n) =>
        event(`${p.id}-${n}`, 1 + n, { playerId: p.id, player: p.name, team: p.team }),
      ),
    ),
  };
  const displayed = executeMatchQuery(
    { kind: 'test', seed: 1, time: 20 },
    { filters: { type: 'shot' }, aggregate: 'by-player', limit: 20 },
    { stateFactory: () => crowded },
  );
  assert.equal(displayed.truncated, true);
  assert.ok(!displayed.groups.some((group) => ['p20', 'p21'].includes(group.key)));
  const result = run(op({ subjects: ['p20', 'p21'] }), { state: crowded }, request),
    proof = result.proofs[0];
  assert.equal(result.queryCount, 2);
  assert.equal(proof.status, 'proved');
  assert.equal(proof.values.left.count, 1);
  assert.equal(proof.values.right.count, 2);
  assert.equal(proof.values.signedDelta, -1);
  assert.equal(proof.values.leader, 'p21');
  assert.equal(proof.evidence.length, 2);
  assert.ok(
    result.queryResults.every((query) => query.query.aggregate === 'count' && !query.truncated),
  );
  assert.deepEqual(
    result.queryResults.map((query) => query.entityResolution.player.canonicalId),
    ['p20', 'p21'],
  );
  const team = run(op(), { state: crowded }, request);
  assert.equal(team.queryCount, 1);
  assert.throws(
    () =>
      executeOperationPlan(
        request,
        plan(
          op({ subjects: ['p20', 'p21'] }),
          op({ id: 'ends', operator: 'orderedEndpoints', subjects: [] }),
        ),
        { state: crowded },
      ),
    /at most three/,
  );
  const repeated = executeOperationPlan(
    request,
    plan(op({ subjects: ['p20', 'p21'] }), op({ id: 'reverse', subjects: ['p21', 'p20'] })),
    { state: crowded },
  );
  assert.equal(repeated.queryCount, 2);
  assert.equal(repeated.proofs[1].values.signedDelta, 1);
});

test('filtered player operands preserve metric, window, missing classification and received revisions', () => {
  const pass = event('pass', 5, { type: 'pass', result: false }),
    correction = { ...pass, revision: 2, arrivedAt: 10, result: true };
  const state = {
    ...base,
    events: [
      pass,
      correction,
      { ...pass, revision: 3, arrivedAt: 21, result: false },
      event('future', 21, { type: 'pass', result: true }),
      event('other', 12, {
        type: 'pass',
        result: true,
        playerId: 'a1',
        player: 'Away One',
        team: 'away',
      }),
    ],
  };
  const obligation = op({ subjects: ['h1', 'a1'], metric: 'completedPasses' });
  const result = run(obligation, { state }, request);
  assert.equal(result.proofs[0].values.left.count, 1);
  assert.equal(result.proofs[0].values.right.count, 1);
  const earlier = run({ ...obligation, timeTo: 8 }, { state }, request);
  assert.equal(
    earlier.proofs[0].values.left.count,
    1,
    'Received correction applies to its original event time',
  );
  assert.equal(earlier.proofs[0].values.right.count, 0);
  const recent = run({ ...obligation, timeFrom: 10 }, { state }, request);
  assert.equal(recent.proofs[0].values.left.count, 0);
  assert.equal(recent.proofs[0].values.right.count, 1);
  const missing = run(
    obligation,
    {
      state: {
        ...state,
        events: [...state.events, event('missing', 13, { type: 'pass', result: undefined })],
      },
    },
    request,
  );
  assert.equal(missing.proofs[0].status, 'unavailable');
  const withdrawn = run(
    obligation,
    {
      state: {
        ...state,
        events: [
          ...state.events,
          { ...correction, revision: 4, arrivedAt: 19, operation: 'delete' },
        ],
      },
    },
    request,
  );
  assert.equal(withdrawn.proofs[0].values.left.count, 0);
  assert.throws(
    () => run({ ...obligation, subjects: ['unknown', 'a1'] }, { state }, request),
    RangeError,
  );
  assert.throws(() => run({ ...obligation, timeTo: 21 }, { state }, request), RangeError);
});

test('ordered endpoints prove global, player and team scopes, not current examples or row order', () => {
  const request = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'Compare how the earliest attempt ended with the last one.',
  };
  const obligation = operation({
    requestSpan: request.question,
    operator: 'orderedEndpoints',
    metric: 'attempts',
    subjects: [],
    timeTo: 100,
  });
  const result = run(obligation, {}, request),
    values = result.proofs[0].values;
  assert.equal(result.queryCount, 2);
  assert.equal(values.first.actor.label, 'A. Reed');
  assert.equal(values.first.event.time, 64);
  assert.equal(values.first.outcome, 'saved');
  assert.equal(values.latest.actor.label, 'D. Silva');
  assert.equal(values.latest.event.time, 98);
  assert.equal(values.latest.outcome, 'blocked');
  assert.ok(
    result.queryResults.every((q) => q.query.limit === 1 && q.truncated),
    'Ordered LIMIT1 scopes prove extrema even when list has further rows',
  );
  assert.equal(result.claims[0].evidence.filter((ref) => ref.type === 'scope').length, 2);
  assert.equal(result.claims[0].evidence.filter((ref) => ref.type === 'event').length, 2);
  const player = run({ ...obligation, subjects: ['home-10'] }, {}, request);
  assert.equal(player.proofs[0].values.latest.event.time, 84);
  const team = run({ ...obligation, subjects: ['home'] }, {}, request);
  assert.equal(team.proofs[0].values.latest.actor.id, 'home-10');
});

test('empty endpoint scope cites query absence, while pending and unknown outcomes remain distinct', () => {
  const obligation = op({ operator: 'orderedEndpoints', subjects: [] });
  const empty = run(obligation, { state: base }, request);
  assert.deepEqual(empty.proofs[0].values, { count: 0, first: null, latest: null });
  assert.ok(empty.claims[0].evidence.every((ref) => ref.type === 'scope'));
  const pending = run(
    obligation,
    { state: { ...base, events: [event('pending', 10, { result: null, outcome: 'pending' })] } },
    request,
  );
  assert.equal(pending.proofs[0].values.latest.outcome, 'pending');
  assert.match(pending.claims[0].text, /awaiting an outcome/);
  assert.doesNotMatch(pending.claims[0].text, /confirmed goal|miss/);
  const unknown = run(
    obligation,
    {
      state: { ...base, events: [event('unknown', 10, { result: undefined, outcome: undefined })] },
    },
    request,
  );
  assert.equal(unknown.proofs[0].values.latest.outcome, 'unknown');
  assert.doesNotMatch(unknown.claims[0].text, /awaiting an outcome/);
});

test('event time, arrival time, revisions and deletions determine current endpoints', () => {
  const original = event('same', 5, { result: null, outcome: 'pending' }),
    corrected = { ...original, revision: 2, arrivedAt: 15, result: true, outcome: 'goal' };
  const state = {
    ...base,
    events: [
      corrected,
      event('late', 18),
      original,
      { ...original, revision: 3, arrivedAt: 21, result: false, outcome: 'saved' },
      event('future', 22),
    ],
  };
  const obligation = op({ operator: 'orderedEndpoints', subjects: [] });
  const result = run(obligation, { state }, request);
  assert.equal(result.proofs[0].values.first.event.revision, 2);
  assert.equal(result.proofs[0].values.first.outcome, 'goal');
  assert.equal(result.proofs[0].values.latest.event.id, 'late');
  const withdrawn = run(
    obligation,
    {
      state: {
        ...state,
        events: [
          ...state.events,
          { ...corrected, revision: 4, arrivedAt: 19, operation: 'delete' },
        ],
      },
    },
    request,
  );
  assert.equal(withdrawn.proofs[0].values.count, 1);
  assert.equal(withdrawn.proofs[0].values.first.event.id, 'late');
  const windowed = run({ ...obligation, timeFrom: 10 }, { state }, request);
  assert.equal(windowed.proofs[0].values.first.event.id, 'late');
  assert.notEqual(result.proofs[0].sourceFingerprint, withdrawn.proofs[0].sourceFingerprint);
});

test('credited assists count explicit credited players, never raw team goals or inferred passes', () => {
  const credit = event('goal', 10, {
    result: true,
    outcome: 'goal',
    assist: { playerId: 'h2', player: 'Home Two', passId: 'pass' },
  });
  const state = { ...base, events: [credit] };
  const teams = run(op({ metric: 'creditedAssists' }), { state }, request);
  assert.equal(teams.proofs[0].values.left.count, 1);
  assert.equal(teams.queryResults[0].query.aggregate, 'by-assister');
  const players = run(
    op({ metric: 'creditedAssists', subjects: ['h1', 'h2'] }),
    { state },
    request,
  );
  assert.equal(players.proofs[0].values.left.count, 0);
  assert.equal(players.proofs[0].values.right.count, 1);
  assert.equal(players.queryCount, 2);
  assert.deepEqual(
    players.queryResults.map((query) => query.query.filters.assistPlayer),
    ['h1', 'h2'],
  );
  assert.ok(players.queryResults.every((query) => query.query.aggregate === 'count'));
  const endpoint = run(
    op({ metric: 'creditedAssists', operator: 'orderedEndpoints', subjects: ['h2'] }),
    { state },
    request,
  );
  assert.equal(endpoint.proofs[0].values.first.actor.id, 'h2');
  const missing = run(
    op({ metric: 'creditedAssists' }),
    {
      state: {
        ...base,
        events: [credit, event('uncredited', 15, { result: true, outcome: 'goal' })],
      },
    },
    request,
  );
  assert.equal(missing.proofs[0].status, 'unavailable');
  const missingPlayer = run(
    op({ metric: 'creditedAssists', subjects: ['h1', 'h2'] }),
    {
      state: {
        ...base,
        events: [credit, event('uncredited', 15, { result: true, outcome: 'goal' })],
      },
    },
    request,
  );
  assert.equal(missingPlayer.proofs[0].status, 'unavailable');
});

test('optimized recovery comparisons count ball wins, excluding initial control and unknown classifications', () => {
  const start = event('start', 0, { type: 'recovery', recoveryKind: 'segment-start' });
  const gained = event('gain', 5, { type: 'recovery', recoveryKind: 'interception' });
  const result = run(
    op({ metric: 'recoveries' }),
    { state: { ...base, events: [start, gained] } },
    request,
  );
  assert.equal(result.proofs[0].values.left.count, 1);
  assert.ok(result.queryResults.every((query) => query.query.filters.recoveryClass === 'ball-win'));
  const unknown = run(
    op({ metric: 'recoveries' }),
    { state: { ...base, events: [start, gained, event('unknown', 8, { type: 'recovery' })] } },
    request,
  );
  assert.equal(unknown.proofs[0].status, 'unavailable');
});

test('six supported metrics retain their classification and all four languages render required facts', () => {
  const state = {
    ...base,
    events: [
      event('saved', 2),
      event('blocked', 3, { outcome: 'blocked' }),
      event('pending', 4, { result: null, outcome: 'pending' }),
      event('goal', 5, {
        result: true,
        outcome: 'goal',
        assist: { playerId: 'h2', player: 'Home Two' },
      }),
      event('pass', 6, { type: 'pass', result: true }),
      event('recover', 7, { type: 'recovery', recoveryKind: 'loose-ball' }),
    ],
  };
  for (const [metric, count] of [
    ['completedPasses', 1],
    ['attempts', 4],
    ['goals', 1],
    ['shotsOnTarget', 2],
    ['recoveries', 1],
    ['creditedAssists', 1],
  ])
    assert.equal(
      run(op({ metric }), { state }, request).proofs[0].values.left.count,
      count,
      metric,
    );
  for (const [language, marker] of [
    ['en', 'leads by'],
    ['es', 'ventaja'],
    ['fr', 'de plus'],
    ['pt', 'vantagem'],
  ]) {
    const result = run(operation(), {}, { ...input, language });
    assert.match(result.claims[0].text, new RegExp(marker));
    assert.match(result.claims[0].text, /5 .*4 .*1 /);
  }
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const result = run(
      op({ operator: 'orderedEndpoints', subjects: [] }),
      { state: { ...base, events: [event('pending', 4, { result: null, outcome: 'pending' })] } },
      { ...request, language },
    );
    assert.equal(result.proofs[0].values.first.outcome, 'pending');
    assert.match(result.claims[0].text, /00:04/);
  }
});

test('arbitrary seeds and authored design cases use data operations rather than question text rules', () => {
  for (const kind of ['sustained', 'duel', 'counter', 'interrupted', 'quiet'])
    for (const seed of [2, 407, 7391]) {
      const request = {
          kind,
          seed,
          time: 110,
          question: 'Show the difference in completed circulation.',
        },
        state = matchState(request);
      const result = run(operation({ requestSpan: request.question }), { state }, request);
      assert.equal(
        result.proofs[0].values.left.count,
        state.events.filter((e) => e.type === 'pass' && e.result === true && e.team === 'home')
          .length,
      );
      assert.equal(
        result.proofs[0].values.right.count,
        state.events.filter((e) => e.type === 'pass' && e.result === true && e.team === 'away')
          .length,
      );
    }
  const acceptance = JSON.parse(
    readFileSync(
      new URL('./test-fixtures/semantic-obligations-acceptance-v1.json', import.meta.url),
      'utf8',
    ),
  );
  for (const testCase of acceptance.cases.filter((c) =>
    [
      'explicit-margin',
      'paraphrased-gap',
      'spanish-gap',
      'first-last-global',
      'first-last-player',
    ].includes(c.id),
  )) {
    const ordered = testCase.expected.operator === 'orderedEndpoints';
    const result = run(
      operation({
        requestSpan: testCase.input.question,
        operator: ordered ? 'orderedEndpoints' : 'difference',
        metric: ordered ? 'attempts' : 'completedPasses',
        subjects: ordered
          ? testCase.expected.subject
            ? [testCase.expected.subject]
            : []
          : ['home', 'away'],
        timeTo: testCase.input.time,
      }),
      {},
      testCase.input,
    );
    assert.equal(result.proofs[0].status, 'proved');
    if (ordered) {
      assert.equal(result.proofs[0].values.first.event.time, testCase.expected.first.time);
      assert.equal(result.proofs[0].values.latest.event.time, testCase.expected.latest.time);
    } else assert.equal(result.proofs[0].values.absoluteMargin, 1);
  }
});

test('combined passing accuracy sums settled outcomes rather than averaging team percentages', () => {
  const state = {
    ...base,
    events: [
      event('hc', 1, { type: 'pass', result: true }),
      event('hf', 2, { type: 'pass', result: false }),
      event('hp', 3, { type: 'pass', result: null }),
      ...[4, 5, 6].map((time) =>
        event(`ac${time}`, time, { type: 'pass', result: true, team: 'away', playerId: 'a1' }),
      ),
    ],
  };
  const result = run(rate({ subjects: [] }), { state }, request),
    proof = result.proofs[0],
    v = proof.values.combined;
  assert.deepEqual(
    [v.id, v.completed, v.failed, v.pending, v.denominator, v.percentage],
    [null, 4, 1, 1, 5, 80],
  );
  assert.equal(proof.values.teams, undefined);
  assert.equal(result.queryCount, 3);
  assert.equal(v.label, 'Both teams combined');
  assert.deepEqual(
    proof.evidence,
    result.queryResults.map((q) => q.scopeReference),
  );
  assert.equal(proof.evidence.length, 3);
  assert.ok(Object.isFrozen(v));
  assert.match(proof.sourceFingerprint, /^[a-f0-9]{64}$/);
  const teams = run(rate(), { state }, request).proofs[0].values.teams;
  assert.deepEqual(
    teams.map((v) => v.percentage),
    [50, 100],
  );
  assert.notEqual(v.percentage, (teams[0].percentage + teams[1].percentage) / 2);
  assert.equal(
    run(rate({ subjects: ['away'] }), { state }, request).proofs[0].values.teams[0].percentage,
    100,
  );
});

test('combined real fixture uses 11 completed of 12 settled passes and one pending', () => {
  const input = {
    kind: 'interrupted',
    seed: 41,
    time: 118,
    language: 'en',
    question: 'What is the combined passing accuracy on settled passes?',
  };
  const result = executeOperationPlan(
      input,
      plan(
        operation({
          requestSpan: input.question,
          operator: 'ratio',
          metric: 'passCompletionRate',
          subjects: [],
          timeTo: 118,
        }),
      ),
    ),
    v = result.proofs[0].values.combined;
  assert.deepEqual(
    [v.completed, v.failed, v.pending, v.numerator, v.denominator, v.displayPercent],
    [11, 1, 1, 11, 12, '91.7'],
  );
  assert.equal(v.ratio, 11 / 12);
  assert.equal(result.queryCount, 3);
  assert.match(result.claims[0].text, /Both teams combined: 91.7%.*11 completed of 12.*1 awaiting/);
});

test('combined rate handles zero and unknown partitions conservatively in all four languages', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const result = run(
      rate({ subjects: [] }),
      { state: { ...base, events: [event('pending', 4, { type: 'pass', result: null })] } },
      { ...request, language },
    );
    const v = result.proofs[0].values.combined;
    assert.equal(v.ratio, null);
    assert.equal(v.denominator, 0);
    assert.equal(v.pending, 1);
    assert.equal(
      v.label,
      {
        en: 'Both teams combined',
        es: 'Ambos equipos combinados',
        fr: 'Les deux équipes réunies',
        pt: 'As duas equipes combinadas',
      }[language],
    );
    assert.doesNotMatch(result.claims[0].text, /0\s*%/);
  }
  const zero = run(
    rate({ subjects: [] }),
    { state: { ...base, events: [event('failed', 3, { type: 'pass', result: false })] } },
    request,
  ).proofs[0].values.combined;
  assert.equal(zero.percentage, 0);
  assert.equal(zero.denominator, 1);
  for (const change of [
    { result: undefined },
    { result: 'complete' },
    { team: 'unknown' },
    { team: undefined },
  ]) {
    const result = run(
      rate({ subjects: [] }),
      {
        state: {
          ...base,
          events: [event('invalid', 3, { type: 'pass', result: true, ...change })],
        },
      },
      request,
    );
    assert.equal(result.proofs[0].status, 'unavailable');
    assert.equal(result.proofs[0].values, null);
  }
});

test('combined rate respects current revisions, deletion, window and future arrival boundaries', () => {
  const state = {
    ...base,
    events: [
      event('r', 3, { type: 'pass', result: null }),
      event('r', 3, { type: 'pass', result: true, revision: 2, arrivedAt: 5 }),
      event('r', 3, { type: 'pass', result: false, revision: 3, arrivedAt: 30 }),
      event('d', 7, { type: 'pass', result: false }),
      event('d', 7, { type: 'pass', revision: 2, arrivedAt: 8, operation: 'delete' }),
      event('p', 12, { type: 'pass', result: null, team: 'away', playerId: 'a1' }),
      event('outside', 25, { type: 'pass', result: 'bad' }),
      event('late', 15, { type: 'pass', result: 'bad', arrivedAt: 30 }),
    ],
  };
  const result = run(rate({ subjects: [] }), { state }, request).proofs[0].values.combined;
  assert.deepEqual([result.completed, result.failed, result.pending], [1, 0, 1]);
  const restricted = run(rate({ subjects: [], timeFrom: 10 }), { state }, request).proofs[0].values
    .combined;
  assert.deepEqual(
    [restricted.completed, restricted.failed, restricted.pending, restricted.ratio],
    [0, 0, 1, null],
  );
});

test('ratio output explicitly states zero pending passes for combined and team scopes in every language', () => {
  const expected = {
    en: '0 awaiting an outcome',
    es: '0 pendientes de resultado',
    fr: '0 en attente de résultat',
    pt: '0 aguardando resultado',
  };
  for (const language of Object.keys(expected))
    for (const subjects of [[], ['home'], ['home', 'away']]) {
      const request = {
        kind: 'interrupted',
        seed: 41,
        time: 110,
        language,
        question: 'What is the combined passing accuracy and how many passes await an outcome?',
      };
      const result = executeOperationPlan(
        request,
        plan(
          operation({
            requestSpan: request.question,
            operator: 'ratio',
            metric: 'passCompletionRate',
            subjects,
            timeTo: 110,
          }),
        ),
      );
      const proof = result.proofs[0];
      const values = proof.values.combined ? [proof.values.combined] : proof.values.teams;
      assert.ok(values.every((value) => value.pending === 0));
      assert.equal(
        result.claims[0].text.split(expected[language]).length - 1,
        values.length,
        `${language} ${JSON.stringify(subjects)}`,
      );
      if (!subjects.length) {
        assert.equal(proof.values.combined.denominator, 12);
        assert.equal(proof.values.combined.completed, 11);
      }
    }
});

test('actual two-request ratio renders once and retains both original request owners', () => {
  const input = {
    kind: 'counter',
    seed: 2063,
    time: 19,
    language: 'en',
    question:
      "At 00:19, what's Northbridge's pass completion percentage, and how many passes are still waiting for an outcome?",
  };
  const first = rate({
      id: 'passCompletionRate-home',
      subjects: ['home'],
      timeTo: 19,
      requestSpan: "what's Northbridge's pass completion percentage",
    }),
    second = {
      ...first,
      id: 'pendingPasses-home',
      requestSpan: 'how many passes are still waiting for an outcome',
    };
  const result = executeOperationPlan(input, plan(first, second));
  assert.equal(result.claims.length, 1);
  assert.equal(result.proofs.length, 1);
  assert.equal(result.originalProofs.length, 2);
  assert.deepEqual(result.originalToSelectedIndex, [0, 0]);
  assert.deepEqual(result.proofs[0].requestOwnership, [
    { id: first.id, requestSpan: first.requestSpan },
    { id: second.id, requestSpan: second.requestSpan },
  ]);
  assert.deepEqual(
    result.proofs[0].values.teams.map((v) => [v.completed, v.failed, v.pending, v.denominator]),
    [[2, 0, 1, 2]],
  );
  assert.match(result.claims[0].text, /100%/);
  assert.match(result.claims[0].text, /1 awaiting/);
  assert.equal(result.queryCount, 3);
  assert.equal(Object.hasOwn(result.originalProofs[0], 'requestOwnership'), false);
  assert.ok(Object.isFrozen(result.proofs[0].requestOwnership));
});

test('operation dedup requires identical semantic proof and current citations, never equal wording alone', () => {
  const r = run(operation({ operator: 'ratio', metric: 'passCompletionRate', subjects: ['home'] })),
    proof = r.proofs[0],
    claim = r.claims[0];
  for (const mutate of [
    (p) => p.window.to--,
    (p) => p.evidence[0].revision++,
    (p) => (p.evidence[0].id += 'other'),
    (p) => (p.sourceFingerprint += 'other'),
    (p) => (p.subjects[0].id = 'away'),
    (p) => p.values.teams[0].pending++,
    (p) => (p.metric = 'attempts'),
    (p) => (p.operator = 'difference'),
    (p) => (p.qualifiers = { passType: 'cross' }),
    (p) => (p.status = 'unavailable'),
  ]) {
    const other = structuredClone(proof);
    other.id = 'second';
    other.requestSpan = 'Another request';
    mutate(other);
    const result = canonicalOperationSelection({ proofs: [proof, other], claims: [claim, claim] });
    assert.equal(result.claims.length, 2);
    assert.deepEqual(result.originalToSelectedIndex, [0, 1]);
  }
  const other = { ...structuredClone(proof), id: 'second', requestSpan: 'Other request' };
  const altered = structuredClone(claim);
  altered.evidence[0].revision++;
  assert.equal(
    canonicalOperationSelection({ proofs: [proof, other], claims: [claim, altered] }).claims.length,
    2,
  );
  assert.throws(() => canonicalOperationSelection({ proofs: [proof], claims: [] }), /align/);
});

test('mixed time windows label the whole-match comparison explicitly in all supported languages', () => {
  for (const [language, label] of [
    ['en', 'So far:'],
    ['es', 'En total:'],
    ['fr', 'Depuis le début:'],
    ['pt', 'Até agora:'],
  ]) {
    const question = {
      kind: 'counter',
      seed: 2403,
      time: 108,
      language,
      question: 'Compare the recent interval with the whole passage.',
    };
    const recent = operation({
        id: 'recent',
        metric: 'attempts',
        requestSpan: question.question,
        timeFrom: 88,
        timeTo: 108,
      }),
      whole = { ...recent, id: 'whole', timeFrom: 0 };
    const result = executeOperationPlan(question, plan(recent, whole));
    assert.match(result.claims[0].text, /01:28/);
    assert.ok(result.claims[1].text.startsWith(label));
    assert.deepEqual(
      result.proofs.map((proof) => proof.window),
      [
        { from: 88, to: 108 },
        { from: 0, to: 108 },
      ],
    );
    assert.equal(result.queryCount, 2);
    const single = executeOperationPlan(question, plan(whole));
    assert.ok(!single.claims[0].text.startsWith(label), 'single scope keeps existing concise form');
  }
});

test('shot share computes combined counts with an all-attempt denominator, not averaged team rates', () => {
  const question = 'What percentage of all shots was on target?';
  const request = { kind: 'sustained', seed: 17, time: 120, language: 'es', question };
  const result = executeOperationPlan(
    request,
    plan({
      id: 'shot-share',
      requestSpan: question,
      operator: 'ratio',
      metric: 'shotOnTargetRate',
      subjects: [],
      timeFrom: 0,
      timeTo: 120,
    }),
  );
  assert.equal(result.queryCount, 2);
  const value = result.proofs[0].values.combined;
  assert.equal(value.numerator, 2);
  assert.equal(value.denominator, 5);
  assert.equal(value.percentage, 40);
  assert.equal(result.proofs[0].values.definition, 'shotsOnTarget/allAttempts');
  assert.match(result.claims[0].text, /40%/);
});

test('shot share handles unknown outcomes, zero attempts and revised goals without guessing', () => {
  const q = { ...request, question: 'What percentage of shots was on target?' };
  const obligation = {
    id: 'share',
    requestSpan: q.question,
    operator: 'ratio',
    metric: 'shotOnTargetRate',
    subjects: [],
    timeFrom: 0,
    timeTo: 20,
  };
  for (const result of [null, undefined]) {
    const shot = event('pending', 10, { result });
    if (result === undefined) delete shot.result;
    const response = executeOperationPlan(q, plan(obligation), {
      state: { ...base, events: [shot] },
    });
    assert.equal(response.proofs[0].status, 'unavailable');
  }
  const empty = executeOperationPlan(q, plan(obligation), { state: base });
  assert.equal(empty.proofs[0].values.combined.percentage, null);
  const response = executeOperationPlan(q, plan(obligation), {
    state: {
      ...base,
      events: [
        event('goal', 10, { result: false, outcome: 'off-target' }),
        event('goal', 10, { revision: 2, arrivedAt: 15, result: true }),
        event('blocked', 12, { outcome: 'blocked' }),
      ],
    },
  });
  assert.equal(response.proofs[0].values.combined.percentage, 50);
  assert.equal(response.proofs[0].values.combined.denominator, 2);
});
