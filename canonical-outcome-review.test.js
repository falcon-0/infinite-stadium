import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalShotOutcome,
  descriptiveOutcomeRequest,
  rankedOutcomeInventory,
  rankedOutcomeCompositionFacts,
} from './canonical-outcome-review.js';
import { reviewRequestAdequacy } from './match-question-ai.js';

function fixture() {
  const scope = { type: 'scope', id: 'all-shots', revision: 1 };
  const rows = [12, 67].map((time, i) => ({
    id: `attempt-${i}`,
    revision: 1,
    type: 'shot',
    playerId: 'p',
    team: 'home',
    time,
    arrivedAt: time,
    result: false,
    outcome: i ? 'blocked' : 'off-target',
  }));
  const events = rows.map((row) => ({
    kind: 'observation',
    text: `Player shot ${row.outcome} at ${row.time}.`,
    evidence: [{ type: 'event', id: row.id, revision: 1 }],
  }));
  const rank = {
    kind: 'player-count-ranking',
    metric: 'attempts',
    direction: 'max',
    modelGenerated: false,
    value: 2,
    leaders: [{ id: 'p', count: 2 }],
    groups: [{ id: 'p', count: 2 }],
    totalCount: 2,
    matchedGroupCount: 1,
    timeFrom: 0,
    timeTo: 80,
    scope,
  };
  const claims = [
    { kind: 'observation', text: 'Player leads with two shots.', evidence: [scope] },
    ...events,
  ];
  const selection = {
    claims: structuredClone(claims),
    proofs: [
      rank,
      ...rows.map((row) => ({
        kind: 'event',
        eventType: 'shot',
        eventId: row.id,
        revision: 1,
        time: row.time,
        playerId: 'p',
        teamId: 'home',
        actionOutcome: { status: row.outcome },
        modelGenerated: false,
      })),
    ],
  };
  const packet = {
    observedAt: 80,
    linkedContext: { rows },
    queryResults: [
      {
        scopeReference: scope,
        query: { filters: { type: 'shot' }, aggregate: 'by-player', timeFrom: 0, timeTo: 80 },
        groups: [{ key: 'p', count: 2 }],
        count: 2,
        matchedGroupCount: 1,
        truncated: false,
        rows: [],
      },
    ],
  };
  return {
    answer: { scope: 'match', claims },
    selection,
    packet,
    part: { requestSpan: 'how did they turn out', claimIndices: [1, 2] },
    demand: {
      action: 'shot',
      state: 'any',
      grouping: 'by-player',
      subjectIds: ['p'],
      timeFrom: 0,
      timeTo: 80,
      qualifiers: null,
    },
  };
}
test('complete distinct current outcomes prove only the bare descriptive ranked inventory', () => {
  const f = fixture();
  assert.ok(canonicalShotOutcome(2, f.answer, f.selection, f.packet));
  assert.equal(
    rankedOutcomeInventory(f.part, f.answer, f.selection, f.packet, f.demand).events.length,
    2,
  );
  for (const span of [
    'how did they turn out?',
    'What were their outcomes?',
    'Cómo terminaron esos tiros?',
    'Como terminaram os remates?',
  ])
    assert.ok(descriptiveOutcomeRequest(span), span);
  for (const span of [
    'How many were blocked?',
    'How did they turn out before 01:00?',
    'How did both teams turn out?',
    'Who blocked them?',
    'How hard did the keeper work?',
  ])
    assert.equal(descriptiveOutcomeRequest(span), false, span);
});
test('model prose, invented identity/path/workload, altered references and noncurrent outcomes cannot use canonical exemption', () => {
  for (const mutate of [
    (f) => (f.answer.claims[2].text += ' Defender X blocked it.'),
    (f) => (f.answer.claims[2].text += ' It travelled through the keeper.'),
    (f) => (f.answer.claims[2].text += ' The goalkeeper worked hard.'),
    (f) => (f.answer.claims[2].kind = 'interpretation'),
    (f) => (f.answer.claims[2].evidence[0].revision = 2),
    (f) => (f.selection.proofs[2].modelGenerated = true),
    (f) => f.packet.linkedContext.rows.push({ ...f.packet.linkedContext.rows[1], revision: 2 }),
    (f) => (f.packet.linkedContext.rows[1].operation = 'delete'),
    (f) => (f.packet.linkedContext.rows[1].arrivedAt = 81),
    (f) => (f.packet.linkedContext.rows[1].outcome = 'saved'),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(canonicalShotOutcome(2, f.answer, f.selection, f.packet), null);
  }
});
test('complete inventory proof rejects missing, duplicate, wrong actor, source, window, qualifier and tied-leader omissions', () => {
  for (const mutate of [
    (f) => (f.part.claimIndices = [1]),
    (f) => (f.part.claimIndices = [1, 1]),
    (f) => {
      f.answer.claims[2] = structuredClone(f.answer.claims[1]);
      f.selection.claims[2] = structuredClone(f.selection.claims[1]);
      f.selection.proofs[2] = structuredClone(f.selection.proofs[1]);
    },
    (f) => (f.packet.linkedContext.rows[1].playerId = 'other'),
    (f) => (f.packet.linkedContext.rows[1].time = 81),
    (f) => (f.packet.queryResults[0].truncated = true),
    (f) => (f.packet.queryResults[0].count = 3),
    (f) => (f.packet.queryResults[0].groups[0].count = 1),
    (f) => (f.packet.queryResults[0].query.timeTo = 79),
    (f) => (f.packet.queryResults[0].query.filters.result = false),
    (f) => (f.packet.queryResults[0].query.filters.team = 'away'),
    (f) => f.selection.proofs[0].leaders.push({ id: 'other', count: 2 }),
    (f) => {
      const source = f.packet.queryResults[0],
        rank = f.selection.proofs[0];
      source.groups.push({ key: 'other', count: 2 });
      source.count = rank.totalCount = 4;
      source.matchedGroupCount = rank.matchedGroupCount = 2;
      rank.groups.push({ id: 'other', count: 2 });
      rank.leaders.push({ id: 'other', count: 2 });
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(rankedOutcomeInventory(f.part, f.answer, f.selection, f.packet), null);
  }
});
test('outcome inventory cannot satisfy genuine numeric, subset, team or different-window demands', () => {
  for (const change of [
    { state: 'pending' },
    { state: 'blocked' },
    { grouping: 'by-team', subjectIds: ['home'] },
    { grouping: 'combined', subjectIds: [] },
    { subjectIds: ['other'] },
    { timeTo: 67 },
    { timeToExclusive: true },
    { qualifiers: { bodyPart: 'head' } },
  ]) {
    const f = fixture();
    assert.equal(
      rankedOutcomeInventory(f.part, f.answer, f.selection, f.packet, { ...f.demand, ...change }),
      null,
    );
  }
  const f = fixture();
  f.part.requestSpan = 'How many shots were blocked?';
  assert.equal(rankedOutcomeInventory(f.part, f.answer, f.selection, f.packet, f.demand), null);
});

test('request adequacy requires complete outcomes even when reviewer omits quantity metadata', () => {
  const f = fixture();
  const review = {
    checks: f.answer.claims.map((_, claimIndex) => ({ claimIndex, shotOutcomeAssertions: [] })),
    requestCheck: {
      coverage: [
        {
          ...f.part,
          answerForm: 'fact',
          requestedAction: 'shot',
          claimIndices: [1],
          requestedQuantity: null,
        },
      ],
    },
  };
  const issues = reviewRequestAdequacy(
    review,
    f.answer,
    { ...f.packet, question: f.part.requestSpan },
    { canonicalFactSelection: f.selection },
  );
  assert.ok(issues.some((issue) => /every distinct current attempt/.test(issue.reason)));
  review.requestCheck.coverage[0].claimIndices = [1, 2];
  assert.ok(
    !reviewRequestAdequacy(
      review,
      f.answer,
      { ...f.packet, question: f.part.requestSpan },
      { canonicalFactSelection: f.selection },
    ).some((issue) => /every distinct current attempt/.test(issue.reason)),
  );
});

function compositionFixture() {
  const f = fixture();
  f.packet.requestComponents = ['Who has the most shots', 'how did they turn out'];
  f.manifest = {
    facts: f.selection.claims.map((claim, i) => ({
      id: 'f' + i,
      claim: structuredClone(claim),
      proof: structuredClone(f.selection.proofs[i]),
    })),
  };
  f.manifest.facts.push({
    id: 'supply',
    claim: { kind: 'observation', text: 'Supplier passed to shooter.', evidence: [] },
    proof: {
      kind: 'linked-shot-supply',
      eventId: 'attempt-1',
      playerId: 'p',
      modelGenerated: false,
    },
  });
  return f;
}
const required = (f) => rankedOutcomeCompositionFacts(f.manifest, f.packet, ['f0']);
test('composition requires ranking plus every distinct outcome and never an assist/supply substitute in four languages', () => {
  for (const span of [
    'how did they turn out',
    'comment se sont-ils terminés',
    '¿Cómo terminaron esos tiros?',
    'Como terminaram os remates?',
  ]) {
    const f = compositionFixture();
    f.packet.requestComponents[1] = span;
    assert.deepEqual(required(f), ['f0', 'f1', 'f2']);
  }
  const f = compositionFixture();
  f.packet.requestComponents[1] = 'how did they turn out and with which foot';
  assert.equal(required(f), null);
});
test('composition refuses incomplete, duplicate, stale, wrong-window, qualified or truncated inventories', () => {
  for (const mutate of [
    (f) => f.manifest.facts.splice(1, 1),
    (f) => f.manifest.facts.push({ ...f.manifest.facts[1], id: 'duplicate' }),
    (f) => f.packet.linkedContext.rows.push({ ...f.packet.linkedContext.rows[1], revision: 2 }),
    (f) => (f.packet.linkedContext.rows[1].operation = 'delete'),
    (f) => (f.packet.linkedContext.rows[1].arrivedAt = 81),
    (f) => (f.packet.queryResults[0].truncated = true),
    (f) => {
      f.packet.queryResults[0].count = 3;
      f.packet.queryResults[0].groups[0].count = 3;
      const p = f.manifest.facts[0].proof;
      p.value = p.totalCount = p.leaders[0].count = p.groups[0].count = 3;
    },
    (f) => (f.packet.queryResults[0].query.filters.bodyPart = 'head'),
    (f) => {
      const p = f.manifest.facts[0].proof;
      p.timeFrom = f.packet.queryResults[0].query.timeFrom = 12;
      p.timeFromExclusive = f.packet.queryResults[0].query.timeFromExclusive = true;
    },
    (f) => (f.manifest.facts[2].proof.actionOutcome.status = 'pending'),
  ]) {
    const f = compositionFixture();
    mutate(f);
    assert.equal(required(f), null);
  }
  const f = compositionFixture();
  f.packet.linkedContext.rows[1].result = null;
  delete f.packet.linkedContext.rows[1].outcome;
  f.manifest.facts[2].proof.actionOutcome.status = 'pending';
  assert.deepEqual(
    required(f),
    ['f0', 'f1', 'f2'],
    'An actual pending attempt remains its explicitly recorded pending outcome',
  );
});
test('composition includes all tied leaders and refuses an inventory exceeding unchanged four-fact limit', () => {
  const f = compositionFixture(),
    p = f.manifest.facts[0].proof,
    s = f.packet.queryResults[0];
  p.value = 1;
  p.leaders = [
    { id: 'p', count: 1 },
    { id: 'q', count: 1 },
  ];
  p.groups = structuredClone(p.leaders);
  p.matchedGroupCount = s.matchedGroupCount = 2;
  s.groups = [
    { key: 'p', count: 1 },
    { key: 'q', count: 1 },
  ];
  f.packet.linkedContext.rows[1].playerId = 'q';
  f.manifest.facts[2].proof.playerId = 'q';
  assert.deepEqual(required(f), ['f0', 'f1', 'f2']);
  const large = compositionFixture(),
    r = large.manifest.facts[0].proof,
    source = large.packet.queryResults[0];
  r.value = 2;
  r.leaders = [
    { id: 'p', count: 2 },
    { id: 'q', count: 2 },
  ];
  r.groups = structuredClone(r.leaders);
  r.totalCount = source.count = 4;
  r.matchedGroupCount = source.matchedGroupCount = 2;
  source.groups = [
    { key: 'p', count: 2 },
    { key: 'q', count: 2 },
  ];
  for (const i of [3, 4]) {
    const event = structuredClone(large.manifest.facts[1]),
      row = structuredClone(large.packet.linkedContext.rows[0]);
    event.id = 'f' + i;
    event.proof.eventId = row.id = 'attempt-' + i;
    event.proof.playerId = row.playerId = 'q';
    event.proof.time = row.time = row.arrivedAt = i;
    event.claim.evidence[0].id = row.id;
    large.manifest.facts.push(event);
    large.packet.linkedContext.rows.push(row);
  }
  assert.equal(
    required(large),
    null,
    'Never drop a tied player or silently shorten outcomes to fit four facts',
  );
});
