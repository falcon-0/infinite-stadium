import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecapFacts, buildRecapFacts } from './recap-facts.js';
import { integratedMatch } from './match-stream.js';
import { currentRecap, recapViewKey } from './recap-view.js';

const request = {
  source: 'integrated-match',
  kind: 'extended',
  seed: 2039,
  time: 362,
  audience: 'analyst',
  language: 'en',
};
const fact = (result, kind, team) =>
  result.catalog.facts.find(
    (f) => f.kind === kind && (team === undefined || f.values.team === team),
  );
const ids = (f) => new Set(f.evidence.map((r) => `${r.id}@${r.revision}`));
const event = (id, time, team, type, result, extra = {}) => ({
  id,
  revision: 1,
  time,
  arrivedAt: time,
  team,
  type,
  result,
  playerId: team + '-actor',
  player: team === 'home' ? 'M. Vale' : 'S. Noor',
  ...extra,
});
const bundle = (events, time = 12) => ({
  state: {
    time,
    events,
    metadata: { kind: 'central', seed: 17, segmentDuration: 8, observationHorizon: 12 },
  },
});

test('whole received segment totals differ from a rolling moment window and carry every count input', () => {
  const result = createRecapFacts(request),
    state = integratedMatch(request).state;
  assert.equal(result.catalog.facts[0].kind, 'recap-overview');
  assert.deepEqual(fact(result, 'recap-overview').values, {
    home: 2,
    away: 1,
    observedAt: 362,
    segmentDuration: 360,
    status: 'demo-segment-complete',
    eventCount: 50,
    firstEventTime: 20,
    lastEventTime: 359,
  });
  assert.equal(fact(result, 'recap-team-shots', 'home').values.count, 2);
  assert.equal(fact(result, 'recap-team-shots', 'away').values.count, 5);
  const passes = result.catalog.facts.filter((f) => f.kind === 'recap-team-passes');
  assert.equal(
    passes.reduce((n, f) => n + f.values.total, 0),
    12,
  );
  assert.equal(
    passes.reduce((n, f) => n + f.values.completed, 0),
    9,
  );
  for (const f of result.catalog.facts.filter(
    (f) => f.kind === 'recap-team-shots' || f.kind === 'recap-team-passes',
  )) {
    const type = f.kind === 'recap-team-shots' ? 'shot' : 'pass';
    assert.deepEqual(
      ids(f),
      new Set(
        state.events
          .filter((e) => e.team === f.values.team && e.type === type)
          .map((e) => `${e.id}@${e.revision}`),
      ),
    );
  }
  assert.deepEqual(
    ids(result.catalog.facts[0]),
    new Set(state.events.map((e) => `${e.id}@${e.revision}`)),
  );
  assert.equal(result.dependencies.length, 50);
  assert.ok(result.catalog.facts.length <= 9);
  assert.equal(result.scope.task, 'recap');
  assert.equal(result.scope.fixture.synthetic, true);
  assert.match(result.catalog.limitation, /not a full match/);
  assert.match(result.catalog.limitation, /do not prove feed completeness/);
});

test('pending outcomes never enter known pass denominator and zero score uses received inventory', () => {
  const events = [
    event('a', 1, 'home', 'pass', true),
    event('b', 2, 'home', 'pass', false),
    event('c', 3, 'home', 'pass', null),
    event('d', 4, 'home', 'pass', undefined),
    event('s', 5, 'away', 'shot', null),
  ];
  const result = buildRecapFacts(bundle(events), {}),
    passes = fact(result, 'recap-team-passes', 'home');
  assert.deepEqual(passes.values, {
    team: 'home',
    total: 4,
    known: 2,
    completed: 1,
    failed: 1,
    pending: 2,
    start: 0,
    end: 12,
  });
  assert.equal(passes.evidence.length, 4);
  assert.equal(result.catalog.facts[0].values.home, 0);
  assert.equal(result.catalog.facts[0].values.away, 0);
  assert.equal(result.catalog.facts[0].evidence.length, 5);
  assert.ok(!fact(result, 'recap-goal-score-change'));
});

test('score turning points cite all earlier goals, suppress simultaneous ordering, retain latest three', () => {
  const events = [
    event('g1', 1, 'home', 'shot', true),
    event('g2', 2, 'away', 'shot', true),
    event('g3', 3, 'home', 'shot', true),
    event('g4', 4, 'home', 'shot', true),
    event('g5', 5, 'away', 'shot', true),
  ];
  const result = buildRecapFacts(bundle(events), {}),
    highlights = result.catalog.facts.filter((f) => f.kind === 'recap-goal-score-change');
  assert.deepEqual(
    highlights.map((f) => f.values.anchorId),
    ['g3', 'g4', 'g5'],
  );
  assert.deepEqual(
    highlights.map((f) => f.values.effect),
    ['took-lead', 'extended-lead', 'reduced-deficit'],
  );
  assert.deepEqual(
    highlights.map((f) => f.evidence.length),
    [3, 4, 5],
  );
  const equalizer = buildRecapFacts(bundle(events.slice(0, 2)), {}).catalog.facts.find(
    (f) => f.values.anchorId === 'g2',
  );
  assert.equal(equalizer.values.effect, 'equalized');
  assert.equal(equalizer.values.beforeHome, 1);
  assert.equal(equalizer.values.afterAway, 1);
  const tied = buildRecapFacts(
    bundle([events[0], { ...events[1], time: 1, arrivedAt: 1 }, events[2]]),
    {},
  );
  assert.deepEqual(
    tied.catalog.facts
      .filter((f) => f.kind === 'recap-goal-score-change')
      .map((f) => f.values.anchorId),
    ['g3'],
  );
  assert.equal(fact(tied, 'recap-goal-score-change').evidence.length, 3);
});

test('received corrections and minimal withdrawals update score, highlights and dependency keys', () => {
  const original = event('goal', 5, 'home', 'shot', true),
    correction = { ...original, revision: 2, arrivedAt: 7, result: false };
  const withdrawn = { id: 'goal', revision: 3, time: 5, arrivedAt: 9, operation: 'delete' };
  const retained = event('pass', 1, 'home', 'pass', true),
    records = [retained, original, correction, withdrawn];
  const before = buildRecapFacts(bundle(records, 6), {}),
    after = buildRecapFacts(bundle(records, 8), {}),
    deleted = buildRecapFacts(bundle(records, 10), {});
  assert.equal(before.catalog.facts[0].values.home, 1);
  assert.equal(after.catalog.facts[0].values.home, 0);
  assert.equal(fact(after, 'recap-team-shots', 'home').values.count, 1);
  assert.ok(!fact(deleted, 'recap-team-shots'));
  assert.deepEqual(deleted.dependencies, [{ type: 'event', id: 'pass', revision: 1 }]);
  assert.notEqual(before.key, after.key);
  assert.notEqual(after.key, deleted.key);
  assert.ok(!fact(after, 'recap-goal-score-change'));
  assert.equal(fact(before, 'recap-goal-score-change').evidence[0].revision, 1);
  assert.notEqual(before.catalog.facts[0].id, after.catalog.facts[0].id);
});

test('unselected received events and profile changes invalidate key while input order is immaterial', () => {
  const records = [
    event('p', 1, 'home', 'pass', true),
    event('r', 2, 'away', 'recovery', undefined),
  ];
  const original = buildRecapFacts(bundle(records), {}),
    reordered = buildRecapFacts(bundle([...records].reverse()), {});
  assert.equal(original.key, reordered.key);
  assert.deepEqual(original.catalog, reordered.catalog);
  const corrected = buildRecapFacts(
    bundle([records[0], { ...records[1], revision: 2, reason: 'Received correction' }]),
    {},
  );
  assert.notEqual(original.key, corrected.key);
  assert.notEqual(original.key, buildRecapFacts(bundle(records), { favoriteClub: 'away' }).key);
  assert.notEqual(original.key, buildRecapFacts(bundle(records), { language: 'es' }).key);
  assert.equal(records[1].revision, 1);
});

test('favorite player actions are actor-only and an unobserved choice cannot establish a participant', () => {
  const records = [
    event('p', 1, 'home', 'pass', null, { player: 'M. Vale', receiverId: 'other' }),
    event('s', 2, 'home', 'shot', true, { player: 'M. Vale' }),
    event('f', 3, 'home', 'flight', undefined, { player: 'M. Vale' }),
    event('r', 4, 'away', 'recovery', undefined, { player: 'S. Noor' }),
  ];
  const result = buildRecapFacts(bundle(records), {
      favoritePlayer: 'M. Vale',
      audience: 'player',
    }),
    player = fact(result, 'recap-player-actions');
  assert.equal(player.values.total, 2);
  assert.equal(player.values.goals, 1);
  assert.equal(player.values.pendingPasses, 1);
  assert.deepEqual(ids(player), new Set(['p@1', 's@1']));
  assert.equal(player.values.involvement, 'recorded');
  assert.equal(
    fact(buildRecapFacts(bundle(records), { favoritePlayer: 'J. Cole' }), 'recap-player-actions'),
    undefined,
    'a name from another fixture cannot establish participant identity',
  );
});

test('same-name actors must resolve one canonical ID and team after received corrections and withdrawals', () => {
  const a = event('a', 1, 'away', 'receive', undefined, {
      player: 'R. Hughes',
      playerId: 'away-8',
    }),
    b = event('b', 2, 'away', 'receive', undefined, { player: 'R. Hughes', playerId: 'away-9' }),
    input = { favoritePlayer: 'R. Hughes', audience: 'player' };
  assert.equal(
    fact(buildRecapFacts(bundle([a, b]), input), 'recap-player-actions'),
    undefined,
    'Same-team names do not establish one player',
  );
  const corrected = { ...b, revision: 2, arrivedAt: 5, playerId: 'away-8' };
  assert.equal(
    fact(buildRecapFacts(bundle([a, b, corrected], 4), input), 'recap-player-actions'),
    undefined,
  );
  const resolved = fact(
    buildRecapFacts(bundle([a, b, corrected], 5), input),
    'recap-player-actions',
  );
  assert.equal(resolved.values.playerId, 'away-8');
  assert.equal(resolved.values.total, 2);
  assert.deepEqual(ids(resolved), new Set(['a@1', 'b@2']));
  const removed = { id: 'b', revision: 2, time: 2, arrivedAt: 5, operation: 'delete' };
  assert.equal(
    fact(buildRecapFacts(bundle([a, b, removed], 5), input), 'recap-player-actions').values.total,
    1,
  );
  for (const other of [
    { ...b, playerId: undefined },
    { ...b, playerId: 'away-8', team: 'home' },
    { ...b, playerId: 'away-8', player: 'Different Player' },
  ])
    assert.equal(
      fact(buildRecapFacts(bundle([a, other]), input), 'recap-player-actions'),
      undefined,
    );
});

test('recap recovery partitions retain initial control and missing classification without fake ball wins', () => {
  const initial = event('initial', 0, 'home', 'recovery', undefined, {
      recoveryKind: 'segment-start',
    }),
    win = event('win', 1, 'home', 'recovery', undefined, { recoveryKind: 'interception' }),
    unknown = event('unknown', 2, 'home', 'recovery', undefined);
  const input = { favoritePlayer: 'M. Vale' },
    result = buildRecapFacts(bundle([initial, win, unknown], 3), input),
    player = fact(result, 'recap-player-actions');
  assert.equal(player.values.recoveries, 3);
  assert.equal(player.values.ballWins, 1);
  assert.equal(player.values.initialControls, 1);
  assert.equal(player.values.unknownRecoveries, 1);
  assert.equal(player.values.total, 3);
  const correction = { ...unknown, revision: 2, arrivedAt: 4, recoveryKind: 'loose-ball' };
  const before = fact(
      buildRecapFacts(bundle([initial, win, unknown, correction], 3), input),
      'recap-player-actions',
    ),
    after = fact(
      buildRecapFacts(bundle([initial, win, unknown, correction], 4), input),
      'recap-player-actions',
    );
  assert.equal(before.values.unknownRecoveries, 1);
  assert.equal(after.values.unknownRecoveries, 0);
  assert.equal(after.values.ballWins, 2);
  assert.ok(after.evidence.some((ref) => ref.id === 'unknown' && ref.revision === 2));
  assert.notEqual(before.id, after.id);
});

test('current match clubs are source-bound, bounded and part of recap cache identity', () => {
  const p = createRecapFacts({ ...request, kind: 'quiet', seed: 73, time: 120 });
  assert.deepEqual(p.scope.teams, { home: 'Eastvale Rovers', away: 'Westhaven FC' });
  const state = bundle([event('pass', 1, 'home', 'pass', true)]);
  state.state.metadata.teams = { home: 'Étoile FC', away: 'Harbour Town' };
  const first = buildRecapFacts(state),
    changed = structuredClone(state);
  changed.state.metadata.teams.away = 'Different Club';
  assert.notEqual(first.key, buildRecapFacts(changed).key);
  first.scope.teams.home = 'changed output';
  assert.equal(state.state.metadata.teams.home, 'Étoile FC');
  for (const teams of [
    { home: 'A', away: 'B', extra: 'C' },
    { home: 'A' },
    ['A', 'B'],
    { home: 'A', away: 'A' },
    { home: '<script>', away: 'B' },
    { home: 'A\nClub', away: 'B' },
    { home: 'A'.repeat(101), away: 'B' },
  ]) {
    const bad = structuredClone(state);
    bad.state.metadata.teams = teams;
    assert.throws(
      () => buildRecapFacts(bad),
      (error) => error.status === 400,
    );
  }
});

test('in-progress and late corrected completion remain scoped segment states in all four languages', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const before = createRecapFacts({ ...request, time: 359, language }),
      completed = createRecapFacts({ ...request, time: 360, language });
    assert.equal(before.catalog.facts[0].values.status, 'in-progress');
    assert.equal(completed.catalog.facts[0].values.status, 'demo-segment-complete');
    assert.equal(completed.language.code, language);
    assert.equal(completed.scope.observedAt, 360);
  }
  assert.throws(
    () => createRecapFacts({ ...request, time: 0 }),
    (error) => error.status === 400,
  );
  assert.throws(
    () => createRecapFacts({ ...request, source: 'scene' }),
    (error) => error.status === 400,
  );
  assert.throws(
    () => createRecapFacts({ ...request, favoritePlayer: '<invalid>' }),
    (error) => error.status === 400,
  );
  assert.equal(
    fact(createRecapFacts({ ...request, favoritePlayer: 'Real player' }), 'recap-player-actions'),
    undefined,
    'a safe saved choice must not invent a zero-action participant',
  );
});

test('future records are excluded, invalid arrival and conflicting identities fail closed', () => {
  const received = event('a', 1, 'home', 'pass', true),
    future = event('b', 10, 'away', 'shot', true);
  const result = buildRecapFacts(bundle([received, future], 8), {});
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.catalog.facts[0].values.away, 0);
  assert.throws(
    () => buildRecapFacts(bundle([received, { ...future, arrivedAt: 7 }], 8), {}),
    (error) => error.status === 400,
  );
  assert.throws(
    () => buildRecapFacts(bundle([received, { ...received, result: false }]), {}),
    (error) => error.status === 400,
  );
  assert.throws(
    () =>
      buildRecapFacts(
        bundle([{ id: 'a', revision: 2, time: 1, arrivedAt: 2, operation: 'delete' }]),
        {},
      ),
    (error) => error.status === 400,
  );
});

test('the authored withdrawal produces a new zero-score recap and supersedes prior whole-inventory selection', () => {
  const input = {
    source: 'integrated-match',
    kind: 'withdrawal',
    seed: 17,
    audience: 'newcomer',
    language: 'en',
  };
  const before = createRecapFacts({ ...input, time: 10 }),
    after = createRecapFacts({ ...input, time: 11 });
  assert.equal(before.catalog.facts[0].values.home, 1);
  assert.equal(before.catalog.facts[0].values.eventCount, 3);
  assert.equal(fact(before, 'recap-goal-score-change').values.anchorId, 'withdrawal-17-shot');
  assert.equal(after.catalog.facts[0].values.home, 0);
  assert.equal(after.catalog.facts[0].values.eventCount, 2);
  assert.equal(fact(after, 'recap-team-shots'), undefined);
  assert.equal(fact(after, 'recap-goal-score-change'), undefined);
  assert.deepEqual(
    ids(after.catalog.facts[0]),
    new Set(['withdrawal-17-pass@2', 'withdrawal-17-receive@1']),
  );
  assert.equal(after.scope.fixture.kind, 'withdrawal');
  assert.equal(after.scope.fixture.observationHorizon, 12);
  assert.notEqual(before.key, after.key);
  const preferences = {
    kind: 'withdrawal',
    seed: 17,
    audience: 'newcomer',
    language: 'en',
    favoriteClub: null,
    favoritePlayer: null,
  };
  const draft = { ...before, language: 'en', status: 'draft' },
    oldRecords = integratedMatch({ ...input, time: 10 }).state.events;
  const requestKey = recapViewKey(oldRecords, 10, preferences);
  assert.equal(
    currentRecap(draft, { records: oldRecords, time: 10, preferences, requestKey }),
    true,
  );
  assert.equal(
    currentRecap(draft, {
      records: integratedMatch({ ...input, time: 11 }).state.events,
      time: 11,
      preferences,
      requestKey,
    }),
    false,
  );
});
