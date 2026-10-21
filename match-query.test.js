import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMatchQuery } from './match-query.js';
import { matchState } from './match-stream.js';
import { watchStats } from './watch-stats.js';
import { buildQuestionFacts } from './question-facts.js';
const input = { kind: 'sustained', seed: 17, time: 96 };

test('ball-win queries exclude starting control and preserve unknown classification coverage', () => {
  const base = {
    time: 20,
    metadata: { id: 'classification', teams: { home: 'Home', away: 'Away' } },
    frames: [],
    events: [],
  };
  const row = (id, time, recoveryKind) => ({
    id,
    revision: 1,
    type: 'recovery',
    time,
    arrivedAt: time,
    team: 'home',
    playerId: 'home-7',
    player: 'Player',
    ...(recoveryKind ? { recoveryKind } : {}),
  });
  const events = [
    row('start', 0, 'segment-start'),
    row('win', 8, 'loose-ball'),
    row('missing', 10),
    row('unknown', 12, 'unrecognized'),
  ];
  const run = (query) =>
    executeMatchQuery({ kind: 'quiet', seed: 1, time: 20 }, query, {
      stateFactory: () => ({ ...base, events }),
    });
  const wins = run({ filters: { type: 'recovery', recoveryClass: 'ball-win' } });
  assert.equal(wins.count, 1);
  assert.equal(wins.scope.missingFields.recoveryClass, 2);
  assert.equal(wins.rows[0].id, 'win');
  assert.equal(wins.rows[0].recoveryClass, 'ball-win');
  assert.equal(run({ filters: { type: 'recovery', recoveryClass: 'initial-control' } }).count, 1);
  assert.equal(
    run({ filters: { type: 'recovery' } }).count,
    4,
    'raw provider recovery records are preserved',
  );
  assert.throws(() => run({ filters: { recoveryClass: 'ball-win' } }), /exact-match/);
  assert.throws(() => run({ filters: { type: 'pass', recoveryClass: 'ball-win' } }), /exact-match/);
});

test('strict event-time bounds exclude only the requested boundaries and retain proved scope identity', () => {
  const base = {
    time: 12,
    metadata: { id: 'interval', teams: { home: 'Home', away: 'Away' } },
    frames: [],
    events: [8, 10, 12].map((time) => ({
      id: String(time),
      revision: 1,
      type: 'pass',
      time,
      arrivedAt: time,
      team: 'home',
      result: true,
    })),
  };
  const run = (extra) =>
    executeMatchQuery(
      { kind: 'quiet', seed: 1, time: 12 },
      { filters: { type: 'pass' }, timeFrom: 8, timeTo: 12, ...extra },
      { stateFactory: () => base },
    );
  const inclusive = run({}),
    after = run({ timeFromExclusive: true }),
    before = run({ timeToExclusive: true });
  assert.deepEqual(
    inclusive.rows.map((row) => row.time),
    [8, 10, 12],
  );
  assert.deepEqual(
    after.rows.map((row) => row.time),
    [10, 12],
  );
  assert.deepEqual(
    before.rows.map((row) => row.time),
    [8, 10],
  );
  assert.deepEqual(
    run({ timeFromExclusive: true, timeToExclusive: true }).rows.map((row) => row.time),
    [10],
  );
  assert.equal(after.scope.timeFromExclusive, true);
  assert.equal(before.query.timeToExclusive, true);
  assert.notEqual(after.scopeReference.id, inclusive.scopeReference.id);
  assert.equal(
    run({ timeFromExclusive: false, timeToExclusive: false }).scopeReference.id,
    inclusive.scopeReference.id,
  );
  assert.equal(
    run({ timeFrom: 12, timeFromExclusive: true }).count,
    0,
    'after an anchor at the cutoff is empty',
  );
  assert.throws(() => run({ timeFromExclusive: 'true' }), /supported query/);
});

test('recovery classification uses the latest received revision and respects withdrawal', () => {
  const first = {
    id: 'win',
    revision: 1,
    type: 'recovery',
    time: 8,
    arrivedAt: 8,
    team: 'home',
    recoveryKind: 'loose-ball',
  };
  const changed = { ...first, revision: 2, arrivedAt: 10, recoveryKind: 'segment-start' };
  const deleted = { ...first, revision: 3, arrivedAt: 12, operation: 'delete' };
  const run = (time) =>
    executeMatchQuery(
      { kind: 'quiet', seed: 1, time },
      { filters: { type: 'recovery', recoveryClass: 'ball-win' } },
      {
        stateFactory: () => ({
          time,
          metadata: { id: 'revised', teams: { home: 'Home', away: 'Away' } },
          frames: [],
          events: [first, changed, deleted],
        }),
      },
    );
  assert.equal(run(9).count, 1);
  assert.equal(run(10).count, 0);
  assert.equal(run(12).count, 0);
});

test('authored ball-win counts agree across query and fan statistics for different match families', () => {
  for (const kind of ['quiet', 'sustained', 'counter', 'duel'])
    for (const seed of [2719, 1007]) {
      const selection = { kind, seed, time: 120 },
        state = matchState(selection);
      const query = executeMatchQuery(selection, {
        filters: { type: 'recovery', recoveryClass: 'ball-win' },
        aggregate: 'by-team',
      });
      const totals = watchStats(state.events);
      assert.equal(
        query.scope.missingFields.recoveryClass,
        0,
        `${kind}/${seed}: authored recoveries must identify their kind`,
      );
      for (const group of query.groups)
        assert.equal(group.count, totals[group.key].ballWins, `${kind}/${seed}/${group.key}`);
      assert.ok(state.events.filter((row) => row.recoveryKind === 'segment-start').length > 0);
      assert.equal(
        query.count,
        state.events.filter(
          (row) => row.type === 'recovery' && row.recoveryKind !== 'segment-start',
        ).length,
      );
    }
});

test('generic false flags do not turn receptions or recoveries into failed actions', () => {
  for (const type of ['receive', 'recovery']) {
    const all = executeMatchQuery(input, { filters: { type } });
    assert.ok(all.count > 0);
    assert.ok(all.rows.every((row) => row.result === null));
    const failed = executeMatchQuery(input, { filters: { type, result: false } });
    assert.equal(failed.count, 0);
    assert.equal(failed.scope.missingFields.result, all.count);
  }
  const passes = executeMatchQuery(input, { filters: { type: 'pass', result: false } });
  assert.ok(passes.rows.every((row) => row.result === false));
});

test('pending outcomes are known states rather than missing completion coverage', () => {
  const quiet = { kind: 'quiet', seed: 2719, time: 120 };
  const completed = executeMatchQuery(quiet, {
    filters: { type: 'pass', result: true },
    aggregate: 'count',
  });
  assert.equal(completed.count, 8);
  assert.equal(completed.scope.missingFields.result, 0);
  const pending = executeMatchQuery(quiet, {
    filters: { type: 'pass', result: null },
    aggregate: 'count',
  });
  assert.equal(pending.count, 1);
  const goals = executeMatchQuery(
    { kind: 'counter', seed: 2719, time: 116 },
    { filters: { type: 'shot', result: true }, aggregate: 'count' },
  );
  assert.equal(goals.count, 0);
  assert.equal(goals.scope.missingFields.result, 0);
});

test('explicit goalkeeper collections group the full received window and cite their saved shots', () => {
  const result = executeMatchQuery(
    { kind: 'duel', seed: 2719, time: 106 },
    {
      filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
      aggregate: 'by-player',
    },
  );
  assert.deepEqual(
    result.groups.map(({ label, count }) => [label, count]),
    [
      ['M. Carter', 2],
      ['I. Kerr', 1],
    ],
  );
  assert.equal(result.count, 3);
  assert.equal(result.scope.missingFields.linkedShotOutcome, 0);
  assert.ok(
    result.rows.every(
      (row) =>
        row.linkedShotOutcome === 'saved' &&
        row.evidence.some((e) => e.id === row.linkedShotReference.id),
    ),
  );
  assert.ok(
    result.groups
      .find((g) => g.label === 'M. Carter')
      .evidence.some((ref) => ref.id.endsWith('shot-20')),
  );
});

test('linked-shot outcomes use received revisions, never future corrections or deleted targets', () => {
  const base = {
    time: 20,
    metadata: { id: 'linked-fixture', teams: { home: 'Home', away: 'Away' } },
    frames: [],
    events: [],
  };
  const shot = {
    id: 'shot',
    revision: 1,
    type: 'shot',
    time: 10,
    arrivedAt: 10,
    team: 'away',
    playerId: 'away-10',
    player: 'Shooter',
    result: false,
    outcome: 'blocked',
  };
  const recovery = {
    id: 'recovery',
    revision: 1,
    type: 'recovery',
    time: 12,
    arrivedAt: 12,
    team: 'home',
    playerId: 'home-1',
    player: 'Keeper',
    recoveryKind: 'goalkeeper-hold',
    cause: 'shot',
  };
  const query = {
    filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
    aggregate: 'count',
  };
  const run = (events) =>
    executeMatchQuery({ kind: 'duel', seed: 1, time: 20 }, query, {
      stateFactory: () => ({ ...base, events }),
    });
  assert.equal(
    run([shot, recovery, { ...shot, revision: 2, arrivedAt: 21, outcome: 'saved' }]).count,
    0,
  );
  assert.equal(
    run([shot, recovery, { ...shot, revision: 2, arrivedAt: 18, outcome: 'saved' }]).count,
    1,
  );
  const deleted = run([
    shot,
    recovery,
    { ...shot, revision: 2, arrivedAt: 18, outcome: 'saved' },
    { ...shot, revision: 3, arrivedAt: 19, operation: 'delete' },
  ]);
  assert.equal(deleted.count, 0);
  assert.equal(deleted.scope.missingFields.linkedShotOutcome, 1);
  const duplicate = run([{ ...shot, revision: 2, outcome: 'saved' }, shot, recovery]);
  assert.equal(duplicate.count, 1);
});

test('missing and conflicting shot links are unknown; recovery classifications are not inferred', () => {
  const state = matchState({ kind: 'duel', seed: 2719, time: 106 });
  const recoveries = state.events.filter((e) => e.recoveryKind === 'goalkeeper-hold');
  const query = {
    filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
    aggregate: 'count',
  };
  const run = (events) =>
    executeMatchQuery({ kind: 'duel', seed: 2719, time: 106 }, query, {
      stateFactory: () => ({ ...state, events }),
    });
  const missing = state.events.map((e) =>
    e.id === recoveries[0].id ? { ...e, cause: 'unreceived-shot' } : e,
  );
  assert.equal(run(missing).count, 2);
  assert.equal(run(missing).scope.missingFields.linkedShotOutcome, 1);
  const noKind = state.events.map((e) =>
    e.id === recoveries[0].id ? { ...e, recoveryKind: undefined } : e,
  );
  assert.equal(run(noKind).count, 2);
  assert.equal(run(noKind).scope.missingFields.recoveryKind, 1);
  const conflicting = state.events.map((e) =>
    e.id === recoveries[1].id ? { ...e, shotId: recoveries[0].cause } : e,
  );
  assert.equal(run(conflicting).count, 2);
  assert.equal(run(conflicting).scope.missingFields.linkedShotOutcome, 1);
  const futureLink = state.events.map((e) =>
    e.id === recoveries[0].id ? { ...e, cause: 'comparison-duel-2719-shot-104' } : e,
  );
  assert.equal(run(futureLink).count, 2);
  assert.equal(run(futureLink).scope.missingFields.linkedShotOutcome, 1);
});

test('linked dependencies outside the query window change scope hash when their revision changes', () => {
  const input = { kind: 'duel', seed: 2719, time: 106 };
  const query = {
    filters: { type: 'recovery', linkedShotOutcome: 'saved' },
    timeFrom: 91,
    timeTo: 93,
  };
  const first = executeMatchQuery(input, query);
  assert.equal(first.count, 1);
  assert.ok(first.evidence.some((ref) => ref.id === 'comparison-duel-2719-shot-90'));
  const changed = executeMatchQuery(input, query, {
    stateFactory: (args) => {
      const state = matchState(args);
      state.events = state.events.map((e) =>
        e.id === 'comparison-duel-2719-shot-90' ? { ...e, revision: e.revision + 1 } : e,
      );
      return state;
    },
  });
  assert.equal(changed.count, 1);
  assert.notEqual(first.scopeReference.id, changed.scopeReference.id);
  assert.ok(
    changed.evidence.some((ref) => ref.id === 'comparison-duel-2719-shot-90' && ref.revision === 2),
  );
});

test('a valid shot link cannot hide a conflicting future, missing, deleted or non-shot identity', () => {
  const base = {
    time: 20,
    metadata: { id: 'conflicting-links', teams: { home: 'Home', away: 'Away' } },
    frames: [],
  };
  const shot = {
    id: 'valid-shot',
    revision: 1,
    type: 'shot',
    time: 10,
    arrivedAt: 10,
    team: 'away',
    result: false,
    outcome: 'saved',
  };
  const recovery = {
    id: 'recovery',
    revision: 1,
    type: 'recovery',
    time: 12,
    arrivedAt: 12,
    team: 'home',
    recoveryKind: 'goalkeeper-hold',
  };
  const query = {
    filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
    aggregate: 'count',
  };
  const scenarios = [
    [],
    [{ ...shot, id: 'other', time: 15, arrivedAt: 15 }],
    [{ ...shot, id: 'other', arrivedAt: 21 }],
    [
      { ...shot, id: 'other' },
      { ...shot, id: 'other', revision: 2, arrivedAt: 19, operation: 'delete' },
    ],
    [{ id: 'other', revision: 1, type: 'pass', time: 8, arrivedAt: 8, team: 'away', result: true }],
  ];
  const run = (links, extra) =>
    executeMatchQuery({ kind: 'duel', seed: 1, time: 20 }, query, {
      stateFactory: () => ({ ...base, events: [shot, ...extra, { ...recovery, ...links }] }),
    });
  for (const extra of scenarios)
    for (const links of [
      { cause: 'valid-shot', shotId: 'other' },
      { cause: 'other', shotId: 'valid-shot' },
    ]) {
      const result = run(links, extra);
      assert.equal(result.count, 0);
      assert.equal(result.scope.missingFields.linkedShotOutcome, 1);
      assert.equal(result.evidence.length, 1);
    }
  assert.equal(run({ cause: 'valid-shot', shotId: 'valid-shot' }, []).count, 1);
  assert.equal(run({ cause: 'valid-shot' }, []).count, 1);
  assert.equal(run({ shotId: 'valid-shot' }, []).count, 1);
  assert.equal(run({ cause: 'valid-shot', shotId: 'recovery' }, []).count, 0);
});

test('new filters reject unknown values and on-target retains saved or goal semantics', () => {
  for (const filters of [{ recoveryKind: 'assumed-save' }, { linkedShotOutcome: 'miss' }])
    assert.throws(() => executeMatchQuery(input, { filters }));
  const query = {
    filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'on-target' },
    aggregate: 'count',
  };
  assert.equal(executeMatchQuery({ kind: 'duel', seed: 2719, time: 106 }, query).count, 3);
});
test('general filters combine with ordering, count and grouping without question-specific branches', () => {
  const q = { filters: { type: 'shot', team: 'home' }, order: 'desc', limit: 1 };
  const a = executeMatchQuery(input, q);
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].time, 96);
  assert.ok(a.count > a.rows.length);
  assert.equal(a.truncated, true);
  const count = executeMatchQuery(input, { ...q, aggregate: 'count' });
  assert.equal(count.count, a.count);
  assert.equal(count.rows.length, 0);
  assert.equal(count.truncated, false);
  const groups = executeMatchQuery(input, { filters: { type: 'shot' }, aggregate: 'by-player' });
  assert.equal(
    groups.groups.reduce((sum, g) => sum + g.count, 0),
    groups.count,
  );
  const teams = executeMatchQuery(input, { filters: { type: 'shot' }, aggregate: 'by-team' });
  assert.equal(
    teams.groups.reduce((sum, g) => sum + g.count, 0),
    teams.count,
  );
});
test('zero goals have a query scope proving absence rather than fabricated event evidence', () => {
  const a = executeMatchQuery({ ...input, time: 0 }, { filters: { type: 'shot', result: true } });
  assert.equal(a.count, 0);
  assert.equal(a.rows.length, 0);
  assert.deepEqual(a.evidence, [a.scope.reference]);
  assert.equal(a.scope.reference.type, 'scope');
  assert.equal(a.scope.observedAt, 0);
});
test('corrections, withdrawals and received times change scope without leaking future evidence', () => {
  const query = { filters: { type: 'shot' }, order: 'desc', limit: 1 };
  const old = executeMatchQuery(input, query),
    corrected = executeMatchQuery({ ...input, time: 98 }, query);
  assert.equal(old.rows[0].outcome, 'off-target');
  assert.equal(corrected.rows[0].outcome, 'saved');
  assert.notEqual(old.scope.reference.id, corrected.scope.reference.id);
  const before = executeMatchQuery({ ...input, time: 95 }, query);
  assert.ok(before.rows.every((e) => e.time <= 95 && e.arrivedAt <= 95));
  const withdrawn = executeMatchQuery(
    { kind: 'withdrawal', seed: 17, time: 11 },
    { filters: { type: 'shot', result: true } },
  );
  assert.equal(withdrawn.count, 0);
  assert.throws(() => executeMatchQuery(input, { timeTo: 97 }), /received/);
});
test('unknown foot and assist data are not inferred, explicit metadata survives with exact references', () => {
  const missing = (args) => {
    const s = matchState(args);
    s.events.forEach((e) => {
      delete e.bodyPart;
      delete e.assist;
    });
    return s;
  };
  const unknown = executeMatchQuery(
    input,
    { filters: { type: 'shot', bodyPart: 'left-foot' } },
    { stateFactory: missing },
  );
  assert.equal(unknown.count, 0);
  assert.ok(unknown.scope.missingFields.bodyPart > 0);
  const stateFactory = (args) => {
    const s = missing(args),
      e = s.events.find((e) => e.type === 'shot');
    e.bodyPart = 'left-foot';
    e.assist = { playerId: 'home-8', player: 'R. Mensah', passId: 'explicit-pass' };
    return s;
  };
  const explicit = executeMatchQuery(
    input,
    { filters: { type: 'shot', bodyPart: 'left-foot' } },
    { stateFactory },
  );
  assert.equal(explicit.count, 1);
  assert.equal(explicit.rows[0].bodyPart, 'left-foot');
  assert.equal(explicit.rows[0].assist.player, 'R. Mensah');
  assert.ok(explicit.rows[0].evidence.length);
  const byAssist = executeMatchQuery(
    input,
    { filters: { assistPlayer: 'R. Mensah' } },
    { stateFactory },
  );
  assert.equal(byAssist.count, 1);
  assert.equal(
    executeMatchQuery(input, { filters: { id: explicit.rows[0].id } }, { stateFactory }).count,
    1,
  );
});
test('time window, exact player and pending outcomes preserve received semantics', () => {
  const state = matchState(input),
    player = state.events.find((e) => e.player === 'A. Reed');
  const a = executeMatchQuery(input, { filters: { player: player.playerId }, timeFrom: 90 });
  assert.ok(a.rows.every((e) => e.player === 'A. Reed' && e.time >= 90));
  const pending = executeMatchQuery(
    { kind: 'central', seed: 17, time: 4 },
    { filters: { type: 'pass', result: null } },
  );
  assert.ok(pending.rows.every((e) => e.result === null));
  assert.equal(executeMatchQuery(input, { filters: { player: 'Unknown Person' } }).count, 0);
});
test('authored assist and foot filters respect pending goal confirmation and exact actions', () => {
  const pending = executeMatchQuery(
    { ...input, time: 116 },
    { filters: { type: 'shot', result: true } },
  );
  assert.equal(pending.count, 0);
  const assist = executeMatchQuery(
    { ...input, time: 118 },
    { filters: { type: 'shot', result: true, assistPlayer: 'J. Cole' } },
  );
  assert.equal(assist.count, 1);
  assert.equal(assist.rows[0].assist.passId, 'comparison-sustained-17-pass-110');
  assert.equal(assist.rows[0].time, 116);
  const leftPass = executeMatchQuery(
    { ...input, time: 118 },
    { filters: { type: 'pass', bodyPart: 'left-foot' }, order: 'desc', limit: 1 },
  );
  assert.equal(leftPass.rows[0].time, 110);
  const leftShot = executeMatchQuery(
    { ...input, time: 98 },
    { filters: { type: 'shot', bodyPart: 'left-foot' }, order: 'desc', limit: 1 },
  );
  assert.equal(leftShot.rows[0].time, 96);
  assert.equal(leftShot.rows[0].revision, 2);
});
test('arbitrary fields and unbounded requests fail before querying', () => {
  for (const q of [
    null,
    [],
    { filters: { speed: 3 } },
    { filters: { bodyPart: 'left' } },
    { filters: { result: 'true' } },
    { limit: 21 },
    { limit: 0 },
    { timeFrom: -1 },
    { timeFrom: 50, timeTo: 40 },
    { aggregate: 'sql' },
    { order: 'random' },
    { extra: true },
  ])
    assert.throws(() => executeMatchQuery(input, q));
  assert.throws(() => executeMatchQuery({ ...input, question: 'unsafe' }, {}));
});

test('explicit null attributes remain unknown rather than proving absence', () => {
  const stateFactory = (args) => {
    const s = matchState(args);
    s.events.forEach((e) => {
      e.bodyPart = null;
      e.assist = { player: null };
    });
    return s;
  };
  for (const filters of [
    { type: 'shot', bodyPart: 'left-foot' },
    { type: 'shot', assistPlayer: 'J. Cole' },
  ]) {
    const result = executeMatchQuery(input, { filters }, { stateFactory });
    assert.equal(result.count, 0);
    assert.ok(result.scope.missingFields[filters.bodyPart ? 'bodyPart' : 'assistPlayer'] > 0);
  }
  const pending = executeMatchQuery(
    { kind: 'central', seed: 17, time: 4 },
    { filters: { type: 'pass', result: null } },
  );
  assert.equal(pending.scope.missingFields.result, 0);
});

test('model rows contain football facts and clocks, never arbitrary provider or animation payloads', () => {
  const stateFactory = (args) => {
    const s = matchState(args);
    s.events.forEach((e) => {
      e.players = Array(1000).fill({ x: 4, y: 5 });
      e.internalNote = 'untrusted extra provider text';
    });
    return s;
  };
  const result = executeMatchQuery(
    input,
    { filters: { type: 'shot' }, order: 'desc', limit: 1 },
    { stateFactory },
  );
  assert.equal(result.rows[0].clock, '01:36');
  assert.equal(result.rows[0].receivedClock, '01:36');
  assert.equal(result.rows[0].bodyPart, 'left-foot');
  assert.ok(!Object.hasOwn(result.rows[0], 'players'));
  assert.ok(!Object.hasOwn(result.rows[0], 'internalNote'));
  assert.match(result.coordinateSystem, /percentages/);
});

test('group thresholds and ranking apply to complete counts before result limits', () => {
  const stateFactory = (args) => {
    const s = matchState(args);
    s.events = [];
    for (const [name, total] of [
      ['Alpha', 2],
      ['Bravo', 5],
      ['Charlie', 7],
      ['Delta', 5],
    ]) {
      for (let i = 0; i < total; i++)
        s.events.push({
          id: `${name}-${i}`,
          revision: 1,
          type: 'shot',
          time: i,
          arrivedAt: i,
          team: 'home',
          player: name,
          playerId: name,
          result: false,
          outcome: 'off-target',
        });
    }
    s.frames.at(-1).players = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, i) => ({
      id: name,
      name,
      team: 'home',
      number: i + 1,
    }));
    // A future arrival must not help a player reach the threshold.
    s.events.push({
      id: 'future',
      revision: 1,
      type: 'shot',
      time: 1,
      arrivedAt: 100,
      team: 'home',
      player: 'Alpha',
      playerId: 'Alpha',
      result: false,
    });
    return s;
  };
  const ranked = executeMatchQuery(
    input,
    { filters: { type: 'shot' }, aggregate: 'by-player', groupCount: { min: 5 }, limit: 1 },
    { stateFactory },
  );
  assert.equal(ranked.groups[0].label, 'Charlie');
  assert.equal(ranked.groups[0].count, 7);
  assert.equal(ranked.matchedGroupCount, 3);
  assert.equal(ranked.truncated, true);
  assert.equal(ranked.count, 19);
  const exact = executeMatchQuery(
    input,
    { filters: { type: 'shot' }, aggregate: 'by-player', groupCount: { min: 5, max: 5 } },
    { stateFactory },
  );
  assert.deepEqual(
    exact.groups.map((g) => g.label),
    ['Bravo', 'Delta'],
  );
  assert.equal(exact.truncated, false);
  const none = executeMatchQuery(
    input,
    { filters: { type: 'shot' }, aggregate: 'by-player', groupCount: { min: 20 } },
    { stateFactory },
  );
  assert.equal(none.groups.length, 0);
  assert.equal(none.matchedGroupCount, 0);
  assert.equal(none.truncated, false);
  assert.ok(none.evidence.some((r) => r.type === 'scope'));
  const ascending = executeMatchQuery(
    input,
    { filters: { type: 'shot' }, aggregate: 'by-player', groupOrder: 'count-asc', limit: 1 },
    { stateFactory },
  );
  assert.equal(ascending.groups[0].label, 'Alpha');
  assert.equal(ascending.groups[0].count, 2);
});

test('group constraints require valid bounds and a grouped aggregate', () => {
  for (const q of [
    { aggregate: 'count', groupCount: { min: 1 } },
    { aggregate: 'by-player', groupCount: { min: 5, max: 2 } },
    { aggregate: 'by-player', groupCount: { min: 1.5 } },
    { aggregate: 'by-player', groupCount: { extra: 1 } },
    { aggregate: 'by-team', groupOrder: 'random' },
    { groupOrder: 'count-desc' },
  ])
    assert.throws(() => executeMatchQuery(input, q));
});

test('shots on target include confirmed goals and saves, not blocks, misses or pending attempts', () => {
  const before = executeMatchQuery(
    { ...input, time: 96 },
    { filters: { type: 'shot', outcome: 'on-target' } },
  );
  assert.equal(before.count, 0);
  const saved = executeMatchQuery(
    { ...input, time: 98 },
    { filters: { type: 'shot', outcome: 'on-target' } },
  );
  assert.equal(saved.count, 1);
  assert.equal(saved.rows[0].outcome, 'saved');
  const confirmed = executeMatchQuery(
    { ...input, time: 118 },
    { filters: { type: 'shot', outcome: 'on-target' }, aggregate: 'by-player' },
  );
  assert.equal(confirmed.count, 2);
  assert.equal(
    executeMatchQuery({ ...input, time: 116 }, { filters: { type: 'shot', outcome: 'on-target' } })
      .count,
    1,
  );
});
test('assister grouping uses credited player identity, never the scorer or preceding passer', () => {
  const q = { filters: { type: 'shot', result: true }, aggregate: 'by-assister' };
  assert.equal(executeMatchQuery({ ...input, time: 116 }, q).count, 0);
  const answer = executeMatchQuery({ ...input, time: 118 }, q);
  assert.equal(answer.groups[0].key, 'home-7');
  assert.equal(answer.groups[0].label, 'J. Cole');
  assert.equal(answer.groups[0].count, 1);
  assert.equal(
    executeMatchQuery({ ...input, time: 118 }, { filters: { assistPlayer: 'home-7' } }).count,
    1,
  );
  const unknown = executeMatchQuery({ ...input, time: 118 }, q, {
    stateFactory: (args) => {
      const s = matchState(args);
      s.events.forEach((e) => delete e.assist);
      return s;
    },
  });
  assert.equal(unknown.count, 0);
  assert.equal(unknown.scope.missingFields.assistPlayer, 1);
});
test('pass styles and outside-foot technique are searchable provider attributes with coverage', () => {
  const fixture = { kind: 'duel', seed: 1001, time: 120 };
  for (const filters of [
    { type: 'pass', passType: 'cross' },
    { type: 'pass', technique: 'trivela' },
    { type: 'pass', passType: 'long' },
  ]) {
    const answer = executeMatchQuery(fixture, { filters });
    assert.ok(answer.count > 0);
    assert.ok(answer.rows.every((e) => Object.entries(filters).every(([k, v]) => e[k] === v)));
  }
  const missing = executeMatchQuery(
    fixture,
    { filters: { type: 'pass', technique: 'trivela' } },
    {
      stateFactory: (args) => {
        const s = matchState(args);
        s.events.forEach((e) => delete e.technique);
        return s;
      },
    },
  );
  assert.equal(missing.count, 0);
  assert.ok(missing.scope.missingFields.technique > 0);
});

test('receiver queries resolve roster identity and separate attempted from completed passes', () => {
  const q = { filters: { type: 'pass', receiver: 'A. Reed' } };
  const pending = executeMatchQuery({ ...input, time: 10 }, q);
  assert.equal(pending.count, 1);
  assert.equal(pending.rows[0].result, null);
  assert.equal(
    executeMatchQuery({ ...input, time: 10 }, { filters: { ...q.filters, result: true } }).count,
    0,
  );
  const done = executeMatchQuery(
    { ...input, time: 14 },
    { filters: { type: 'pass', receiver: 'home-10', result: true } },
  );
  assert.equal(done.count, 1);
  assert.equal(done.rows[0].player, 'J. Cole');
});
test('zero-count queries include eligible roster players and team comparisons retain zeros', () => {
  const q = {
    filters: { type: 'shot', team: 'home' },
    aggregate: 'by-player',
    groupCount: { max: 0 },
  };
  const none = executeMatchQuery({ ...input, time: 0 }, q);
  assert.equal(none.groups.length, 11);
  assert.ok(none.groups.every((g) => g.count === 0));
  const later = executeMatchQuery({ ...input, time: 96 }, q);
  assert.equal(later.groups.length, 10);
  assert.ok(!later.groups.some((g) => g.key === 'home-10'));
  const teams = executeMatchQuery(
    { ...input, time: 96 },
    { filters: { type: 'shot' }, aggregate: 'by-team' },
  );
  assert.equal(teams.groups.length, 2);
  assert.equal(teams.groups.find((g) => g.key === 'away').count, 0);
  const only = executeMatchQuery(
    { ...input, time: 96 },
    { ...q, filters: { ...q.filters, player: 'home-5' } },
  );
  assert.equal(only.groups.length, 1);
  const changed = executeMatchQuery({ ...input, time: 0 }, q, {
    stateFactory: (args) => {
      const s = matchState(args);
      s.frames.at(-1).players[0].name = 'Updated name';
      return s;
    },
  });
  assert.notEqual(changed.scopeReference.id, none.scopeReference.id);
});

test('identity resolution distinguishes absent players from known players with no actions', () => {
  const absent = executeMatchQuery(
    { ...input, time: 0 },
    { filters: { player: 'Messi', type: 'shot' }, aggregate: 'count' },
  );
  const known = executeMatchQuery(
    { ...input, time: 0 },
    { filters: { player: 'Cole', type: 'shot' }, aggregate: 'count' },
  );
  assert.equal(absent.count, 0);
  assert.equal(known.count, 0);
  assert.equal(absent.entityResolution.player.status, 'absent');
  assert.equal(absent.entityResolution.player.canonicalId, null);
  assert.deepEqual(absent.entityResolution.player.candidates, []);
  assert.equal(known.entityResolution.player.status, 'resolved');
  assert.equal(known.entityResolution.player.canonicalId, 'home-7');
  assert.deepEqual(known.scope.entityResolution, known.entityResolution);
});

test('names, unique surnames and IDs resolve for actors, receivers and credited assisters', () => {
  for (const value of ['j.cole', 'J COLE', '  cole  ', 'HOME-7']) {
    const answer = executeMatchQuery({ ...input, time: 118 }, { filters: { player: value } });
    assert.ok(answer.count > 0);
    assert.ok(answer.rows.every((e) => e.playerId === 'home-7'));
    assert.equal(answer.entityResolution.player.canonicalId, 'home-7');
  }
  const receiver = executeMatchQuery(
    { ...input, time: 118 },
    { filters: { receiver: 'reed', type: 'pass' } },
  );
  assert.ok(receiver.count > 0);
  assert.ok(receiver.rows.every((e) => e.receiverId === 'home-10'));
  assert.equal(receiver.entityResolution.receiver.canonicalId, 'home-10');
  const assister = executeMatchQuery(
    { ...input, time: 118 },
    { filters: { assistPlayer: 'cole', result: true, type: 'shot' } },
  );
  assert.equal(assister.count, 1);
  assert.equal(assister.entityResolution.assistPlayer.canonicalId, 'home-7');
  const zero = executeMatchQuery(
    { ...input, time: 0 },
    { filters: { player: 'cole', type: 'shot' }, aggregate: 'by-player', groupCount: { max: 0 } },
  );
  assert.deepEqual(
    zero.groups.map((g) => g.key),
    ['home-7'],
  );
});

test('ambiguous surnames require disambiguation and never pick an arbitrary identity', () => {
  const stateFactory = (args) => {
    const s = matchState(args);
    s.frames.at(-1).players.find((p) => p.id === 'away-7').name = 'D. Cole';
    return s;
  };
  const ambiguous = executeMatchQuery(input, { filters: { player: 'Cole' } }, { stateFactory });
  assert.equal(ambiguous.entityResolution.player.status, 'ambiguous');
  assert.equal(ambiguous.entityResolution.player.canonicalId, null);
  assert.equal(ambiguous.entityResolution.player.candidates.length, 2);
  assert.equal(ambiguous.count, 0);
  assert.equal(
    executeMatchQuery(input, { filters: { player: 'Cole', team: 'home' } }, { stateFactory })
      .entityResolution.player.canonicalId,
    'home-7',
  );
  assert.equal(
    executeMatchQuery(input, { filters: { player: 'J. Cole' } }, { stateFactory }).entityResolution
      .player.canonicalId,
    'home-7',
  );
  assert.equal(
    executeMatchQuery(input, { filters: { player: 'Coel' } }, { stateFactory }).entityResolution
      .player.status,
    'absent',
  );
  const zero = executeMatchQuery(
    input,
    { filters: { player: 'Cole' }, aggregate: 'by-player', groupCount: { max: 0 } },
    { stateFactory },
  );
  assert.deepEqual(zero.groups, []);
});

test('resolution uses only received identities and binds changed candidates into evidence', () => {
  const query = { filters: { player: 'Guest' }, timeFrom: 90 };
  const factory = (arrivedAt) => (args) => {
    const s = matchState(args);
    s.events.push({
      id: 'guest-event',
      revision: 1,
      type: 'pass',
      time: 5,
      arrivedAt,
      playerId: 'guest-1',
      player: 'A. Guest',
      team: 'home',
    });
    return s;
  };
  const future = executeMatchQuery(input, query, { stateFactory: factory(100) });
  const received = executeMatchQuery(input, query, { stateFactory: factory(95) });
  assert.equal(future.entityResolution.player.status, 'absent');
  assert.equal(received.entityResolution.player.status, 'resolved');
  assert.equal(received.count, 0);
  assert.equal(future.count, 0);
  assert.notEqual(received.scopeReference.id, future.scopeReference.id);
});

test('unknown linked-shot outcomes mark incomplete coverage and suppress canonical collection totals', () => {
  const input = { kind: 'counter', seed: 2063, time: 90 },
    base = matchState(input);
  const query = {
    filters: {
      type: 'recovery',
      player: 'home-1',
      recoveryKind: 'goalkeeper-hold',
      linkedShotOutcome: 'saved',
    },
    aggregate: 'count',
    timeFrom: 0,
    timeTo: 90,
  };
  for (const change of [
    (s) => delete s.result,
    (s) => (s.result = 'invalid'),
    (s) => (s.result = 0),
    (s) => {
      s.result = false;
      s.outcome = 'unknown';
    },
    (s) => {
      s.result = false;
      delete s.outcome;
    },
  ]) {
    const state = structuredClone(base),
      shot = state.events.find((e) => e.id.endsWith('shot-26'));
    change(shot);
    const run = (q) => executeMatchQuery(input, q, { stateFactory: () => state }),
      source = run(query);
    assert.equal(source.count, 1);
    assert.equal(source.scope.missingFields.linkedShotOutcome, 1);
    const onTarget = run({
      ...query,
      filters: { ...query.filters, linkedShotOutcome: 'on-target' },
    });
    assert.equal(onTarget.count, 1);
    assert.equal(onTarget.scope.missingFields.linkedShotOutcome, 1);
    const facts = buildQuestionFacts({
      observedAt: 90,
      responseLanguage: 'en',
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
    });
    assert.equal(
      facts.facts.some((f) => f.proof.kind === 'count'),
      false,
      'Known remaining match is not a complete total when another linked outcome is unknown',
    );
  }
});

test('canonical linked outcome statuses retain exact and on-target semantics', () => {
  const input = { kind: 'counter', seed: 2063, time: 90 },
    base = matchState(input),
    query = {
      filters: { type: 'recovery', player: 'home-1', recoveryKind: 'goalkeeper-hold' },
      aggregate: 'count',
      timeFrom: 0,
      timeTo: 90,
    };
  for (const [status, result, outcome] of [
    ['goal', true, undefined],
    ['pending', null, undefined],
    ['saved', false, 'saved'],
    ['blocked', false, 'blocked'],
    ['off-target', false, 'off-target'],
    ['on-target', false, 'on-target'],
  ]) {
    const state = structuredClone(base);
    for (const shot of state.events.filter((e) =>
      ['comparison-counter-2063-shot-26', 'comparison-counter-2063-shot-86'].includes(e.id),
    )) {
      shot.result = result;
      shot.outcome = outcome;
    }
    const run = (filter) =>
      executeMatchQuery(
        input,
        { ...query, filters: { ...query.filters, linkedShotOutcome: filter } },
        { stateFactory: () => state },
      );
    const exact = run(status);
    assert.equal(exact.count, 2, status);
    assert.equal(exact.scope.missingFields.linkedShotOutcome, 0, status);
    assert.equal(
      run('on-target').count,
      ['goal', 'saved', 'on-target'].includes(status) ? 2 : 0,
      status,
    );
  }
});

test('malformed pass results cannot erase a possible tied leader from a complete ranking', () => {
  const input = { kind: 'quiet', seed: 2063, time: 42 },
    base = matchState(input),
    query = {
      filters: { type: 'pass', result: true },
      aggregate: 'by-player',
      groupOrder: 'count-desc',
      limit: 20,
      timeFrom: 0,
      timeTo: 42,
    };
  for (const value of ['unknown', 'false', 0, 1, {}, undefined]) {
    const state = structuredClone(base),
      cole = state.events.find(
        (e) => e.type === 'pass' && e.playerId === 'home-7' && e.result === true,
      );
    cole.result = value;
    const source = executeMatchQuery(input, query, { stateFactory: () => state });
    assert.equal(source.count, 2);
    assert.equal(source.scope.missingFields.result, 1);
    assert.equal(source.truncated, false);
    const facts = buildQuestionFacts({
      observedAt: 42,
      responseLanguage: 'en',
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
    });
    assert.equal(
      facts.facts.some((f) => f.proof.kind === 'player-count-ranking' || f.proof.kind === 'count'),
      false,
      'Unknown Cole outcome prevents claiming the other two are all leaders',
    );
  }
});

test('shot outcome filters mark malformed classifications missing without aliasing known states', () => {
  const input = { kind: 'counter', seed: 2063, time: 90 },
    base = matchState(input),
    query = {
      filters: { type: 'shot', outcome: 'saved' },
      aggregate: 'count',
      timeFrom: 0,
      timeTo: 90,
    };
  for (const change of [
    (s) => delete s.result,
    (s) => (s.result = 'false'),
    (s) => (s.result = 0),
    (s) => {
      s.result = false;
      s.outcome = 'unknown';
    },
    (s) => {
      s.result = false;
      delete s.outcome;
    },
  ]) {
    const state = structuredClone(base),
      shot = state.events.find((e) => e.id.endsWith('shot-26'));
    change(shot);
    const source = executeMatchQuery(input, query, { stateFactory: () => state });
    assert.equal(source.scope.missingFields.outcome, 1);
    const onTarget = executeMatchQuery(
      input,
      { ...query, filters: { type: 'shot', outcome: 'on-target' } },
      { stateFactory: () => state },
    );
    assert.equal(onTarget.scope.missingFields.outcome, 1);
  }
  for (const [status, result, outcome] of [
    ['goal', true, undefined],
    ['pending', null, undefined],
    ['saved', false, 'saved'],
    ['blocked', false, 'blocked'],
    ['off-target', false, 'off-target'],
    ['on-target', false, 'on-target'],
  ]) {
    const state = structuredClone(base);
    state.events = state.events.filter((e) => e.type !== 'shot' || e.id.endsWith('shot-26'));
    const shot = state.events.find((e) => e.type === 'shot');
    shot.result = result;
    shot.outcome = outcome;
    const source = executeMatchQuery(
      input,
      { ...query, filters: { type: 'shot', outcome: status } },
      { stateFactory: () => state },
    );
    assert.equal(source.count, 1, status);
    assert.equal(source.scope.missingFields.outcome, 0, status);
  }
});
