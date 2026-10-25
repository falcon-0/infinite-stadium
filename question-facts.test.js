import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuestionFacts,
  selectQuestionFacts,
  projectQuestionFactWindows,
} from './question-facts.js';
import { numericAssertions } from './question-evidence-check.js';
import { directQuestionFacts } from './direct-question-facts.js';
import { matchState } from './match-stream.js';
import { executeMatchQuery } from './match-query.js';
const reference = (id, type = 'scope', revision = 1) => ({ type, id, revision });

test('writer window projection keeps requested scopes and unwindowed facts without changing source proofs', () => {
  const manifest = {
    facts: [
      { id: 'whole', proof: { timeFrom: 0, timeTo: 120 } },
      { id: 'recent', proof: { timeFrom: 90, timeTo: 120 } },
      { id: 'open-boundary', proof: { timeFrom: 0, timeTo: 120, timeFromExclusive: true } },
      { id: 'event', proof: { time: 96 } },
    ],
  };
  const original = structuredClone(manifest),
    whole = { query: { timeFrom: 0, timeTo: 120 } };
  const projected = projectQuestionFactWindows(manifest, [whole]);
  assert.deepEqual(
    projected.facts.map((f) => f.id),
    ['whole', 'event'],
  );
  assert.deepEqual(manifest, original);
  assert.deepEqual(
    projectQuestionFactWindows(manifest, [
      whole,
      { query: { timeFrom: 90, timeTo: 120 } },
    ]).facts.map((f) => f.id),
    ['whole', 'recent', 'event'],
  );
  assert.equal(projectQuestionFactWindows(manifest, []), manifest);
  assert.ok(Object.isFrozen(projected.facts[0].proof));
});
const query = (
  id,
  filters,
  groups,
  {
    aggregate = 'by-player',
    count = groups.reduce((n, g) => n + g.count, 0),
    from = 0,
    to = 120,
    ...rest
  } = {},
) => ({
  scopeReference: reference(id),
  query: { filters, aggregate, timeFrom: from, timeTo: to },
  count,
  groups,
  rows: [],
  truncated: false,
  scope: { missingFields: {} },
  entityResolution: {},
  ...rest,
});
const packet = () => ({
  question: 'What happened?',
  responseLanguage: 'en',
  observedAt: 120,
  teams: { home: 'Northbridge', away: 'Harbour Athletic' },
  roster: [
    { id: 'reed', name: 'A. Reed', team: 'home' },
    { id: 'silva', name: 'B. Silva', team: 'away' },
  ],
  mentionedPlayerResolution: [{ status: 'resolved', canonicalId: 'reed' }],
  queryResults: [],
  requestedEvidence: [],
});
const row = (overrides = {}) => ({
  id: 'pass',
  revision: 2,
  type: 'pass',
  time: 62,
  arrivedAt: 66,
  team: 'away',
  playerId: 'silva',
  player: 'B. Silva',
  receiverId: 'reed',
  result: false,
  outcome: null,
  evidence: [reference('pass', 'event', 2)],
  ...overrides,
});

test('one-pass goal sequences include the confirmed scorer without repeating the delivery', () => {
  const state = matchState({ kind: 'sustained', seed: 17, time: 118 });
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      responseLanguage: language,
      observedAt: 118,
      answerFocus: 'event-sequence',
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      linkedContext: { rows: state.events },
    };
    const story = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'linked-goal-sequence');
    assert.ok(story, language);
    assert.equal(story.claim.kind, 'observation');
    assert.equal(story.proof.modelGenerated, false);
    assert.match(story.claim.text, /J\. Cole/);
    assert.match(story.claim.text, /A\. Reed/);
    assert.match(story.claim.text, /01:56/);
    assert.equal(story.proof.links.filter((link) => link.eventId.includes('-pass-')).length, 1);
  }
});

test('shot supply requires an explicit completed linked pass and never invents a goal assist', () => {
  const state = matchState({ kind: 'interrupted', seed: 41, time: 118 }),
    shot = state.events.find((e) => e.id === 'comparison-interrupted-41-shot-106');
  const make = () => ({
    ...packet(),
    observedAt: 118,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    linkedContext: { rows: structuredClone(state.events) },
  });
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = make();
    p.responseLanguage = language;
    const fact = buildQuestionFacts(p).facts.find(
      (f) => f.proof.kind === 'linked-shot-supply' && f.proof.eventId === shot.id,
    );
    assert.ok(fact, language);
    assert.equal(fact.claim.kind, 'observation');
    assert.equal(fact.proof.modelGenerated, false);
    assert.equal(fact.proof.supplierId, 'away-7');
    assert.equal(fact.proof.playerId, 'away-10');
    assert.equal(fact.proof.assistBasis, 'confirmed-non-goal-shot');
    assert.equal(fact.proof.passId, 'comparison-interrupted-41-pass-100');
    assert.equal(fact.claim.evidence.length, 2);
    assert.match(fact.claim.text, /B\. Kamau/);
    assert.match(fact.claim.text, /I\. Moreno/);
  }
  for (const change of [
    (rows) => rows.filter((e) => e.id === shot.id).forEach((e) => delete e.passId),
    (rows) =>
      rows
        .filter((e) => e.id === shot.passId)
        .forEach((e) => {
          e.result = false;
        }),
    (rows) =>
      rows
        .filter((e) => e.id === shot.passId)
        .forEach((e) => {
          e.receiverId = 'home-10';
        }),
    (rows) =>
      rows
        .filter((e) => e.id === shot.id)
        .forEach((e) => {
          e.result = null;
          e.outcome = null;
        }),
  ]) {
    const p = make();
    change(p.linkedContext.rows);
    assert.equal(
      buildQuestionFacts(p).facts.some(
        (f) => f.proof.kind === 'linked-shot-supply' && f.proof.eventId === shot.id,
      ),
      false,
    );
  }
});

test('keeper-hold facts join the current saved shot by explicit cause in every language', () => {
  const state = matchState({ kind: 'duel', seed: 1004, time: 30 });
  const hold = state.events.find(
      (e) => e.type === 'recovery' && e.recoveryKind === 'goalkeeper-hold',
    ),
    shot = state.events.find((e) => e.id === hold.cause);
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      observedAt: 30,
      responseLanguage: language,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      linkedContext: { rows: state.events },
    };
    const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'linked-goalkeeper-hold');
    assert.ok(fact, language);
    assert.equal(fact.proof.holderId, 'away-1');
    assert.equal(fact.proof.shooterId, 'home-10');
    assert.equal(fact.proof.eventId, hold.id);
    assert.equal(fact.proof.shotId, shot.id);
    assert.equal(fact.proof.linkBasis, 'explicit-cause');
    assert.deepEqual(fact.claim.evidence, [
      reference(hold.id, 'event', hold.revision),
      reference(shot.id, 'event', shot.revision),
    ]);
    assert.match(fact.claim.text, /J\. Laurent/);
    assert.match(fact.claim.text, /P\. Demir/);
    assert.match(fact.claim.text, /00:24/);
    assert.match(fact.claim.text, /00:22/);
    assert.equal(fact.claim.kind, 'observation');
    assert.equal(fact.proof.modelGenerated, false);
  }
});

test('keeper-hold facts reject missing, stale, ambiguous and incompatible links without guessing a player role', () => {
  const state = matchState({ kind: 'duel', seed: 1004, time: 30 });
  const make = () => ({
    ...packet(),
    observedAt: 30,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    linkedContext: { rows: structuredClone(state.events) },
  });
  const hold = (rows) =>
      rows.find((e) => e.type === 'recovery' && e.recoveryKind === 'goalkeeper-hold'),
    shot = (rows) => rows.find((e) => e.type === 'shot');
  const invalid = [
    (rows) => {
      delete hold(rows).cause;
    },
    (rows) => {
      hold(rows).cause = 'unreceived-shot';
    },
    (rows) => {
      hold(rows).recoveryKind = 'loose-ball';
    },
    (rows) => {
      hold(rows).time = shot(rows).time;
    },
    (rows) => {
      hold(rows).arrivedAt = 31;
    },
    (rows) => {
      hold(rows).playerId = 'missing-player';
    },
    (rows) => {
      hold(rows).team = 'home';
    },
    (rows) => {
      shot(rows).team = 'away';
      shot(rows).playerId = 'away-10';
    },
    (rows) => {
      shot(rows).result = null;
      delete shot(rows).outcome;
    },
    (rows) => {
      shot(rows).outcome = 'blocked';
    },
    (rows) => {
      shot(rows).result = true;
      shot(rows).outcome = 'goal';
    },
    (rows) => {
      rows.push({ ...shot(rows), revision: 2, outcome: 'off-target' });
    },
    (rows) => {
      rows.push({ ...shot(rows), revision: 2, operation: 'delete' });
    },
    (rows) => {
      rows.push({ ...hold(rows), revision: 2, operation: 'delete' });
    },
    (rows) => {
      rows.push({ ...shot(rows), outcome: 'blocked' });
    },
    (rows) => {
      rows.push({ ...hold(rows), id: 'ambiguous-other-hold', playerId: 'away-2' });
    },
  ];
  for (const [index, change] of invalid.entries()) {
    const p = make();
    change(p.linkedContext.rows);
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'linked-goalkeeper-hold'),
      false,
      `invalid link ${index}`,
    );
  }
  // Source role comes from the explicit event, not a keeper-looking roster ID.
  const nonOne = make();
  hold(nonOne.linkedContext.rows).playerId = 'away-2';
  const fact = buildQuestionFacts(nonOne).facts.find(
    (f) => f.proof.kind === 'linked-goalkeeper-hold',
  );
  assert.equal(fact.proof.holderId, 'away-2');
  assert.match(fact.claim.text, /O\. Bello/);
});

test('named resolved roster facts expose only recorded valid shirt numbers in four languages', () => {
  const make = () => {
    const p = packet();
    p.roster[0].number = 23;
    p.queryResults = [
      query('reed-lookup', { player: 'reed' }, [], {
        entityResolution: { player: { status: 'resolved', canonicalId: 'reed' } },
      }),
    ];
    return p;
  };
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = make();
    p.responseLanguage = language;
    const facts = buildQuestionFacts(p).facts;
    const fact = facts.find((f) => f.proof.kind === 'roster' && f.proof.attributes?.number === 23);
    assert.ok(fact, language);
    assert.match(fact.claim.text, /A\. Reed/);
    assert.match(fact.claim.text, /23/);
    assert.equal(fact.proof.playerId, 'reed');
    assert.equal(fact.proof.team, 'home');
    assert.deepEqual(fact.claim.evidence, [reference('reed-lookup')]);
    assert.deepEqual(fact.proof.scope, reference('reed-lookup'));
    assert.equal(fact.proof.modelGenerated, false);
    assert.ok(facts.some((f) => f.proof.kind === 'roster' && !f.proof.attributes));
  }
  for (const number of [
    undefined,
    null,
    '23',
    0,
    -1,
    2.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const p = make();
    p.roster[0].number = number;
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'roster' && f.proof.attributes),
      false,
      String(number),
    );
  }
  for (const change of [
    (p) => {
      p.queryResults = [];
    },
    (p) => {
      p.queryResults[0].entityResolution.player.status = 'ambiguous';
    },
    (p) => {
      p.queryResults[0].entityResolution.player.canonicalId = 'silva';
    },
    (p) => {
      p.mentionedPlayerResolution = [];
    },
  ]) {
    const p = make();
    change(p);
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'roster' && f.proof.attributes),
      false,
    );
  }
});

test('pass technique and type facts preserve current recorded attributes in four languages', () => {
  const state = matchState({ kind: 'duel', seed: 1004, time: 15 });
  const make = () => ({
    ...packet(),
    observedAt: 15,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    linkedContext: { rows: structuredClone(state.events) },
  });
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = make();
    p.responseLanguage = language;
    const facts = buildQuestionFacts(p).facts;
    const technique = facts.find((f) => f.proof.attributes?.technique === 'trivela');
    assert.ok(technique, language);
    assert.match(technique.claim.text, /A\. Ali/);
    assert.match(technique.claim.text, /trivela/);
    assert.match(technique.claim.text, /00:06/);
    assert.deepEqual(technique.claim.evidence, [
      reference('comparison-duel-1004-pass-6', 'event', 2),
    ]);
    assert.equal(technique.proof.kind, 'event');
    const cross = facts.find((f) => f.proof.attributes?.passType === 'cross');
    assert.ok(cross, language);
    assert.match(cross.claim.text, /U\. Ahmed/);
    assert.deepEqual(cross.claim.evidence, [reference('comparison-duel-1004-pass-10', 'event', 2)]);
  }
  for (const field of ['technique', 'passType'])
    for (const value of [undefined, null, 'unknown', 'toString', 'invented']) {
      const p = make();
      for (const e of p.linkedContext.rows) e[field] = value;
      assert.equal(
        buildQuestionFacts(p).facts.some((f) => Object.hasOwn(f.proof.attributes || {}, field)),
        false,
        `${field}:${value}`,
      );
    }
  const revised = make(),
    pass = revised.linkedContext.rows.find((e) => e.type === 'pass' && e.technique === 'trivela');
  revised.linkedContext.rows.push({
    ...pass,
    revision: 3,
    technique: 'standard',
    passType: 'long',
  });
  const current = buildQuestionFacts(revised).facts.filter(
    (f) => f.proof.eventId === pass.id && f.proof.attributes,
  );
  assert.equal(
    current.some((f) => f.proof.attributes.technique === 'trivela'),
    false,
  );
  assert.ok(
    current.some((f) => f.proof.attributes.technique === 'standard' && f.proof.revision === 3),
  );
  assert.ok(current.some((f) => f.proof.attributes.passType === 'long'));
  const wrongType = make();
  for (const e of wrongType.linkedContext.rows) {
    e.type = 'shot';
    e.result = false;
    e.outcome = 'saved';
    e.technique = 'trivela';
    e.passType = 'cross';
  }
  assert.equal(
    buildQuestionFacts(wrongType).facts.some(
      (f) => f.proof.attributes?.technique || f.proof.attributes?.passType,
    ),
    false,
  );
});

test('complete unfiltered team partitions expose the combined total in each supported language', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    p.responseLanguage = language;
    p.queryResults = [
      query(
        'passes',
        { type: 'pass', result: true },
        [
          { key: 'home', count: 8 },
          { key: 'away', count: 3 },
        ],
        { aggregate: 'by-team' },
      ),
    ];
    const facts = buildQuestionFacts(p).facts,
      total = facts.find(
        (f) =>
          f.proof.kind === 'count' &&
          f.proof.metric === 'completedPasses' &&
          f.proof.subjectId === null,
      );
    assert.equal(total.proof.value, 11);
    assert.match(total.claim.text, /11/);
    assert.deepEqual(total.claim.evidence, [reference('passes')]);
    assert.equal(total.proof.query.aggregate, 'by-team');
    assert.deepEqual(
      facts
        .filter((f) => f.proof.kind === 'count' && f.proof.subjectId !== null)
        .map((f) => f.proof.value),
      [8, 3],
    );
  }
  for (const groups of [[], [{ key: 'home', count: 8 }]]) {
    const p = packet();
    p.queryResults = [query('zero-side', { type: 'pass' }, groups, { aggregate: 'by-team' })];
    assert.equal(
      buildQuestionFacts(p).facts.find(
        (f) => f.proof.kind === 'count' && f.proof.subjectId === null,
      ).proof.value,
      groups.length ? 8 : 0,
    );
  }
});

test('complete received shot lists establish measured comparisons without inferring chance quality', () => {
  const p = packet();
  p.observedAt = 118;
  const home = row({
      id: 'h',
      type: 'shot',
      team: 'home',
      playerId: 'reed',
      time: 84,
      arrivedAt: 84,
      result: false,
      outcome: 'blocked',
    }),
    away = [
      row({ id: 'a1', type: 'shot', time: 96, arrivedAt: 96, result: false, outcome: 'blocked' }),
      row({
        id: 'a2',
        type: 'shot',
        time: 110,
        arrivedAt: 110,
        result: false,
        outcome: 'off-target',
      }),
    ];
  p.requestedEvidence = [
    query('home-list', { type: 'shot', team: 'home' }, [], {
      aggregate: 'list',
      count: 1,
      rows: [home],
      from: 80,
      to: 118,
    }),
    query('away-list', { type: 'shot', team: 'away' }, [], {
      aggregate: 'list',
      count: 2,
      rows: away,
      from: 80,
      to: 118,
    }),
  ];
  let facts = buildQuestionFacts(p).facts;
  const comparisons = facts.filter((f) => f.proof.kind === 'team-comparison');
  assert.equal(comparisons.length, 2);
  assert.deepEqual(comparisons.find((f) => f.proof.metric === 'attempts').proof.values, {
    home: 1,
    away: 2,
  });
  assert.equal(comparisons.find((f) => f.proof.metric === 'attempts').proof.leader, 'away');
  assert.deepEqual(comparisons.find((f) => f.proof.metric === 'shotsOnTarget').proof.values, {
    home: 0,
    away: 0,
  });
  assert.ok(
    comparisons.every(
      (f) =>
        f.proof.assessmentBounds === 'this-measure-only' &&
        f.proof.timeFrom === 80 &&
        f.proof.timeTo === 118,
    ),
  );
  assert.ok(
    facts
      .filter((f) => f.proof.derivation === 'complete-shot-list')
      .every((f) => f.proof.query.aggregate === 'list'),
    'Preserve actual query, never relabel the source as a filtered count',
  );
  const duplicateView = structuredClone(p);
  duplicateView.queryResults = duplicateView.requestedEvidence.map((source) => ({
    ...structuredClone(source),
    rows: [],
    rowReferences: source.rows.flatMap((row) => row.evidence),
  }));
  assert.deepEqual(
    buildQuestionFacts(duplicateView).facts,
    buildQuestionFacts(p).facts,
    'A duplicate display view cannot replace complete requested rows',
  );
  for (const mutate of [
    (s) => (s.truncated = true),
    (s) => s.rows.pop(),
    (s) => (s.rows[1].id = s.rows[0].id),
    (s) => (s.rows[0].operation = 'delete'),
    (s) => (s.rows[0].arrivedAt = 119),
    (s) => (s.rows[0].time = 79),
  ]) {
    const changed = structuredClone(p);
    mutate(changed.requestedEvidence[1]);
    assert.equal(
      buildQuestionFacts(changed).facts.some((f) => f.proof.kind === 'team-comparison'),
      false,
    );
  }
  for (const outcome of [null, 'pending', 'unknown']) {
    const changed = structuredClone(p);
    Object.assign(changed.requestedEvidence[1].rows[0], {
      outcome,
      result: outcome === null || outcome === 'pending' ? null : false,
    });
    facts = buildQuestionFacts(changed).facts;
    assert.ok(
      facts.some((f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'attempts'),
    );
    assert.equal(
      facts.some((f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'shotsOnTarget'),
      false,
      'Unknown or pending outcomes cannot prove zero on-target shots',
    );
  }
});

test('combined totals do not use incomplete, restricted or malformed team partitions', () => {
  for (const mutate of [
    (s) => (s.truncated = true),
    (s) => (s.scope.missingFields.result = 1),
    (s) => s.count++,
    (s) => s.groups.push({ key: 'home', count: 0 }),
    (s) => (s.groups[1].key = 'unknown'),
    (s) => (s.query.filters.team = 'home'),
    (s) => (s.query.filters.player = 'reed'),
    (s) => (s.query.groupCount = { gte: 2 }),
    (s) => (s.entityResolution.team = { status: 'ambiguous' }),
    (s) => (s.query.timeTo = 121),
  ]) {
    const p = packet(),
      s = query(
        'bad',
        { type: 'pass', result: true },
        [
          { key: 'home', count: 8 },
          { key: 'away', count: 3 },
        ],
        { aggregate: 'by-team' },
      );
    mutate(s);
    p.queryResults = [s];
    assert.equal(
      buildQuestionFacts(p).facts.some(
        (f) => f.proof.kind === 'count' && f.proof.subjectId === null,
      ),
      false,
    );
  }
  const p = packet();
  p.queryResults = [
    query('historical', { type: 'pass' }, [{ key: 'home', count: 2 }], {
      aggregate: 'by-team',
      from: 20,
      to: 90,
    }),
  ];
  p.queryResults[0].query.timeFromExclusive = true;
  const total = buildQuestionFacts(p).facts.find(
    (f) => f.proof.kind === 'count' && f.proof.subjectId === null,
  );
  assert.equal(total.proof.timeFrom, 20);
  assert.equal(total.proof.timeTo, 90);
  assert.equal(total.proof.timeFromExclusive, true);
});

test('a selected team comparison subsumes only its exact proved operands, never the combined total', () => {
  const p = packet();
  p.queryResults = [
    query(
      'on-target',
      { type: 'shot', outcome: 'on-target' },
      [
        { key: 'home', count: 1 },
        { key: 'away', count: 0 },
      ],
      { aggregate: 'by-team' },
    ),
  ];
  const m = buildQuestionFacts(p),
    comparison = m.facts.find(
      (f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'shotsOnTargetFaced',
    );
  const atoms = comparison.proof.componentFactIds.map((id) => m.facts.find((f) => f.id === id)),
    total = m.facts.find((f) => f.proof.kind === 'count' && f.proof.subjectId === null);
  const result = selectQuestionFacts(m, [atoms[1].id, comparison.id, atoms[0].id, total.id]);
  assert.deepEqual(result.selectedFactIds, [comparison.id, total.id]);
  assert.deepEqual(result.originalToSelectedIndex, [0, 0, 0, 1]);
  assert.equal(
    selectQuestionFacts(
      m,
      atoms.map((f) => f.id),
    ).claims.length,
    2,
    'No unselected comparison is introduced',
  );
  for (const mutate of [
    (x) => (x.proof.margin = 99),
    (x) => (x.proof.values.home = 5),
    (x) => (x.proof.componentFactIds[1] = x.proof.componentFactIds[0]),
    (x) => (x.proof.operands[0].timeTo = 119),
    (x) => (x.claim.evidence = []),
  ]) {
    const changed = structuredClone(m);
    mutate(changed.facts.find((f) => f.id === comparison.id));
    assert.equal(selectQuestionFacts(changed, [comparison.id, atoms[0].id]).claims.length, 2);
  }
  const changed = structuredClone(m);
  changed.facts.find((f) => f.id === atoms[0].id).proof.scope.revision = 2;
  assert.equal(
    selectQuestionFacts(changed, [comparison.id, atoms[0].id]).claims.length,
    2,
    'Different source revision survives',
  );
});

test('ordered event facts subsume only the same revision and explicitly rendered attribute', () => {
  const p = packet(),
    shot = row({
      id: 'shot',
      type: 'shot',
      team: 'home',
      playerId: 'reed',
      player: 'A. Reed',
      result: false,
      outcome: 'saved',
      bodyPart: 'left-foot',
    });
  p.requestedEvidence = [
    query('last-left', { type: 'shot', bodyPart: 'left-foot' }, [], {
      aggregate: 'list',
      count: 1,
      rows: [shot],
    }),
  ];
  p.requestedEvidence[0].query.order = 'desc';
  p.requestedEvidence[0].query.limit = 1;
  const m = buildQuestionFacts(p),
    ordered = m.facts.find((f) => f.proof.kind === 'ordered-event'),
    atoms = m.facts.filter((f) => f.proof.kind === 'event');
  assert.ok(ordered);
  assert.equal(atoms.length, 2);
  const selected = selectQuestionFacts(m, [ordered.id, ...atoms.map((f) => f.id)]);
  assert.equal(selected.claims.length, 1);
  assert.deepEqual(selected.originalToSelectedIndex, [0, 0, 0]);
  assert.match(selected.claims[0].text, /left foot.*saved/);
  const bad = structuredClone(m);
  bad.facts.find((f) => f.id === ordered.id).proof.query.filters.bodyPart = 'right-foot';
  assert.equal(selectQuestionFacts(bad, [ordered.id, ...atoms.map((f) => f.id)]).claims.length, 2);
});

test('saved-shot collection counts require both the hold and linked saved outcome', () => {
  const p = packet();
  p.queryResults = [
    query(
      'saves',
      { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
      [{ key: 'silva', count: 1 }],
    ),
  ];
  const fact = buildQuestionFacts(p).facts.find(
    (f) => f.proof.metric === 'savedAttemptCollections',
  );
  assert.ok(fact);
  assert.match(fact.claim.text, /collected 1 saved shot/);
  p.queryResults[0].scope.missingFields.linkedShotOutcome = 1;
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.metric === 'savedAttemptCollections'),
    false,
  );
});

test('pass completion profiles use matching confirmed partitions and exclude pending outcomes', () => {
  const p = packet();
  p.queryResults = [
    query('completed', { type: 'pass', result: true }, [{ key: 'reed', count: 5 }]),
    query('failed', { type: 'pass', result: false }, [{ key: 'reed', count: 1 }]),
    query('pending', { type: 'pass', result: null }, [{ key: 'reed', count: 2 }]),
  ];
  const f = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'pass-completion-profile');
  assert.ok(f);
  assert.equal(f.proof.denominator, 6);
  assert.equal(f.proof.percentage, 83.3);
  assert.match(f.claim.text, /83.3%.*5 of 6.*confirmed/);
  assert.equal(f.proof.pendingExcluded, true);
  assert.equal(f.claim.evidence.length, 2);
  for (const mutate of [
    (q) => (q.query.timeFrom = 30),
    (q) => (q.scope.missingFields.result = 1),
    (q) => (q.truncated = true),
  ]) {
    const bad = structuredClone(p);
    mutate(bad.queryResults[1]);
    assert.equal(
      buildQuestionFacts(bad).facts.some((f) => f.proof.kind === 'pass-completion-profile'),
      false,
    );
  }
});

test('a saved-shot collection omits an equal ball-win total only for the same actor and window', () => {
  const p = packet();
  p.queryResults = [
    query(
      'saved',
      { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
      [{ key: 'silva', count: 1 }],
    ),
    query('wins', { type: 'recovery', recoveryClass: 'ball-win' }, [{ key: 'silva', count: 1 }]),
  ];
  const m = buildQuestionFacts(p),
    save = m.facts.find(
      (f) => f.proof.metric === 'savedAttemptCollections' && f.proof.subjectId === 'silva',
    ),
    win = m.facts.find((f) => f.proof.metric === 'ballWins' && f.proof.subjectId === 'silva');
  assert.ok(save && win);
  assert.equal(selectQuestionFacts(m, [save.id, win.id]).claims.length, 1);
  for (const mutate of [
    (f) => (f.proof.value = 2),
    (f) => (f.proof.timeFrom = 30),
    (f) => (f.proof.subjectId = 'reed'),
  ]) {
    const bad = structuredClone(m);
    mutate(bad.facts.find((f) => f.id === win.id));
    assert.equal(selectQuestionFacts(bad, [save.id, win.id]).claims.length, 2);
  }
});

test('a capability limitation requires explicit schema unavailability, not an empty action list', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      responseLanguage: language,
      requestedForm: 'explanation',
      evidenceCapabilities: { unavailable: ['player intention', 'verified open passing lanes'] },
    };
    const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'capability-limitation');
    assert.ok(fact);
    assert.equal(fact.claim.kind, 'limitation');
    assert.deepEqual(fact.claim.evidence, []);
    assert.equal(fact.proof.basis, 'trusted-event-schema');
    assert.equal(
      selectQuestionFacts(buildQuestionFacts(p), [fact.id]).claims[0].text,
      fact.claim.text,
    );
    delete p.evidenceCapabilities;
    assert.equal(buildQuestionFacts(p).facts.length, 0);
  }
});

test('natural final-pass wording requires the executed current goal relation and preserves ordering proof', () => {
  const p = packet(),
    pass = row({ result: true, receiverId: null }),
    goal = row({
      id: 'goal',
      type: 'shot',
      time: 100,
      result: true,
      passId: 'pass',
      receiverId: null,
      evidence: [reference('goal', 'event', 2)],
    });
  const q = query('before', { type: 'pass', team: 'away' }, [], {
    aggregate: 'list',
    count: 1,
    to: 100,
    rows: [pass],
  });
  Object.assign(q.query, { order: 'desc', limit: 1, timeToExclusive: true });
  p.requestedEvidence = [q];
  p.queryResults = [
    query('anchor', { id: 'goal' }, [], { aggregate: 'list', count: 1, rows: [goal] }),
  ];
  p.requestedMoment = { reference: reference('goal', 'event', 2), time: 100 };
  p.queryRelations = [
    {
      anchorIdentifiedBy: 'requested-moment',
      relation: 'before',
      sameTeam: true,
      scopeReference: q.scopeReference,
      anchor: p.requestedMoment.reference,
      anchorTime: 100,
    },
  ];
  const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event');
  assert.match(fact.claim.text, /^Last pass before the goal:/);
  assert.equal(fact.proof.timeToExclusive, true);
  assert.equal(fact.proof.scope.id, 'before');
  for (const mutate of [
    (p) => (p.requestedMoment.reference.revision = 3),
    (p) => (p.queryResults[0].rows[0].passId = 'other'),
    (p) => (p.queryRelations[0].sameTeam = false),
  ]) {
    const bad = structuredClone(p);
    mutate(bad);
    assert.doesNotMatch(
      buildQuestionFacts(bad).facts.find((f) => f.proof.kind === 'ordered-event').claim.text,
      /^Last pass before the goal:/,
    );
  }
});

test('ball-win scopes are distinct from raw recovery provenance and unknown classifications withhold completeness', () => {
  const p = packet();
  p.queryResults = [
    query('raw', { type: 'recovery' }, [{ key: 'reed', count: 2 }]),
    query('wins', { type: 'recovery', recoveryClass: 'ball-win' }, [{ key: 'reed', count: 1 }]),
  ];
  let facts = buildQuestionFacts(p).facts;
  const raw = facts.find((f) => f.proof.metric === 'recoveries'),
    win = facts.find((f) => f.proof.metric === 'ballWins');
  assert.match(raw.claim.text, /2 recovery records/);
  assert.doesNotMatch(raw.claim.text, /ball win/);
  assert.match(win.claim.text, /1 ball win/);
  assert.equal(win.claim.evidence[0].id, 'wins');
  assert.equal(win.proof.query.filters.recoveryClass, 'ball-win');
  p.queryResults[1].scope.missingFields.recoveryClass = 1;
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.metric === 'ballWins'),
    false,
  );
  p.queryResults = [
    query('events', { type: 'recovery' }, [], {
      aggregate: 'list',
      count: 2,
      rows: [
        row({ id: 'start', type: 'recovery', recoveryKind: 'segment-start' }),
        row({ id: 'unknown', type: 'recovery' }),
      ],
    }),
  ];
  facts = buildQuestionFacts(p).facts;
  assert.equal(facts.length, 1);
  assert.match(facts[0].claim.text, /starts with the ball/);
  assert.equal(facts[0].proof.eventId, 'start');
});

test('both-team zero-goal composite needs complete matching confirmed scopes and retains both proofs', () => {
  const p = packet();
  p.queryResults = [
    query('home', { type: 'shot', result: true, team: 'home' }, [], { aggregate: 'count' }),
    query('away', { type: 'shot', result: true, team: 'away' }, [], { aggregate: 'count' }),
  ];
  const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'confirmed-score');
  assert.ok(fact);
  assert.match(fact.claim.text, /Neither team has a confirmed goal yet/);
  assert.deepEqual(
    fact.claim.evidence.map((r) => r.id),
    ['home', 'away'],
  );
  assert.equal(fact.proof.operands.length, 2);
  for (const mutate of [
    (q) => (q.query.timeTo = 90),
    (q) => (q.query.timeFrom = 30),
    (q) => (q.query.timeFromExclusive = true),
    (q) => (q.scope.missingFields.result = 1),
    (q) => (q.truncated = true),
    (q) => (q.count = 1),
    (q) => (q.query.filters = { type: 'shot', outcome: 'pending', team: 'away' }),
  ]) {
    const bad = structuredClone(p);
    mutate(bad.queryResults[1]);
    assert.equal(
      buildQuestionFacts(bad).facts.some((f) => f.proof.kind === 'confirmed-score'),
      false,
    );
  }
  p.queryResults.forEach((q) => (q.query.timeTo = 30));
  const historical = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'confirmed-score');
  assert.match(historical.claim.text, /00:00.*00:30.*in this interval/);
  assert.doesNotMatch(historical.claim.text, /yet/);
});

function zeroSelectionFixture() {
  const p = packet();
  p.queryResults = [
    query('goals', { type: 'shot', result: true }, [], { aggregate: 'by-team' }),
    query('pending', { type: 'shot' }, [], {
      aggregate: 'list',
      count: 1,
      rows: [row({ id: 'pending', type: 'shot', result: null })],
    }),
  ];
  const manifest = buildQuestionFacts(p),
    composite = manifest.facts.find((f) => f.proof.kind === 'confirmed-score'),
    home = manifest.facts.find(
      (f) => f.proof.kind === 'count' && f.proof.metric === 'goals' && f.proof.subjectId === 'home',
    ),
    away = manifest.facts.find(
      (f) => f.proof.kind === 'count' && f.proof.metric === 'goals' && f.proof.subjectId === 'away',
    ),
    pending = manifest.facts.find((f) => f.proof.kind === 'event');
  return { p, manifest, composite, home, away, pending };
}

test('selected exact zero-score composite dominates its atomic operands with a stable audited index map', () => {
  const { manifest, composite, home, away, pending } = zeroSelectionFixture();
  assert.deepEqual(composite.proof.componentFactIds, [home.id, away.id]);
  for (const [ids, expected, map] of [
    [[home.id, composite.id, away.id], [composite.id], [0, 0, 0]],
    [
      [pending.id, away.id, composite.id, home.id],
      [pending.id, composite.id],
      [0, 1, 1, 1],
    ],
    [
      [away.id, pending.id, home.id, composite.id],
      [pending.id, composite.id],
      [1, 0, 1, 1],
    ],
    [
      [composite.id, home.id, pending.id],
      [composite.id, pending.id],
      [0, 0, 1],
    ],
  ]) {
    const before = structuredClone(manifest),
      selection = selectQuestionFacts(manifest, ids);
    assert.deepEqual(selection.requestedFactIds, ids);
    assert.deepEqual(selection.selectedFactIds, expected);
    assert.deepEqual(selection.originalToSelectedIndex, map);
    assert.deepEqual(manifest, before);
    assert.deepEqual(
      selection.claims,
      expected.map((id) => manifest.facts.find((f) => f.id === id).claim),
    );
    assert.ok(
      selection.normalizations.every(
        (item) =>
          item.coveredByFactId === composite.id && item.reason === 'exact-composite-operand',
      ),
    );
    assert.equal(selection.normalizations.length, ids.length - expected.length);
    assert.ok(Object.isFrozen(selection.normalizations));
    assert.ok(Object.isFrozen(selection.originalToSelectedIndex));
  }
  const selection = selectQuestionFacts(manifest, [home.id, composite.id, away.id]);
  const remapped = [...new Set([0, 2].map((index) => selection.originalToSelectedIndex[index]))];
  assert.deepEqual(remapped, [0]);
  assert.deepEqual(selection.proofs[0].operands, composite.proof.operands);
  assert.deepEqual(selection.claims[0].evidence, composite.claim.evidence);
});

test('selection never introduces an unselected composite or drops a pending event', () => {
  const { manifest, home, away, pending } = zeroSelectionFixture(),
    ids = [home.id, pending.id, away.id];
  const selection = selectQuestionFacts(manifest, ids);
  assert.deepEqual(selection.selectedFactIds, ids);
  assert.deepEqual(selection.originalToSelectedIndex, [0, 1, 2]);
  assert.deepEqual(selection.normalizations, []);
  assert.deepEqual(selectQuestionFacts(manifest, []).originalToSelectedIndex, []);
});

test('a selected shooting profile dominates only its exact selected operands, never a different time interval', () => {
  const p = packet(),
    attempt = query('attempts', { type: 'shot' }, [{ key: 'reed', count: 2 }]),
    target = query('targets', { type: 'shot', outcome: 'on-target' }, [{ key: 'reed', count: 1 }]);
  p.queryResults = [attempt, target];
  const manifest = buildQuestionFacts(p),
    profile = manifest.facts.find((f) => f.proof.kind === 'shooting-profile'),
    atoms = manifest.facts.filter((f) => f.proof.kind === 'count');
  const chosen = selectQuestionFacts(manifest, [atoms[0].id, profile.id, atoms[1].id]);
  assert.deepEqual(chosen.selectedFactIds, [profile.id]);
  assert.deepEqual(chosen.originalToSelectedIndex, [0, 0, 0]);
  assert.equal(chosen.normalizations.length, 2);
  for (const mutate of [
    (q) => (q.query.timeFrom = 30),
    (q) => (q.query.timeFromExclusive = true),
    (q) => (q.scopeReference.id = 'different-proof'),
  ]) {
    const extra = structuredClone(attempt);
    extra.scopeReference.id = 'separate-scope';
    mutate(extra);
    p.requestedEvidence = [extra];
    const next = buildQuestionFacts(p),
      original = next.facts.find((f) => f.id === profile.id),
      other = next.facts.find(
        (f) =>
          f.proof.kind === 'count' &&
          f.proof.scope.id === extra.scopeReference.id &&
          JSON.stringify(f.proof) !== JSON.stringify(atoms[0].proof),
      );
    assert.ok(original);
    assert.ok(other);
    assert.deepEqual(selectQuestionFacts(next, [original.id, other.id]).selectedFactIds, [
      original.id,
      other.id,
    ]);
  }
});

test('body-part facts copy only the current recorded attribute and never infer force, technique or preferred foot', () => {
  for (const language of ['en', 'es', 'fr', 'pt'])
    for (const bodyPart of ['left-foot', 'right-foot', 'head']) {
      const p = packet();
      p.responseLanguage = language;
      p.queryResults = [
        query('attribute', { type: 'pass' }, [], {
          aggregate: 'list',
          count: 1,
          rows: [row({ bodyPart, technique: 'trivela' })],
        }),
      ];
      const attribute = buildQuestionFacts(p).facts.find((f) => f.proof.attributes);
      assert.ok(attribute);
      assert.deepEqual(attribute.proof.attributes, { bodyPart });
      assert.equal(attribute.proof.eventId, 'pass');
      assert.equal(attribute.claim.evidence[0].revision, 2);
      assert.doesNotMatch(attribute.claim.text, /power|speed|force|trivela|preferred/);
      delete p.queryResults[0].rows[0].bodyPart;
      assert.equal(
        buildQuestionFacts(p).facts.some((f) => f.proof.attributes?.bodyPart),
        false,
        'Technique alone never establishes a body part',
      );
    }
});

test('equal counts do not establish dominance across different scope identities, windows or metrics', () => {
  for (const mutate of [
    (q) => (q.scopeReference.id = 'other'),
    (q) => (q.scopeReference.revision = 2),
    (q) => (q.query.timeTo = 90),
    (q) => (q.query.timeFromExclusive = true),
    (q) => (q.query.filters = { type: 'recovery' }),
    (q) => (q.query.filters = { type: 'recovery', recoveryClass: 'ball-win' }),
  ]) {
    const { p } = zeroSelectionFixture(),
      extra = structuredClone(p.queryResults[0]);
    extra.scopeReference.id = 'other';
    mutate(extra);
    p.queryResults.push(extra);
    const manifest = buildQuestionFacts(p),
      composite = manifest.facts.find(
        (f) =>
          f.proof.kind === 'confirmed-score' &&
          f.proof.operands[0].scope.id === 'goals' &&
          f.proof.operands[0].scope.revision === 1,
      );
    const atom = manifest.facts.find(
      (f) =>
        f.proof.kind === 'count' &&
        f.proof.subjectId === 'home' &&
        !composite.proof.componentFactIds.includes(f.id),
    );
    assert.ok(atom);
    const selection = selectQuestionFacts(manifest, [composite.id, atom.id]);
    assert.deepEqual(selection.selectedFactIds, [composite.id, atom.id]);
    assert.deepEqual(selection.normalizations, []);
  }
});

test('malformed coverage edges cannot remove an atomic proof and raw selection validation runs first', () => {
  const { manifest, composite, home, away } = zeroSelectionFixture();
  for (const mutate of [
    (p) => (p.operands[0].value = 1),
    (p) => (p.operands[0].scope.revision = 2),
    (p) => (p.operands[0].query.filters = { type: 'shot', outcome: 'pending' }),
    (p) => (p.componentFactIds = [home.id, home.id]),
    (p) => (p.operands[0].timeFromExclusive = true),
    (p) => (p.home = 1),
    (p) => (p.kind = 'shooting-profile'),
  ]) {
    const altered = structuredClone(manifest);
    mutate(altered.facts.find((f) => f.id === composite.id).proof);
    const selection = selectQuestionFacts(altered, [composite.id, home.id]);
    assert.deepEqual(selection.selectedFactIds, [composite.id, home.id]);
  }
  for (const ids of [
    [home.id, composite.id, home.id],
    [composite.id, 'unknown'],
    Array(9).fill(home.id),
    new Array(1),
  ])
    assert.throws(() => selectQuestionFacts(manifest, ids), RangeError);
  const bounded = structuredClone(manifest);
  bounded.facts = bounded.facts.filter((f) => f.id !== away.id);
  assert.deepEqual(selectQuestionFacts(bounded, [composite.id]).selectedFactIds, [composite.id]);
  assert.throws(() => selectQuestionFacts(bounded, [composite.id, away.id]), RangeError);
});

test('natural multilingual facts keep explicit pending outcomes, profile operands and a single historical window', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    p.responseLanguage = language;
    p.queryResults = [
      query('attempts', { type: 'shot' }, [{ key: 'reed', count: 2 }], { to: 30 }),
      query('target', { type: 'shot', outcome: 'on-target' }, [{ key: 'reed', count: 1 }], {
        to: 30,
      }),
      query('pending', { type: 'shot' }, [], {
        aggregate: 'list',
        count: 1,
        rows: [row({ id: 'pending', type: 'shot', result: null, time: 116, arrivedAt: 116 })],
      }),
    ];
    const facts = buildQuestionFacts(p).facts,
      profile = facts.find(
        (f) => f.proof.kind === 'shooting-profile' && f.proof.subjectId === 'reed',
      ),
      pending = facts.find((f) => f.proof.kind === 'event');
    assert.ok(profile);
    assert.deepEqual(
      profile.proof.operands.map((x) => x.value),
      [2, 1],
    );
    assert.equal(profile.claim.text.match(/00:30/g).length, 1);
    assert.equal(profile.claim.evidence.length, 2);
    assert.match(pending.claim.text, /01:56/);
    assert.match(pending.claim.text, /pending|pendiente|en attente|pendente/);
    assert.equal(pending.proof.actionOutcome.status, 'pending');
    p.queryResults.push(
      query('goals', { type: 'shot', result: true }, [], { aggregate: 'by-team' }),
    );
    const zero = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'confirmed-score');
    assert.ok(zero);
    assert.match(zero.claim.text, /confirmed|confirmado|confirmé/);
    assert.equal(zero.proof.home, 0);
    assert.equal(zero.proof.away, 0);
  }
});

test('exclusive bounds remain explicit and cannot combine with inclusive profiles or admit boundary endpoints', () => {
  const p = packet(),
    attempt = query('shots', { type: 'shot' }, [{ key: 'reed', count: 1 }], { from: 30, to: 90 }),
    target = query('target', { type: 'shot', outcome: 'on-target' }, [{ key: 'reed', count: 1 }], {
      from: 30,
      to: 90,
    });
  attempt.query.timeFromExclusive = true;
  p.queryResults = [attempt, target];
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'shooting-profile'),
    false,
  );
  target.query.timeFromExclusive = true;
  target.query.timeToExclusive = true;
  attempt.query.timeToExclusive = true;
  for (const language of ['en', 'es', 'fr', 'pt']) {
    p.responseLanguage = language;
    const profile = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'shooting-profile');
    assert.ok(profile);
    assert.equal(profile.proof.timeFromExclusive, true);
    assert.equal(profile.proof.timeToExclusive, true);
    assert.match(profile.claim.text, /After|Después|Après|Depois/);
    assert.match(profile.claim.text, /before|antes|avant/);
  }
  const endpoint = query('endpoint', { type: 'pass' }, [], {
    aggregate: 'list',
    count: 1,
    rows: [row({ time: 62, arrivedAt: 66 })],
    from: 62,
  });
  endpoint.query.limit = 1;
  endpoint.query.timeFromExclusive = true;
  p.queryResults = [];
  p.requestedEvidence = [endpoint];
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
    false,
  );
  endpoint.query.timeFrom = 61;
  assert.ok(buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'));
  endpoint.query.timeTo = 62;
  endpoint.query.timeToExclusive = true;
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
    false,
  );
});

test('a complete empty list proves only its exact supported metric, identity and strict window absence', () => {
  const p = packet(),
    q = query('empty', { type: 'shot', team: 'away' }, [], {
      aggregate: 'list',
      count: 0,
      rows: [],
      from: 92,
    });
  q.query.timeFromExclusive = true;
  q.query.limit = 1;
  p.requestedEvidence = [q];
  const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'count');
  assert.equal(fact.proof.kind, 'count');
  assert.equal(fact.proof.value, 0);
  assert.equal(fact.proof.subjectId, 'away');
  assert.equal(fact.proof.timeFromExclusive, true);
  assert.match(fact.claim.text, /After 01:32 through 02:00: Harbour Athletic has 0 shots/);
  assert.equal(fact.claim.evidence[0].id, 'empty');
  for (const mutate of [
    (s) => (s.truncated = true),
    (s) => (s.scope.missingFields.type = 1),
    (s) => (s.count = 1),
    (s) => (s.rows = [row()]),
    (s) => (s.query.filters.player = 'unknown'),
    (s) => (s.query.filters.bodyPart = 'left-foot'),
  ]) {
    const bad = structuredClone(q);
    mutate(bad);
    p.requestedEvidence = [bad];
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'count'),
      false,
    );
  }
});

test('numeric assertion descriptors preserve repeated occurrences, positions and application values', () => {
  const answer = {
    claims: [
      { kind: 'observation', text: 'No goals, and zero goals.' },
      { kind: 'general', text: 'A brace is two goals.' },
      { kind: 'observation', text: 'At 01:56, but the outcome is pending.' },
    ],
  };
  const result = numericAssertions(answer);
  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0].assertions.map((x) => [x.assertionIndex, x.text, x.value]),
    [
      [0, 'No goals', 0],
      [1, 'zero goals', 0],
    ],
  );
  assert.ok(result[0].assertions[1].index > result[0].assertions[0].index);
  assert.equal(answer.claims[0].text, 'No goals, and zero goals.');
});

test('count and compact shooting profiles preserve both complete operands and scoped identity', () => {
  const p = packet();
  p.queryResults = [
    query('shots', { type: 'shot' }, [
      { key: 'reed', count: 2 },
      { key: 'silva', count: 3 },
    ]),
    query('target', { type: 'shot', outcome: 'on-target' }, [
      { key: 'reed', count: 2 },
      { key: 'silva', count: 1 },
    ]),
  ];
  const manifest = buildQuestionFacts(p),
    profiles = manifest.facts.filter((f) => f.proof.kind === 'shooting-profile');
  assert.equal(profiles.length, 2);
  assert.match(profiles[0].claim.text, /has taken 2 shots, 2 on target/);
  assert.match(profiles[1].claim.text, /has taken 3 shots, 1 on target/);
  assert.equal(profiles[0].claim.evidence.length, 2);
  assert.deepEqual(
    profiles[1].proof.operands.map((o) => o.value),
    [3, 1],
  );
  const selected = selectQuestionFacts(manifest, [profiles[1].id]);
  assert.equal(selected.modelGenerated, false);
  assert.deepEqual(selected.claims, [profiles[1].claim]);
  assert.ok(Object.isFrozen(selected.claims[0].evidence));
  assert.throws(() => selectQuestionFacts(manifest, ['invented']));
  assert.throws(() => selectQuestionFacts(manifest, [profiles[0].id, profiles[0].id]));
  assert.throws(() => selectQuestionFacts(manifest, [{ id: profiles[0].id, value: 99 }]));
});

test('zero facts are bounded to eligible named players and teams, never unknown identities', () => {
  const p = packet();
  for (let n = 0; n < 20; n++) p.roster.push({ id: 'extra' + n, name: 'Extra ' + n, team: 'home' });
  p.queryResults = [
    query('shots', { type: 'shot' }, []),
    query('goals', { type: 'shot', result: true }, [], { aggregate: 'by-team' }),
  ];
  const facts = buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'count');
  assert.equal(facts.length, 4);
  assert.ok(facts.every((f) => ['reed', 'home', 'away', null].includes(f.proof.subjectId)));
  assert.deepEqual(
    facts.filter((f) => f.proof.subjectId === null).map((f) => [f.proof.metric, f.proof.value]),
    [['goals', 0]],
  );
  p.mentionedPlayerResolution = [{ status: 'absent', canonicalId: 'messi' }];
  assert.equal(
    buildQuestionFacts(p).facts.filter(
      (f) => f.proof.kind === 'count' && f.proof.metric === 'attempts',
    ).length,
    0,
  );
});

test('unknown classifications, truncation, subset filters, invalid group arithmetic and windows omit facts', () => {
  for (const mutate of [
    (q) => (q.truncated = true),
    (q) => (q.scope.missingFields.result = 1),
    (q) => delete q.scope.missingFields,
    (q) => (q.query.filters.bodyPart = 'unknown-body-part'),
    (q) => (q.query.groupCount = { min: 1 }),
    (q) => (q.count = 9),
    (q) => (q.groups[0].key = 'unknown'),
    (q) => (q.query.timeTo = 121),
    (q) => (q.query.timeFrom = -1),
    (q) => (q.entityResolution = { player: { status: 'ambiguous' } }),
    (q) => (q.query.filters.player = 'silva'),
  ]) {
    const p = packet(),
      q = query('shots', { type: 'shot' }, [{ key: 'reed', count: 2 }]);
    mutate(q);
    p.queryResults = [q];
    assert.equal(buildQuestionFacts(p).facts.length, 0);
  }
  const p = packet();
  p.queryResults = [
    query('recent', { type: 'shot' }, [{ key: 'reed', count: 1 }], { from: 90, to: 120 }),
  ];
  assert.match(buildQuestionFacts(p).facts[0].claim.text, /01:30.*02:00/);
});

test('credited assists require explicit complete credit coverage rather than goals or pass links', () => {
  const p = packet();
  p.queryResults = [
    query('assists', { type: 'shot', result: true }, [{ key: 'reed', count: 1 }], {
      aggregate: 'by-assister',
    }),
  ];
  assert.equal(buildQuestionFacts(p).facts[0].proof.metric, 'creditedAssists');
  p.queryResults[0].scope.missingFields.assistPlayer = 1;
  assert.equal(buildQuestionFacts(p).facts.length, 0);
});

test('a particular goal assist needs explicit same-team credit on that confirmed current goal', () => {
  const p = packet();
  p.roster.push({ id: 'cole', name: 'J. Cole', team: 'home' });
  const goal = row({
    id: 'goal',
    type: 'shot',
    team: 'home',
    playerId: 'reed',
    result: true,
    outcome: 'goal',
    assist: { playerId: 'cole', passId: 'earlier' },
  });
  p.queryResults = [
    query('goal', { type: 'shot' }, [], { aggregate: 'list', count: 1, rows: [goal] }),
  ];
  let facts = buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'credited-goal-assist');
  assert.equal(facts.length, 1);
  assert.match(facts[0].claim.text, /J\. Cole.*A\. Reed/);
  assert.equal(facts[0].claim.evidence[0].id, 'goal');
  for (const mutate of [
    (r) => (r.result = false),
    (r) => (r.result = null),
    (r) => delete r.assist,
    (r) => (r.assist.playerId = 'silva'),
    (r) => (r.assist.playerId = 'unknown'),
    (r) => (r.assist.playerId = 'reed'),
  ]) {
    p.queryResults[0].rows = [structuredClone(goal)];
    mutate(p.queryResults[0].rows[0]);
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'credited-goal-assist'),
      false,
    );
  }
});

test('threshold facts enumerate only fully returned qualifying groups and never use the prefilter total', () => {
  const p = packet(),
    q = query('threshold', { type: 'shot' }, [{ key: 'silva', count: 3 }], { count: 5 });
  q.query.groupCount = { min: 3 };
  q.matchedGroupCount = 1;
  p.requestedEvidence = [q];
  let facts = buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'qualifying-groups');
  assert.equal(facts.length, 1);
  assert.match(facts[0].claim.text, /at least 3 shots: B\. Silva \(3\)/);
  assert.doesNotMatch(facts[0].claim.text, /5/);
  for (const mutate of [
    (s) => (s.truncated = true),
    (s) => (s.matchedGroupCount = 2),
    (s) => (s.groups[0].count = 2),
    (s) => (s.scope.missingFields.type = 1),
    (s) => (s.groups[0].key = 'unknown'),
    (s) => (s.count = 1),
  ]) {
    const bad = structuredClone(q);
    mutate(bad);
    p.requestedEvidence = [bad];
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'qualifying-groups'),
      false,
    );
  }
  const empty = structuredClone(q);
  empty.groups = [];
  empty.matchedGroupCount = 0;
  p.requestedEvidence = [empty];
  facts = buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'qualifying-groups');
  assert.equal(facts.length, 1);
  assert.match(facts[0].claim.text, /none/);
  assert.doesNotMatch(facts[0].claim.text, /0 shots/);
});

test('event outcomes preserve false, pending and absent distinctions without inventing reception', () => {
  const p = packet();
  p.queryResults = [
    query('event', { type: 'pass' }, [], { aggregate: 'list', count: 1, rows: [row()] }),
  ];
  let facts = buildQuestionFacts(p).facts;
  assert.equal(facts.length, 1);
  assert.match(facts[0].claim.text, /unsuccessful/);
  assert.doesNotMatch(facts[0].claim.text, /Reed|receiv|pending/);
  assert.equal(facts[0].proof.actionOutcome.status, 'failed');
  p.queryResults[0].rows[0].result = null;
  facts = buildQuestionFacts(p).facts;
  assert.match(facts[0].claim.text, /pending/);
  p.queryResults[0].rows[0].actionOutcome = { status: 'unknown', basis: 'result-absent' };
  assert.equal(
    buildQuestionFacts(p).facts.length,
    0,
    'Raw source absence overrides normalized null',
  );
  delete p.queryResults[0].rows[0].actionOutcome;
  delete p.queryResults[0].rows[0].result;
  assert.equal(buildQuestionFacts(p).facts.length, 0);
});

test('canonical recipients bind the received same-team identity and preserve completion, failure and pending roles', () => {
  for (const language of ['en', 'es', 'fr', 'pt'])
    for (const result of [true, false, null]) {
      const p = packet();
      p.responseLanguage = language;
      p.roster.push({ id: 'mate-73', name: 'N. Okafor', team: 'away' });
      const event = row({
        id: 'unseen-pass',
        receiverId: 'mate-73',
        receiverName: 'N. Okafor',
        result,
      });
      p.queryResults = [
        query('recipient', { type: 'pass' }, [], { aggregate: 'list', count: 1, rows: [event] }),
      ];
      const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'event');
      assert.ok(fact);
      assert.match(fact.claim.text, /N\. Okafor/);
      assert.equal(fact.proof.recipient.playerId, 'mate-73');
      assert.equal(
        fact.proof.recipient.status,
        result === true ? 'confirmed-recipient' : 'recorded-target',
      );
      assert.equal(
        fact.proof.actionOutcome.status,
        result === true ? 'completed' : result === false ? 'failed' : 'pending',
      );
      assert.deepEqual(fact.claim.evidence, [reference('unseen-pass', 'event', 2)]);
      assert.doesNotMatch(fact.claim.text, /assist|received|receives/);
      if (result !== true)
        assert.match(
          fact.claim.text,
          /recorded target|destinatario registrado|destinataire enregistré|destinatário registrado/,
        );
    }
});

test('missing, conflicting, self and opposing-team receiver identities cannot become confirmed recipients or guessed targets', () => {
  for (const fields of [
    { receiverId: undefined },
    { receiverId: 'unseen' },
    { receiverId: 'reed' },
    { receiverId: 'silva' },
    { receiverId: 'mate', receiverName: 'Wrong Name' },
    { receiverId: 'mate', targetPlayer: 'reed' },
  ]) {
    const p = packet();
    p.roster.push({ id: 'mate', name: 'N. Okafor', team: 'away' });
    p.queryResults = [
      query('recipient', { type: 'pass' }, [], {
        aggregate: 'list',
        count: 1,
        rows: [row({ ...fields, result: true })],
      }),
    ];
    const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'event');
    assert.equal(fact.proof.recipient.status, 'unknown');
    assert.equal(fact.proof.recipient.playerId, undefined);
    assert.match(fact.claim.text, /recipient is unknown/);
    assert.doesNotMatch(fact.claim.text, /Okafor|Reed|Wrong Name/);
  }
  const p = packet();
  p.roster.push({ id: 'mate', name: 'N. Okafor', team: 'away' });
  const a = row({ receiverId: 'mate' }),
    b = { ...a, receiverId: 'silva' };
  p.queryResults = [
    query('conflicting', { type: 'pass' }, [], { aggregate: 'list', count: 1, rows: [a, b] }),
  ];
  assert.equal(
    buildQuestionFacts(p).facts.length,
    0,
    'Conflicting same-revision events never establish recipient facts',
  );
});

test('latest pass recipient follows the ordered current attempt rather than an older completed pass', () => {
  for (const result of [false, null]) {
    const p = packet();
    p.roster.push(
      { id: 'older-target', name: 'V. Shah', team: 'away' },
      { id: 'new-target', name: 'N. Okafor', team: 'away' },
    );
    const older = row({
        id: 'old',
        time: 20,
        arrivedAt: 24,
        result: true,
        receiverId: 'older-target',
      }),
      latest = row({ id: 'new', time: 70, arrivedAt: 74, result, receiverId: 'new-target' });
    p.queryResults = [
      query('history', { type: 'pass' }, [], {
        aggregate: 'list',
        count: 2,
        rows: [older, latest],
      }),
    ];
    const selected = query('last', { type: 'pass' }, [], {
      aggregate: 'list',
      count: 2,
      rows: [latest],
      truncated: true,
    });
    selected.query.limit = 1;
    selected.query.order = 'desc';
    p.requestedEvidence = [selected];
    const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event');
    assert.match(fact.claim.text, /Latest.*Okafor/);
    assert.doesNotMatch(fact.claim.text, /Shah|completed a pass to/);
    assert.equal(fact.proof.event.recipient.status, 'recorded-target');
    assert.equal(fact.proof.event.eventId, 'new');
    assert.deepEqual(fact.claim.evidence, [reference('new', 'event', 2), reference('last')]);
    const corrected = {
      ...latest,
      revision: 3,
      arrivedAt: 80,
      result: true,
      receiverId: 'older-target',
    };
    p.queryResults[0].rows.push(corrected);
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
      false,
      'A stale endpoint cannot reuse the recipient of a corrected revision',
    );
  }
});

test('current event revisions exclude future, deleted, conflicting and unknown-actor records', () => {
  const p = packet(),
    old = row({ revision: 1, result: true }),
    current = row(),
    future = row({ revision: 3, arrivedAt: 130, result: true });
  p.queryResults = [
    query('events', { type: 'pass' }, [], {
      aggregate: 'list',
      count: 1,
      rows: [old, current, future],
    }),
  ];
  let facts = buildQuestionFacts(p).facts;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].claim.evidence[0].revision, 2);
  assert.equal(facts[0].proof.actionOutcome.status, 'failed');
  p.queryResults[0].rows.push(row({ operation: 'delete', revision: 3 }));
  assert.equal(buildQuestionFacts(p).facts.length, 0);
  p.queryResults[0].rows = [row(), row({ result: true })];
  assert.equal(buildQuestionFacts(p).facts.length, 0);
  p.queryResults[0].rows = [row({ playerId: 'unknown' })];
  assert.equal(buildQuestionFacts(p).facts.length, 0);
});

test('ordered endpoints cite their requested exact scope and never globalize restricted queries', () => {
  const p = packet(),
    q = query('latest', { type: 'pass', team: 'away' }, [], {
      aggregate: 'list',
      count: 6,
      rows: [row()],
      truncated: true,
    });
  q.query.order = 'desc';
  q.query.limit = 1;
  p.requestedEvidence = [q];
  const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event');
  assert.ok(fact);
  assert.match(fact.claim.text, /Harbour Athletic/);
  assert.equal(fact.claim.evidence.length, 2);
  assert.equal(fact.proof.subjectId, 'away');
  q.query.timeFrom = 30;
  assert.match(
    buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event').claim.text,
    /00:30–02:00/,
  );
  delete q.query.order;
  assert.equal(
    buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event').proof.order,
    'asc',
    'Compacted app packet omits the canonical ascending default',
  );
  q.query.filters.team = 'home';
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
    false,
  );
  q.query.filters = { type: 'shot', outcome: 'on-target' };
  q.rows = [row({ type: 'shot', outcome: 'blocked' })];
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
    false,
  );
});

test('a body-part endpoint retains its selector and rejects mismatched or unknown recorded attributes', () => {
  const p = packet(),
    q = query('left', { type: 'pass', bodyPart: 'left-foot' }, [], {
      aggregate: 'list',
      count: 2,
      rows: [row({ bodyPart: 'left-foot' })],
      truncated: true,
    });
  q.query.order = 'desc';
  q.query.limit = 1;
  p.requestedEvidence = [q];
  const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event');
  assert.ok(fact);
  assert.match(fact.claim.text, /left foot/);
  assert.equal(fact.proof.query.filters.bodyPart, 'left-foot');
  q.rows[0].bodyPart = 'right-foot';
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
    false,
  );
  delete q.rows[0].bodyPart;
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'ordered-event'),
    false,
  );
});

test('complete lists do not invent endpoint selectors or outrank requested statistics and profiles', () => {
  for (const order of [undefined, 'asc', 'desc'])
    for (const limit of [undefined, 20]) {
      const p = packet(),
        list = query('list', { type: 'shot' }, [], {
          aggregate: 'list',
          count: 1,
          rows: [row({ id: 'shot', type: 'shot', result: false, outcome: 'saved' })],
        });
      if (order !== undefined) list.query.order = order;
      if (limit !== undefined) list.query.limit = limit;
      const attempts = query('shots', { type: 'shot' }, [{ key: 'silva', count: 1 }]),
        target = query('target', { type: 'shot', outcome: 'on-target' }, [
          { key: 'silva', count: 1 },
        ]);
      p.requestedEvidence = [list, attempts];
      p.queryResults = [target];
      const manifest = buildQuestionFacts(p);
      assert.equal(
        manifest.facts.some((f) => f.proof.kind === 'ordered-event'),
        false,
        `order=${order}, limit=${limit}`,
      );
      const profile = manifest.facts.findIndex((f) => f.proof.kind === 'shooting-profile'),
        aggregate = manifest.facts.findIndex(
          (f) => f.proof.kind === 'count' && f.proof.scope.id === 'shots',
        ),
        event = manifest.facts.findIndex((f) => f.proof.kind === 'event');
      assert.ok(profile >= 0 && profile < event);
      assert.ok(aggregate >= 0 && aggregate < event);
      list.query.limit = 1;
      assert.equal(
        buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'ordered-event').length,
        1,
        'An explicit selector still proves the endpoint even when only one event exists',
      );
    }
});

test('canonical fact rendering is deterministic, immutable and available in four languages', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    p.responseLanguage = language;
    p.queryResults = [
      query(
        'goals',
        { type: 'shot', result: true },
        [
          { key: 'home', count: 0 },
          { key: 'away', count: 0 },
        ],
        { aggregate: 'by-team' },
      ),
      query('pass', { type: 'pass' }, [], { aggregate: 'list', count: 1, rows: [row()] }),
    ];
    const original = structuredClone(p),
      first = buildQuestionFacts(p),
      second = buildQuestionFacts(p);
    assert.deepEqual(first, second);
    assert.deepEqual(p, original);
    assert.ok(Object.isFrozen(first.facts[0].proof));
    assert.equal(first.facts.length, 6);
    assert.equal(
      first.facts.find((f) => f.proof.kind === 'count' && f.proof.subjectId === null).proof.value,
      0,
    );
    assert.match(first.facts[0].claim.text, language === 'en' ? /confirmed/ : /confirm/);
  }
});

test('on-target attempts faced invert team identity without inventing save credit or keeper identity', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    p.responseLanguage = language;
    p.queryResults = [
      query(
        'on-target',
        { type: 'shot', outcome: 'on-target' },
        [
          { key: 'home', count: 2 },
          { key: 'away', count: 1 },
        ],
        { aggregate: 'by-team' },
      ),
    ];
    const facts = buildQuestionFacts(p).facts.filter(
      (f) => f.proof.kind === 'opponent-count' && f.proof.metric === 'shotsOnTargetFaced',
    );
    assert.equal(facts.length, 2);
    const away = facts.find((f) => f.proof.subjectId === 'away');
    assert.equal(away.proof.value, 2);
    assert.equal(away.proof.attackingTeam, 'home');
    assert.equal(away.proof.operand.subjectId, 'home');
    assert.equal(away.claim.evidence[0].id, 'on-target');
    assert.match(away.claim.text, /Harbour Athletic/);
    assert.ok(away.proof.doesNotProve.includes('save-credit'));
  }
  for (const mutate of [
    (q) => (q.truncated = true),
    (q) => (q.scope.missingFields.outcome = 1),
    (q) => (q.query.filters.player = 'reed'),
    (q) => (q.query.filters.outcome = 'saved'),
    (q) => (q.query.aggregate = 'by-player'),
  ]) {
    const p = packet();
    p.queryResults = [
      query(
        'scope',
        { type: 'shot', outcome: 'on-target' },
        [
          { key: 'home', count: 2 },
          { key: 'away', count: 1 },
        ],
        { aggregate: 'by-team' },
      ),
    ];
    mutate(p.queryResults[0]);
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.metric === 'shotsOnTargetFaced'),
      false,
    );
  }
});

test('team comparisons require matching complete metrics and windows, and compute ties and opposition correctly', () => {
  const p = packet();
  p.queryResults = [
    query(
      'sot',
      { type: 'shot', outcome: 'on-target' },
      [
        { key: 'home', count: 2 },
        { key: 'away', count: 1 },
      ],
      { aggregate: 'by-team' },
    ),
  ];
  let facts = buildQuestionFacts(p).facts;
  const attack = facts.find(
      (f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'shotsOnTarget',
    ),
    faced = facts.find(
      (f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'shotsOnTargetFaced',
    );
  assert.equal(attack.proof.leader, 'home');
  assert.equal(faced.proof.leader, 'away');
  assert.deepEqual(faced.proof.values, { home: 1, away: 2 });
  assert.equal(attack.proof.margin, 1);
  assert.equal(faced.proof.assessmentBounds, 'this-measure-only');
  assert.match(faced.claim.text, /Northbridge has tested Harbour Athletic more/);
  assert.equal(faced.proof.attackingLeader, 'home');
  p.queryResults[0].groups[1].count = 2;
  p.queryResults[0].count = 4;
  facts = buildQuestionFacts(p).facts;
  assert.equal(
    facts.find((f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'shotsOnTarget')
      .proof.leader,
    null,
  );
  p.queryResults = [
    query(
      'home',
      { type: 'shot', outcome: 'on-target', team: 'home' },
      [{ key: 'home', count: 2 }],
      { aggregate: 'by-team', from: 0 },
    ),
    query(
      'away',
      { type: 'shot', outcome: 'on-target', team: 'away' },
      [{ key: 'away', count: 1 }],
      { aggregate: 'by-team', from: 90 },
    ),
  ];
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'team-comparison'),
    false,
  );
});

test('a requested ordered endpoint survives a large background catalog without changing its proof', () => {
  const p = packet();
  p.queryResults = Array.from({ length: 70 }, (_v, index) =>
    query(
      'background-' + index,
      { type: 'pass' },
      [
        { key: 'reed', count: 1 },
        { key: 'silva', count: 1 },
      ],
      { from: index },
    ),
  );
  const requested = query('last-pass', { type: 'pass' }, [], {
    aggregate: 'list',
    count: 1,
    rows: [row()],
  });
  requested.query.order = 'desc';
  requested.query.limit = 1;
  p.requestedEvidence = [requested];
  const manifest = buildQuestionFacts(p);
  assert.equal(manifest.truncated, true);
  assert.equal(manifest.facts.length, 128);
  assert.equal(manifest.facts[0].proof.kind, 'ordered-event');
  assert.equal(manifest.facts[0].proof.scope.id, 'last-pass');
  assert.equal(manifest.facts[0].proof.event.eventId, 'pass');
});

test('ordered goal wording uses singular, grammatically matched labels in every supported language', () => {
  for (const [language, first, last] of [
    ['en', 'First confirmed goal', 'Latest confirmed goal'],
    ['es', 'Primer gol confirmado', 'Último gol confirmado'],
    ['fr', 'Premier but confirmé', 'Dernier but confirmé'],
    ['pt', 'Primeiro gol confirmado', 'Último gol confirmado'],
  ]) {
    for (const [order, prefix] of [
      ['asc', first],
      ['desc', last],
    ]) {
      const p = { ...packet(), responseLanguage: language },
        goal = row({
          id: 'goal',
          type: 'shot',
          team: 'home',
          playerId: 'reed',
          player: 'A. Reed',
          time: 100,
          result: true,
          outcome: 'goal',
        });
      const q = query('goal-endpoint', { type: 'shot', result: true, outcome: 'goal' }, [], {
        aggregate: 'list',
        count: 1,
        rows: [goal],
      });
      Object.assign(q.query, { order, limit: 1 });
      p.requestedEvidence = [q];
      const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'ordered-event');
      assert.ok(fact);
      assert.ok(fact.claim.text.startsWith(prefix + ':'), fact.claim.text);
      assert.equal(fact.proof.event.eventId, 'goal');
      assert.equal(fact.claim.evidence.length, 2);
    }
  }
});
test('complete shot inventories distinguish blocks, wide attempts, saves and unresolved outcomes', () => {
  const p = packet(),
    outcomes = ['goal', 'saved', 'blocked', 'off-target', 'pending', 'unknown'];
  const rows = outcomes.map((outcome, i) =>
    row({
      id: 'shot-' + i,
      type: 'shot',
      team: 'home',
      playerId: 'reed',
      player: 'A. Reed',
      time: 10 + i,
      arrivedAt: 10 + i,
      result: outcome === 'goal' ? true : ['pending', 'unknown'].includes(outcome) ? null : false,
      outcome: outcome === 'unknown' ? null : outcome,
      ...(outcome === 'unknown' ? { actionOutcome: { status: 'unknown' } } : {}),
    }),
  );
  p.requestedEvidence = [
    query('shots', { type: 'shot' }, [], { aggregate: 'list', count: rows.length, rows }),
  ];
  const manifest = buildQuestionFacts(p),
    fact = manifest.facts.find(
      (f) => f.proof.kind === 'shot-outcome-profile' && f.proof.subjectId === 'home',
    );
  assert.ok(fact);
  assert.equal(fact.proof.attempts, 6);
  assert.deepEqual(fact.proof.counts, {
    goal: 1,
    saved: 1,
    blocked: 1,
    'off-target': 1,
    'on-target': 0,
    pending: 1,
    unknown: 1,
  });
  assert.match(fact.claim.text, /1 saved.*1 blocked.*1 off target.*1 pending.*1 outcome unknown/);
  assert.equal(selectQuestionFacts(manifest, [fact.id]).claims[0].text, fact.claim.text);
  for (const change of [
    (s) => (s.truncated = true),
    (s) => s.rows.pop(),
    (s) => (s.scope.missingFields.outcome = 1),
    (s) => (s.query.filters.outcome = 'saved'),
    (s) => (s.rows[0].operation = 'delete'),
    (s) => (s.rows[0].time = 130),
    (s) => (s.rows[0].arrivedAt = 130),
    (s) => (s.rows[1].id = s.rows[0].id),
  ]) {
    const bad = structuredClone(p);
    change(bad.requestedEvidence[0]);
    assert.equal(
      buildQuestionFacts(bad).facts.some((f) => f.proof.kind === 'shot-outcome-profile'),
      false,
    );
  }
});
test('statistic definitions use the retrieved schema contract even before any shot, without inventing totals or participants', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    Object.assign(p, {
      responseLanguage: language,
      requestedForm: 'explanation',
      explanationTarget: 'statistic-definition',
      requestComponents: ['Are these saved shots', 'or a different category'],
    });
    p.requestedEvidence = [
      query('definition', { type: 'shot' }, [], { aggregate: 'list', count: 0 }),
    ];
    p.queryResults = p.requestedEvidence;
    const manifest = buildQuestionFacts(p),
      definition = manifest.facts.find((fact) => fact.proof.kind === 'shot-outcome-definition');
    assert.ok(definition, language);
    assert.equal(definition.proof.basis, 'trusted-event-schema');
    assert.equal(definition.proof.modelGenerated, false);
    assert.deepEqual(definition.claim.evidence, [reference('definition')]);
    assert.doesNotMatch(definition.claim.text, /A\. Reed|B\. Silva|\d/);
    const terms = {
      en: [
        /confirmed goals/,
        /settled shots classified as saved or on-target/,
        /Blocked and off-target/,
        /pending or unknown/,
      ],
      es: [
        /goles confirmados/,
        /parados o a puerta/,
        /bloqueados.*fuera/,
        /pendientes o desconocidos/,
      ],
      fr: [/buts confirmés/, /arrêtés ou cadrés/, /contrés et non cadrés/, /en attente ou inconnu/],
      pt: [
        /gols confirmados/,
        /defendidos ou à baliza/,
        /bloqueados.*fora/,
        /pendentes ou desconhecidos/,
      ],
    };
    for (const term of terms[language]) assert.match(definition.claim.text, term);
    assert.doesNotMatch(
      definition.claim.text,
      /defender|defensor|défenseur|frame|trajectory|trajectoire|trajetória/i,
    );
    const selected = selectQuestionFacts(manifest, [definition.id]);
    assert.equal(selected.claims[0].text, definition.claim.text);
    assert.equal(selected.proofs[0].kind, 'shot-outcome-definition');
    const direct = directQuestionFacts(p, manifest, {
      focus: 'player-performance',
      form: 'explanation',
      explanationTarget: 'statistic-definition',
    });
    assert.deepEqual(
      direct.composition,
      { mode: 'facts', factIds: [definition.id] },
      'Two question components can share one complete definition',
    );
    assert.equal(
      directQuestionFacts(p, manifest, {
        focus: 'player-performance',
        form: 'assessment',
        explanationTarget: 'statistic-definition',
      }),
      null,
      'Definition is not a workload assessment',
    );
    const stale = structuredClone(manifest);
    stale.facts.find((fact) => fact.id === definition.id).proof.scope = reference('not-requested');
    assert.equal(
      directQuestionFacts(p, stale, {
        form: 'explanation',
        explanationTarget: 'statistic-definition',
      }),
      null,
    );
  }
});

test('statistic definitions require valid requested shot evidence regardless of planner intent', () => {
  const source = query('definition', { type: 'shot' }, [], { aggregate: 'list', count: 0 });
  for (const mutate of [
    (p) => (p.requestedEvidence = []),
    (p) => (p.requestedEvidence[0].query.filters.type = 'pass'),
    (p) => (p.requestedEvidence[0].scope.missingFields.outcome = 1),
    (p) => (p.requestedEvidence[0].query.timeTo = 121),
  ]) {
    const p = packet();
    Object.assign(p, {
      requestedForm: 'explanation',
      explanationTarget: 'statistic-definition',
      requestedEvidence: [structuredClone(source)],
    });
    mutate(p);
    assert.equal(
      buildQuestionFacts(p).facts.some((fact) => fact.proof.kind === 'shot-outcome-definition'),
      false,
    );
  }
  for (const intent of [undefined, 'none', 'decision-rationale']) {
    const p = {
      ...packet(),
      requestedForm: 'fact',
      explanationTarget: intent,
      requestedEvidence: [structuredClone(source)],
    };
    const manifest = buildQuestionFacts(p),
      definition = manifest.facts.find((f) => f.proof.kind === 'shot-outcome-definition');
    assert.ok(definition);
    assert.equal(
      directQuestionFacts(p, manifest, { focus: 'other', form: 'fact', explanationTarget: intent }),
      null,
      'Availability does not license direct definition selection for unrelated intent',
    );
  }
  const p = packet();
  Object.assign(p, {
    explanationTarget: 'statistic-definition',
    requestedEvidence: [{ ...structuredClone(source), truncated: true, count: 2 }],
  });
  const definition = buildQuestionFacts(p).facts.find(
    (fact) => fact.proof.kind === 'shot-outcome-definition',
  );
  assert.ok(definition, 'Limited shot results still establish the outcome contract');
  assert.doesNotMatch(
    definition.claim.text,
    /\d/,
    'A definition never asserts a total from a partial list',
  );
});

test('qualified counts preserve complete current cross scope, actors and exclusive bounds in all languages', () => {
  const input = { kind: 'duel', seed: 2071, time: 15 },
    state = matchState(input);
  const q = {
    filters: { type: 'pass', team: 'home', result: true, passType: 'cross' },
    aggregate: 'by-player',
    timeFrom: 0,
    timeTo: 15,
    timeToExclusive: true,
  };
  const source = executeMatchQuery(input, q);
  assert.equal(source.count, 1);
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      responseLanguage: language,
      observedAt: 15,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
    };
    const facts = buildQuestionFacts(p).facts,
      counts = facts.filter((f) => f.proof.kind === 'count');
    assert.equal(counts.length, 1);
    const f = counts[0];
    assert.equal(f.proof.subjectId, 'home-11');
    assert.equal(f.proof.metric, 'completedPasses');
    assert.equal(f.proof.value, 1);
    assert.deepEqual(f.proof.qualifiers, { passType: 'cross' });
    assert.deepEqual(f.proof.query, source.query);
    assert.equal(f.proof.timeToExclusive, true);
    assert.deepEqual(f.claim.evidence, [source.scopeReference]);
    assert.match(f.claim.text, /N\. Aziz/);
    assert.match(
      f.claim.text,
      language === 'fr'
        ? /centre/
        : language === 'es'
          ? /centro/
          : language === 'pt'
            ? /cruzamento/
            : /cross/,
    );
    assert.equal(
      facts.some((f) => ['pass-completion-profile', 'team-comparison'].includes(f.proof.kind)),
      false,
    );
  }
  const before = executeMatchQuery({ ...input, time: 10 }, { ...q, timeTo: 10 });
  assert.equal(before.count, 0, 'Unconfirmed revision is not a completed cross');
  const boundary = executeMatchQuery(input, { ...q, timeTo: 8 });
  assert.equal(boundary.count, 0, 'Exclusive boundary excludes cross at8');
});

test('qualified count coverage refuses unknown filters, partial partitions and unresolved scopes', () => {
  const base = query('cross', { type: 'pass', team: 'home', result: true, passType: 'cross' }, [
    { key: 'reed', count: 1 },
  ]);
  for (const change of [
    (s) => (s.truncated = true),
    (s) => (s.scope.missingFields.passType = 1),
    (s) => (s.groups[0].count = 0),
    (s) => s.groups.push({ ...s.groups[0] }),
    (s) => (s.groups[0].key = 'silva'),
    (s) => (s.entityResolution.player = { status: 'ambiguous' }),
    (s) => (s.query.filters.passType = 'invented'),
    (s) => (s.query.filters.technique = null),
    (s) => (s.query.filters.receiver = 'unknown'),
    (s) => (s.query.timeTo = 121),
  ]) {
    const source = structuredClone(base);
    change(source);
    const p = packet();
    p.requestedEvidence = [source];
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'count'),
      false,
    );
  }
  const zero = structuredClone(base);
  zero.count = 0;
  zero.groups = [];
  zero.query.aggregate = 'count';
  const p = packet();
  p.requestedEvidence = [zero];
  const f = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'count');
  assert.equal(f.proof.value, 0);
  assert.deepEqual(f.proof.qualifiers, { passType: 'cross' });
});

test('qualified facts do not become unqualified totals, completion profiles or team comparisons', () => {
  const p = packet();
  p.requestedEvidence = [
    query(
      'crosses',
      { type: 'pass', result: true, passType: 'cross' },
      [
        { key: 'home', count: 2 },
        { key: 'away', count: 1 },
      ],
      { aggregate: 'by-team' },
    ),
    query(
      'failures',
      { type: 'pass', result: false },
      [
        { key: 'home', count: 1 },
        { key: 'away', count: 0 },
      ],
      { aggregate: 'by-team' },
    ),
  ];
  const facts = buildQuestionFacts(p).facts,
    completed = facts.filter(
      (f) => f.proof.kind === 'count' && f.proof.metric === 'completedPasses',
    );
  assert.equal(completed.length, 3);
  assert.ok(
    completed.every(
      (f) => f.proof.qualifiers.passType === 'cross' && f.proof.query.filters.passType === 'cross',
    ),
  );
  assert.equal(
    facts.some(
      (f) =>
        f.proof.kind === 'pass-completion-profile' ||
        (f.proof.kind === 'team-comparison' && f.proof.metric === 'completedPasses'),
    ),
    false,
  );
  const qualified = query(
    'attributes',
    { type: 'pass', result: true, bodyPart: 'right-foot', technique: 'trivela' },
    [{ key: 'reed', count: 1 }],
  );
  p.requestedEvidence = [qualified];
  const f = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'count');
  assert.deepEqual(f.proof.qualifiers, { bodyPart: 'right-foot', technique: 'trivela' });
  assert.match(f.claim.text, /right foot.*trivela/);
});

test('event club clause preserves actor prefix and binds explicit matching team metadata', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    p.responseLanguage = language;
    p.linkedContext = { rows: [row()] };
    const f = buildQuestionFacts(p).facts.find(
      (f) => f.proof.kind === 'event' && !f.proof.attributes,
    );
    const withoutClub = structuredClone(p);
    withoutClub.linkedContext.rows[0].teamName = 'Conflicting club';
    const original = buildQuestionFacts(withoutClub).facts.find(
      (f) => f.proof.kind === 'event' && !f.proof.attributes,
    );
    assert.ok(f.claim.text.startsWith(original.claim.text));
    assert.match(f.claim.text, /B\. Silva/);
    assert.match(f.claim.text, /01:02/);
    assert.match(f.claim.text, /Harbour Athletic/);
    assert.equal(f.proof.teamId, 'away');
    assert.equal(f.proof.teamName, 'Harbour Athletic');
    assert.deepEqual(f.proof.teamProvenance, {
      source: 'packet.teams',
      teamId: 'away',
      actorTeam: 'away',
    });
    assert.deepEqual(f.claim.evidence, [reference('pass', 'event', 2)]);
  }
  for (const change of [
    (p) => (p.linkedContext.rows[0].team = 'home'),
    (p) => delete p.linkedContext.rows[0].team,
    (p) => (p.linkedContext.rows[0].teamName = 'Wrong club'),
    (p) => (p.teams.away = ''),
  ]) {
    const p = packet();
    p.linkedContext = { rows: [row()] };
    change(p);
    const facts = buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'event');
    assert.ok(facts.every((f) => !f.proof.teamName && !/Club:|Clube:|Club :/.test(f.claim.text)));
  }
});

test('saved-shot collection counts retain exact recovery qualifiers and legacy role metric', () => {
  const input = { kind: 'counter', seed: 2063, time: 90 },
    state = matchState(input);
  const q = {
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
  const source = executeMatchQuery(input, q);
  assert.equal(source.count, 2);
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      responseLanguage: language,
      observedAt: 90,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
    };
    const f = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'count');
    assert.ok(f);
    assert.equal(f.proof.metric, 'savedAttemptCollections');
    assert.equal(f.proof.baseMetric, 'recoveries');
    assert.equal(f.proof.subjectId, 'home-1');
    assert.equal(f.proof.value, 2);
    assert.deepEqual(f.proof.qualifiers, {
      recoveryKind: 'goalkeeper-hold',
      linkedShotOutcome: 'saved',
    });
    assert.deepEqual(f.proof.query, source.query);
    assert.deepEqual(f.claim.evidence, [source.scopeReference]);
    assert.match(f.claim.text, /I\. Kerr/);
    assert.match(f.claim.text, /2/);
    assert.equal(
      buildQuestionFacts(p).facts.some(
        (f) => f.proof.kind === 'team-comparison' || f.proof.kind === 'shooting-profile',
      ),
      false,
    );
  }
  const mutable = structuredClone(state),
    shot = mutable.events.find((e) => e.id.endsWith('shot-26'));
  mutable.events.push({
    ...shot,
    revision: shot.revision + 1,
    arrivedAt: 89,
    outcome: 'blocked',
    result: false,
  });
  const revised = executeMatchQuery(input, q, { stateFactory: () => mutable });
  assert.equal(revised.count, 1);
  assert.notDeepEqual(revised.scopeReference, source.scopeReference);
  const p = {
    ...packet(),
    observedAt: 90,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [revised],
  };
  assert.equal(buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'count').proof.value, 1);
  const missing = structuredClone(state);
  missing.events = missing.events.filter((e) => e.id !== shot.id);
  const unresolved = executeMatchQuery(input, q, { stateFactory: () => missing });
  assert.equal(unresolved.scope.missingFields.linkedShotOutcome, 1);
  p.requestedEvidence = [unresolved];
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'count'),
    false,
  );
  const recent = executeMatchQuery(input, { ...q, timeFrom: 28, timeFromExclusive: true });
  p.requestedEvidence = [recent];
  const rf = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'count');
  assert.equal(rf.proof.value, 1);
  assert.equal(rf.proof.timeFromExclusive, true);
});

test('generic recovery predicates render supported qualifiers in four languages without broadening counts', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = packet();
    p.mentionedPlayerResolution = [];
    p.responseLanguage = language;
    p.requestedEvidence = [
      query('interceptions', { type: 'recovery', recoveryKind: 'interception' }, [
        { key: 'reed', count: 2 },
      ]),
      query('linked', { type: 'recovery', linkedShotOutcome: 'blocked' }, [
        { key: 'silva', count: 1 },
      ]),
    ];
    const facts = buildQuestionFacts(p).facts.filter((f) => f.proof.kind === 'count');
    assert.equal(facts.length, 2);
    assert.ok(facts.every((f) => f.proof.metric === 'recoveries'));
    assert.deepEqual(facts[0].proof.qualifiers, { recoveryKind: 'interception' });
    assert.deepEqual(facts[1].proof.qualifiers, { linkedShotOutcome: 'blocked' });
    assert.ok(facts.every((f) => !f.claim.text.includes('undefined')));
    assert.match(facts[0].claim.text, /intercep|interce/);
    assert.match(
      facts[1].claim.text,
      language === 'fr' ? /contré/ : language === 'en' ? /blocked/ : /bloque/,
    );
  }
  for (const filters of [
    { type: 'recovery', recoveryKind: 'invented' },
    { type: 'recovery', linkedShotOutcome: 'unsaved' },
    { type: 'recovery', recoveryKind: null },
    { type: 'pass', recoveryKind: 'goalkeeper-hold' },
    { type: 'shot', linkedShotOutcome: 'saved' },
    { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved', result: true },
  ]) {
    const p = packet();
    p.requestedEvidence = [query('bad', filters, [{ key: 'reed', count: 1 }])];
    assert.equal(
      buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'count'),
      false,
      JSON.stringify(filters),
    );
  }
  const p = packet();
  p.requestedEvidence = [
    query(
      'holds',
      { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
      [
        { key: 'home', count: 2 },
        { key: 'away', count: 1 },
      ],
      { aggregate: 'by-team' },
    ),
  ];
  const facts = buildQuestionFacts(p).facts;
  assert.equal(facts.filter((f) => f.proof.kind === 'count').length, 3);
  assert.equal(
    facts.some((f) => f.proof.kind === 'team-comparison'),
    false,
  );
  assert.ok(
    facts
      .filter((f) => f.proof.kind === 'count')
      .every(
        (f) =>
          f.proof.qualifiers &&
          f.proof.query.filters.type === 'recovery' &&
          f.proof.metric !== 'savedShots',
      ),
  );
});

test('complete player ranking preserves every tied leader with source scope in four languages', () => {
  const input = { kind: 'quiet', seed: 2063, time: 42 },
    state = matchState(input),
    query = {
      filters: { type: 'pass', team: 'home', result: true },
      aggregate: 'by-player',
      groupOrder: 'count-desc',
      limit: 20,
      timeFrom: 0,
      timeTo: 42,
    };
  const source = executeMatchQuery(input, query);
  assert.equal(source.count, 3);
  assert.equal(source.groups.length, 3);
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      observedAt: 42,
      responseLanguage: language,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
    };
    const ranking = buildQuestionFacts(p).facts.find(
      (f) => f.proof.kind === 'player-count-ranking',
    );
    assert.ok(ranking);
    assert.equal(ranking.proof.value, 1);
    assert.equal(ranking.proof.metric, 'completedPasses');
    assert.deepEqual(
      ranking.proof.leaders.map((p) => p.name),
      ['E. Costa', 'J. Cole', 'R. Mensah'],
    );
    assert.equal(ranking.proof.totalCount, 3);
    assert.equal(ranking.proof.matchedGroupCount, 3);
    assert.equal(ranking.proof.teamId, 'home');
    assert.deepEqual(ranking.proof.query, source.query);
    assert.deepEqual(ranking.claim.evidence, [source.scopeReference]);
    assert.ok(ranking.proof.leaders.every((p) => ranking.claim.text.includes(p.name)));
    assert.match(
      ranking.claim.text,
      { en: /joint leaders/, es: /comparten/, fr: /égalité/, pt: /dividem/ }[language],
    );
  }
});

test('player rankings use current revisions and preserve narrower team windows and exact qualifiers', () => {
  for (const seed of [83, 2071]) {
    const input = { kind: 'quiet', seed, time: 42 },
      state = structuredClone(matchState(input)),
      roster = state.frames.at(-1).players,
      passes = state.events.filter((e) => e.type === 'pass' && e.result === true),
      actor = roster.find((p) => p.id === 'home-6');
    const changed = passes.find((e) => e.playerId === 'home-7');
    state.events.push({
      ...changed,
      revision: changed.revision + 1,
      arrivedAt: 42,
      playerId: actor.id,
      player: actor.name,
    });
    const q = {
      filters: { type: 'pass', team: 'home', result: true },
      aggregate: 'by-player',
      groupOrder: 'count-desc',
      limit: 20,
      timeFrom: 0,
      timeTo: 42,
    };
    const source = executeMatchQuery(input, q, { stateFactory: () => state }),
      p = {
        ...packet(),
        observedAt: 42,
        teams: state.metadata.teams,
        roster,
        requestedEvidence: [source],
      };
    const ranking = buildQuestionFacts(p).facts.find(
      (f) => f.proof.kind === 'player-count-ranking',
    );
    assert.equal(ranking.proof.value, 2);
    assert.deepEqual(
      ranking.proof.leaders.map((x) => x.id),
      [actor.id],
    );
    assert.match(ranking.claim.text, /leads with 2/);
    assert.equal(
      ranking.proof.groups.reduce((n, g) => n + g.count, 0),
      3,
    );
  }
  const input = { kind: 'duel', seed: 2071, time: 15 },
    state = matchState(input),
    q = {
      filters: { type: 'pass', team: 'home', result: true, passType: 'cross' },
      aggregate: 'by-player',
      groupOrder: 'name',
      timeFrom: 0,
      timeTo: 15,
      timeToExclusive: true,
    };
  const source = executeMatchQuery(input, q),
    ranking = buildQuestionFacts({
      ...packet(),
      observedAt: 15,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
    }).facts.find((f) => f.proof.kind === 'player-count-ranking');
  assert.equal(ranking.proof.value, 1);
  assert.equal(ranking.proof.leaders[0].id, 'home-11');
  assert.equal(ranking.proof.timeToExclusive, true);
  assert.deepEqual(ranking.proof.qualifiers, { passType: 'cross' });
  assert.match(ranking.claim.text, /Northbridge.*cross/);
  assert.match(ranking.claim.text, /to before 00:15/);
});

test('ranking completeness rejects partial, threshold, actor-restricted, unknown and zero scopes', () => {
  const input = { kind: 'quiet', seed: 2063, time: 42 },
    state = matchState(input),
    q = {
      filters: { type: 'pass', result: true },
      aggregate: 'by-player',
      groupOrder: 'count-desc',
      limit: 20,
      timeFrom: 0,
      timeTo: 42,
    },
    source = executeMatchQuery(input, q);
  const rank = (s) =>
    buildQuestionFacts({
      ...packet(),
      observedAt: 42,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [s],
    }).facts.filter((f) => f.proof.kind === 'player-count-ranking');
  for (const change of [
    (s) => (s.truncated = true),
    (s) => s.groups.pop(),
    (s) => s.matchedGroupCount++,
    (s) => delete s.matchedGroupCount,
    (s) => (s.query.groupCount = { min: 1 }),
    (s) => (s.query.filters.player = 'home-6'),
    (s) => (s.query.filters.receiver = 'home-6'),
    (s) => (s.groups[0].key = 'missing'),
    (s) => s.groups.push({ ...s.groups[0] }),
    (s) => (s.scope.missingFields.result = 1),
    (s) => (s.entityResolution.player = { status: 'ambiguous' }),
    (s) => (s.query.timeTo = 43),
  ]) {
    const bad = structuredClone(source);
    change(bad);
    assert.equal(rank(bad).length, 0);
  }
  assert.equal(
    rank(executeMatchQuery(input, { ...q, limit: 1 })).length,
    0,
    'Limited top row cannot establish all tied maxima',
  );
  assert.equal(
    rank(executeMatchQuery(input, { ...q, timeTo: 0 })).length,
    0,
    'No positive observations cannot name a leader',
  );
  const absent = structuredClone(state);
  delete absent.events.find((e) => e.type === 'pass' && e.result === true).result;
  const incomplete = executeMatchQuery(input, q, { stateFactory: () => absent });
  assert.equal(incomplete.scope.missingFields.result, 1);
  assert.equal(rank(incomplete).length, 0);
  const allZero = structuredClone(source);
  allZero.count = 0;
  allZero.groups.forEach((g) => (g.count = 0));
  assert.equal(rank(allZero).length, 0);
  const noGroups = structuredClone(allZero);
  delete noGroups.groups;
  assert.equal(rank(noGroups).length, 0);
  const crowded = structuredClone(state);
  crowded.events = crowded.frames.at(-1).players.map((p, i) => ({
    id: 'rank-pass-' + i,
    revision: 1,
    operation: 'upsert',
    type: 'pass',
    time: 10,
    arrivedAt: 10,
    result: true,
    playerId: p.id,
    player: p.name,
    team: p.team,
  }));
  const capped = executeMatchQuery(input, q, { stateFactory: () => crowded });
  assert.equal(capped.matchedGroupCount, 22);
  assert.equal(capped.groups.length, 20);
  assert.equal(capped.truncated, true);
  assert.equal(rank(capped).length, 0, 'Engine limit20 cannot certify all22tied leaders');
});

test('requested unavailable measurements are canonical only with exact component and explicit source contract', () => {
  const spans = {
    possession: 'What is possession percentage?',
    pressing: 'What is the pressing measurement?',
    xG: 'What is the xG?',
  };
  const phrases = {
    en: ['possession percentage', 'pressing measurement', 'expected goals'],
    es: ['porcentaje de posesión', 'medida de la presión', 'goles esperados'],
    fr: ['pourcentage de possession', 'mesure du pressing', 'buts attendus'],
    pt: ['percentagem de posse', 'medida da pressão', 'golos esperados'],
  };
  for (const language of ['en', 'es', 'fr', 'pt'])
    for (const [index, dimension] of ['possession', 'pressing', 'xG'].entries()) {
      const requestSpan = spans[dimension],
        p = {
          ...packet(),
          question: requestSpan,
          requestComponents: [requestSpan],
          responseLanguage: language,
          requiredResponseForms: [
            { requestSpan, answerForm: 'unavailable-measurement', dimension },
          ],
          evidenceCapabilities: { unavailableMeasurements: [dimension] },
        };
      const manifest = buildQuestionFacts(p),
        fact = manifest.facts.find((f) => f.proof.kind === 'source-measurement-limitation');
      assert.ok(fact);
      assert.ok(fact.claim.text.includes(phrases[language][index]));
      assert.equal(fact.claim.kind, 'limitation');
      assert.deepEqual(fact.claim.evidence, []);
      assert.deepEqual(fact.proof, {
        kind: 'source-measurement-limitation',
        dimension,
        requestSpan,
        basis: 'trusted-event-schema',
        modelGenerated: false,
      });
      assert.equal(Object.hasOwn(fact.proof, 'value'), false);
      assert.equal(selectQuestionFacts(manifest, [fact.id]).claims[0].text, fact.claim.text);
      for (const mutate of [
        (x) => (x.requiredResponseForms = []),
        (x) => (x.requiredResponseForms[0].answerForm = 'fact'),
        (x) => (x.requiredResponseForms[0].dimension = 'fitness'),
        (x) => (x.requiredResponseForms[0].requestSpan = 'unrelated'),
        (x) => (x.requestComponents = []),
        (x) => (x.question = 'Another question'),
        (x) => (x.evidenceCapabilities = {}),
        (x) => (x.evidenceCapabilities.unavailableMeasurements = []),
        (x) => (x.evidenceCapabilities.unavailableMeasurements = dimension),
        (x) => (x.evidenceCapabilities.unavailableMeasurements = { includes: dimension }),
        (x) => (x.requestComponents = requestSpan),
        (x) => (x.evidenceCapabilities.unavailableMeasurements = ['some unknown metric']),
      ]) {
        const invalid = structuredClone(p);
        mutate(invalid);
        assert.equal(
          buildQuestionFacts(invalid).facts.some(
            (f) => f.proof.kind === 'source-measurement-limitation',
          ),
          false,
        );
      }
      const duplicate = structuredClone(p);
      duplicate.requiredResponseForms.push(structuredClone(p.requiredResponseForms[0]));
      assert.equal(
        buildQuestionFacts(duplicate).facts.filter(
          (f) => f.proof.kind === 'source-measurement-limitation',
        ).length,
        1,
      );
    }
});

test('measurement limitation neither replaces complete counts nor claims missing rows prove absence', () => {
  const requestSpan = 'What is the xG?',
    p = {
      ...packet(),
      question: requestSpan,
      requestComponents: [requestSpan],
      requiredResponseForms: [
        { requestSpan, answerForm: 'unavailable-measurement', dimension: 'xG' },
      ],
      evidenceCapabilities: { unavailableMeasurements: ['xG'] },
    };
  p.requestedEvidence = [query('attempts', { type: 'shot' }, [{ key: 'reed', count: 2 }])];
  const facts = buildQuestionFacts(p).facts;
  assert.ok(facts.some((f) => f.proof.kind === 'count' && f.proof.value === 2));
  assert.ok(facts.some((f) => f.proof.kind === 'source-measurement-limitation'));
  p.requestedEvidence = [];
  p.evidenceCapabilities = {};
  assert.equal(
    buildQuestionFacts(p).facts.some((f) => f.proof.kind === 'source-measurement-limitation'),
    false,
  );
});

function rankingDedupFixture() {
  const input = { kind: 'counter', seed: 2301, time: 108 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
      aggregate: 'by-player',
    });
  const manifest = buildQuestionFacts({
    observedAt: 108,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [source],
    queryResults: [source],
    namedPlayerActions: [{ player: { id: 'home-1' } }, { player: { id: 'away-1' } }],
  });
  const rank = manifest.facts.find((f) => f.proof.kind === 'player-count-ranking'),
    leader = manifest.facts.find(
      (f) => f.proof.kind === 'count' && f.proof.subjectId === rank.proof.leaders[0].id,
    ),
    other = manifest.facts.find((f) => f.proof.kind === 'count' && f.proof.subjectId === 'away-1');
  assert.ok(rank && leader && other);
  return { manifest, rank, leader, other };
}

test('a rendered ranking leader replaces only its identical selected count with stable dependency mapping', () => {
  const { manifest, rank, leader, other } = rankingDedupFixture(),
    result = selectQuestionFacts(manifest, [leader.id, other.id, rank.id]);
  assert.deepEqual(result.selectedFactIds, [other.id, rank.id]);
  assert.deepEqual(result.originalToSelectedIndex, [1, 0, 1]);
  assert.equal(result.claims[0].text, other.claim.text);
  assert.equal(other.proof.value, 0);
  assert.equal(result.normalizations[0].coveredByFactId, rank.id);
});

test('ranking dedup declines different sources, qualifiers, revisions, bounds and unrendered groups', () => {
  const { manifest, rank, leader, other } = rankingDedupFixture();
  for (const mutate of [
    (f) => f.proof.scope.revision++,
    (f) => (f.proof.query.timeFromExclusive = true),
    (f) => (f.proof.qualifiers = { recoveryKind: 'other' }),
    (f) => (f.proof.query.filters.bodyPart = 'left-foot'),
    (f) => f.proof.coverage.matchedCount++,
    (f) => f.proof.value++,
    (f) => (f.proof.modelGenerated = true),
  ]) {
    const altered = structuredClone(manifest);
    mutate(altered.facts.find((f) => f.id === leader.id));
    assert.deepEqual(selectQuestionFacts(altered, [rank.id, leader.id]).selectedFactIds, [
      rank.id,
      leader.id,
    ]);
  }
  assert.deepEqual(selectQuestionFacts(manifest, [rank.id, other.id]).selectedFactIds, [
    rank.id,
    other.id,
  ]);
});

test('ranking dedup preserves every tied leader while covering each exact selected atomic count', () => {
  const input = { kind: 'duel', seed: 2071, time: 42 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'pass', result: true },
      aggregate: 'by-player',
    });
  const manifest = buildQuestionFacts({
    observedAt: 42,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [source],
    queryResults: [source],
  });
  const rank = manifest.facts.find((f) => f.proof.kind === 'player-count-ranking');
  assert.ok(rank.proof.leaders.length > 1);
  const atoms = rank.proof.leaders.map((player) =>
    manifest.facts.find((f) => f.proof.kind === 'count' && f.proof.subjectId === player.id),
  );
  const result = selectQuestionFacts(manifest, [rank.id, ...atoms.map((f) => f.id)]);
  assert.deepEqual(result.selectedFactIds, [rank.id]);
  assert.deepEqual(result.originalToSelectedIndex, Array(atoms.length + 1).fill(0));
  assert.equal(result.proofs[0].leaders.length, rank.proof.leaders.length);
});

test('transitive count coverage remaps ball wins and saved collections to the retained ranking in every order', () => {
  const { manifest, rank, leader } = rankingDedupFixture();
  const input = { kind: 'counter', seed: 2301, time: 108 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'recovery', recoveryClass: 'ball-win' },
      aggregate: 'by-player',
    });
  const wins = buildQuestionFacts({
    observedAt: 108,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    queryResults: [source],
    requestedEvidence: [source],
  }).facts.find(
    (f) =>
      f.proof.kind === 'count' &&
      f.proof.metric === 'ballWins' &&
      f.proof.subjectId === leader.proof.subjectId,
  );
  assert.equal(wins.proof.value, leader.proof.value);
  const combined = { ...manifest, facts: [...manifest.facts, wins] };
  for (const ids of [
    [rank.id, leader.id, wins.id],
    [wins.id, leader.id, rank.id],
    [leader.id, rank.id, wins.id],
  ]) {
    const result = selectQuestionFacts(combined, ids);
    assert.deepEqual(result.selectedFactIds, [rank.id]);
    assert.deepEqual(result.originalToSelectedIndex, [0, 0, 0]);
    assert.ok(result.normalizations.every((n) => n.coveredByFactId === rank.id));
  }
});

test('saved-shot collection rankings use plain units while preserving both source predicates', () => {
  const input = { kind: 'counter', seed: 2063, time: 90 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'recovery', recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
      aggregate: 'by-player',
      timeFrom: 0,
      timeTo: 90,
    });
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const p = {
      ...packet(),
      responseLanguage: language,
      observedAt: 90,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      mentionedPlayerResolution: [],
      requestedEvidence: [source],
    };
    const fact = buildQuestionFacts(p).facts.find((f) => f.proof.kind === 'player-count-ranking');
    assert.ok(fact);
    assert.equal(fact.proof.metric, 'savedAttemptCollections');
    assert.deepEqual(fact.proof.qualifiers, {
      recoveryKind: 'goalkeeper-hold',
      linkedShotOutcome: 'saved',
    });
    assert.deepEqual(fact.proof.query, source.query);
    assert.deepEqual(fact.claim.evidence, [source.scopeReference]);
    assert.ok(
      !/[():]/.test(fact.claim.text.slice(fact.claim.text.indexOf(':') + 1)),
      'No repeated category labels after the ranking prefix',
    );
    assert.match(
      fact.claim.text,
      language === 'en'
        ? /saved shots collected/
        : language === 'es'
          ? /tiros parados recogidos/
          : language === 'fr'
            ? /tirs arrêtés récupérés/
            : /remates defendidos recolhidos/,
    );
  }
});

test('readiness limitation follows the absent attribute contract and does not assert the proposed cause', () => {
  const requestSpan = "Did the pass fail because he wasn't ready",
    p = {
      ...packet(),
      question: requestSpan,
      requestComponents: [requestSpan],
      evidenceCapabilities: { unavailableMeasurements: ['readiness'] },
      requiredResponseForms: [
        { requestSpan, answerForm: 'unavailable-measurement', dimension: 'readiness' },
      ],
    };
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const fact = buildQuestionFacts({ ...p, responseLanguage: language }).facts.find(
      (f) => f.proof.dimension === 'readiness',
    );
    assert.ok(fact);
    assert.equal(fact.claim.kind, 'limitation');
    assert.deepEqual(fact.claim.evidence, []);
    assert.equal(fact.proof.basis, 'trusted-event-schema');
    assert.equal(fact.proof.requestSpan, requestSpan);
    assert.equal(fact.proof.modelGenerated, false);
  }
  for (const change of [
    (p) => (p.evidenceCapabilities.unavailableMeasurements = []),
    (p) => (p.requiredResponseForms[0].requestSpan = 'unasked reason'),
  ]) {
    const bad = structuredClone(p);
    change(bad);
    assert.ok(!buildQuestionFacts(bad).facts.some((f) => f.proof.dimension === 'readiness'));
  }
});

test('ordered saved-shot and linked keeper facts normalize to one complete source statement', () => {
  const input = { kind: 'sustained', seed: 17, time: 120 };
  const state = matchState(input);
  const source = executeMatchQuery(input, {
    filters: { type: 'shot', outcome: 'saved' },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
    timeFrom: 0,
    timeTo: 120,
  });
  const p = {
    ...packet(),
    observedAt: 120,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [source],
    queryResults: [source],
    linkedContext: {
      rows: [
        ...state.events.filter((row) => !source.rows.some((current) => current.id === row.id)),
        ...source.rows,
      ],
    },
  };
  const manifest = buildQuestionFacts(p);
  const ordered = manifest.facts.find(
    (f) => f.proof.kind === 'ordered-event' && f.proof.metric === 'savedShots',
  );
  const hold = manifest.facts.find(
    (f) => f.proof.kind === 'linked-goalkeeper-hold' && f.proof.orderedShot,
  );
  assert.ok(ordered);
  assert.ok(hold);
  const selected = selectQuestionFacts(manifest, [ordered.id, hold.id]);
  assert.equal(selected.claims.length, 1);
  assert.match(selected.claims[0].text, /Latest shot saved: M\. Carter collected A\. Reed/);
  assert.deepEqual(selected.originalToSelectedIndex, [0, 0]);
  assert.deepEqual(selected.proofs[0].orderedShot, ordered.proof);
  const evidence = selected.claims[0].evidence;
  assert.equal(evidence.filter((ref) => ref.type === 'event').length, 2);
  assert.equal(
    new Set(evidence.map((ref) => `${ref.type}:${ref.id}@${ref.revision}`)).size,
    evidence.length,
  );
  for (const change of [
    (proof) => proof.orderedShot.event.revision++,
    (proof) => (proof.orderedShot.order = 'asc'),
    (proof) => (proof.shotId = 'unrelated'),
  ]) {
    const bad = structuredClone(manifest);
    change(bad.facts.find((f) => f.id === hold.id).proof);
    assert.equal(selectQuestionFacts(bad, [ordered.id, hold.id]).claims.length, 2);
  }
});

test('legacy named roster data supports canonical goal identity without a raw-prose fallback', () => {
  const input = { kind: 'central', seed: 17, time: 12 };
  const state = matchState(input);
  const source = executeMatchQuery(input, {
    filters: { type: 'shot', result: true },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
    timeFrom: 0,
    timeTo: 12,
  });
  const manifest = buildQuestionFacts({
    ...packet(),
    observedAt: 12,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [source],
    queryResults: [source],
    linkedContext: {
      rows: [
        ...state.events.filter((row) => !source.rows.some((current) => current.id === row.id)),
        ...source.rows,
      ],
    },
  });
  const goal = manifest.facts.find(
    (f) => f.proof.kind === 'ordered-event' && f.proof.metric === 'goals',
  );
  assert.ok(goal);
  assert.match(goal.claim.text, /A\. Reed scores/);
  assert.equal(goal.proof.event.playerId, 'home-10');
  assert.equal(goal.proof.event.modelGenerated, false);
});

test('observed sequence explanation renders the complete linked buildup while supplier facts keep assist distinctions', () => {
  const input = { kind: 'sustained', seed: 17, time: 80 },
    state = matchState(input);
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const base = {
      observedAt: 80,
      roster: state.frames.at(-1).players,
      teams: state.metadata.teams,
      responseLanguage: language,
      linkedContext: { rows: structuredClone(state.events) },
    };
    const find = (packet) =>
      buildQuestionFacts(packet).facts.find(
        (f) => f.proof.kind === 'linked-shot-supply' && f.proof.time === 74,
      );
    const story = find({
      ...base,
      requestedForm: 'explanation',
      explanationTarget: 'observed-sequence',
    });
    assert.equal(story.proof.sequenceBasis, 'explicit-recovery-pass-reception-shot');
    assert.deepEqual(
      story.claim.evidence.map((ref) => [ref.id.split('-').slice(-2).join('-'), ref.revision]),
      [
        ['recovery-66', 1],
        ['pass-68', 2],
        ['receive-72', 1],
        ['shot-74', 1],
      ],
    );
    for (const clock of ['01:06', '01:08', '01:12', '01:14'])
      assert.match(story.claim.text, new RegExp(clock));
    assert.doesNotMatch(story.claim.text, /00:10|00:14|assist|décisive|assistência/i);
    const supplier = find({ ...base, requestedForm: 'fact', explanationTarget: 'none' });
    assert.equal(supplier.claim.evidence.length, 2);
    assert.equal(supplier.proof.sequenceBasis, undefined);
    assert.doesNotMatch(supplier.claim.text, /01:06|01:12/);
  }
  for (const change of [
    (rows) =>
      rows.push({
        ...rows.find((r) => r.type === 'recovery' && r.time === 66),
        revision: 2,
        operation: 'delete',
        arrivedAt: 80,
      }),
    (rows) =>
      rows.push({
        ...rows.find((r) => r.type === 'receive' && r.time === 72),
        revision: 2,
        playerId: 'home-9',
        arrivedAt: 80,
      }),
    (rows) =>
      rows.push({
        ...rows.find((r) => r.type === 'receive' && r.time === 72),
        id: 'ambiguous-reception',
      }),
  ]) {
    const rows = structuredClone(state.events);
    change(rows);
    const manifest = buildQuestionFacts({
      observedAt: 80,
      roster: state.frames.at(-1).players,
      teams: state.metadata.teams,
      linkedContext: { rows },
      requestedForm: 'explanation',
      explanationTarget: 'observed-sequence',
    });
    const story = manifest.facts.find(
      (f) => f.proof.kind === 'linked-shot-supply' && f.proof.time === 74,
    );
    assert.ok(story);
    assert.equal(
      story.proof.sequenceBasis,
      undefined,
      'Invalid current full chains must never render the recovery/reception narrative',
    );
    assert.equal(story.claim.evidence.length, 2);
  }
});
