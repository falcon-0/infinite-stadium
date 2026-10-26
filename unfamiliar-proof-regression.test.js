import test from 'node:test';
import assert from 'node:assert/strict';
import { matchState } from './match-stream.js';
import { executeMatchQuery } from './match-query.js';
import { buildQuestionFacts, selectQuestionFacts } from './question-facts.js';
import { canonicalScoreAnswer, requestedQuantityIssues } from './match-question-ai.js';
import { canonicalIdentityInventory } from './query-inventory-proof.js';
import { allowedOperationSubjects } from './operation-capabilities.js';
const query = (i, filters, extra = {}) =>
  executeMatchQuery(
    { kind: i.kind, seed: i.seed, time: i.time },
    { filters, aggregate: 'list', order: 'asc', limit: 20, timeFrom: 0, timeTo: i.time, ...extra },
  );
function packet(input, queries) {
  const s = matchState(input);
  return {
    question: input.question,
    observedAt: input.time,
    responseLanguage: input.language || 'en',
    teams: s.metadata.teams,
    roster: s.frames.at(-1).players,
    score: { home: s.stats.home.goals, away: s.stats.away.goals },
    queryResults: queries,
    requestedEvidence: queries,
  };
}

test('deduplicated zero-goal operands still prove current score and scoped zero quantities', () => {
  const i = { kind: 'sustained', seed: 17, time: 117, question: 'Who scored first?' },
    q = query(i, { type: 'shot', result: true }, { aggregate: 'by-team' }),
    p = packet(i, [q]),
    m = buildQuestionFacts(p),
    f = m.facts.find((f) => f.proof.kind === 'confirmed-score');
  assert.ok(f);
  const s = selectQuestionFacts(m, [f.id, ...f.proof.componentFactIds]);
  assert.equal(s.claims.length, 1);
  assert.equal(canonicalScoreAnswer(s, 117), true);
  const d = {
      action: 'shot',
      state: 'goal',
      grouping: 'by-team',
      subjectIds: ['away'],
      timeFrom: 0,
      timeTo: 117,
      qualifiers: null,
    },
    part = { requestSpan: 'did any away shots go in', claimIndices: [0], requestedQuantity: [d] };
  assert.deepEqual(requestedQuantityIssues(part, { claims: s.claims }, p, s), []);
  for (const patch of [{ state: 'pending' }, { timeFrom: 1 }])
    assert.ok(
      requestedQuantityIssues(
        { ...part, requestedQuantity: [{ ...d, ...patch }] },
        { claims: s.claims },
        p,
        s,
      ).length,
    );
  for (const mutate of [
    (s) => (s.proofs[0].modelGenerated = true),
    (s) => (s.proofs[0].operands[0].value = 1),
    (s) => s.claims[0].evidence.splice(0),
    (s) => (s.proofs[0].operands[0].timeTo = 116),
  ]) {
    const bad = structuredClone(s);
    mutate(bad);
    assert.equal(canonicalScoreAnswer(bad, 117), false);
  }
  assert.equal(canonicalScoreAnswer(s, 118), false);
});

test('positive identity inventories require complete current cited actor coverage and cannot supply requested counts', () => {
  const i = {
      kind: 'interrupted',
      seed: 41,
      time: 112,
      question: 'Which away players attempted a shot?',
    },
    q = query(i, { type: 'shot', team: 'away' }),
    p = packet(i, [q]),
    m = buildQuestionFacts(p),
    ids = m.facts
      .filter(
        (f) =>
          (f.proof.kind === 'event' &&
            !f.proof.attributes &&
            f.proof.eventType === 'shot' &&
            f.proof.teamId === 'away') ||
          (f.proof.kind === 'shooting-profile' && f.proof.subjectId === 'away'),
      )
      .map((f) => f.id),
    s = selectQuestionFacts(m, ids),
    a = { claims: s.claims },
    d = {
      action: 'shot',
      state: 'any',
      grouping: 'by-player',
      subjectIds: ['away-10'],
      timeFrom: 0,
      timeTo: 112,
      qualifiers: null,
    },
    part = {
      requestSpan: i.question,
      claimIndices: s.claims.map((_, i) => i),
      requestedQuantity: [d],
    };
  assert.equal(canonicalIdentityInventory(part, a, s, p, d), true);
  assert.deepEqual(requestedQuantityIssues(part, a, p, s), []);
  for (const change of [
    (v) => (v.requestedEvidence[0].truncated = true),
    (v) => v.requestedEvidence[0].rows.forEach((row) => row.revision++),
    (v) => v.requestedEvidence[0].rows.push(v.requestedEvidence[0].rows[0]),
    (v) => (v.requestedEvidence[0].scope.missingFields.playerId = 1),
  ]) {
    const bad = structuredClone(p);
    change(bad);
    assert.equal(canonicalIdentityInventory(part, a, s, bad, d), false);
  }
  assert.equal(
    canonicalIdentityInventory(
      part,
      {
        claims: s.claims.map((c) => ({
          ...c,
          evidence: c.evidence.filter((r) => r.type !== 'scope'),
        })),
      },
      s,
      p,
      d,
    ),
    false,
  );
  assert.equal(canonicalIdentityInventory(part, a, s, p, { ...d, subjectIds: ['away-9'] }), false);
  assert.ok(
    requestedQuantityIssues(
      { ...part, requestSpan: 'How many shots did each away player attempt?' },
      a,
      p,
      s,
    ).length,
  );
});

test('two requested windows yield one exact source-backed comparison without duplicate operand claims', () => {
  const i = {
      kind: 'counter',
      seed: 1000,
      time: 120,
      question: 'Compare home completed passes before 01:00 and from 01:00 onward.',
    },
    a = query(
      i,
      { type: 'pass', team: 'home', result: true },
      { aggregate: 'count', timeTo: 60, timeToExclusive: true },
    ),
    b = query(
      i,
      { type: 'pass', team: 'home', result: true },
      { aggregate: 'count', timeFrom: 60 },
    ),
    p = packet(i, [a, b]),
    m = buildQuestionFacts(p),
    f = m.facts.find((f) => f.proof.kind === 'window-count-comparison');
  assert.ok(f);
  assert.deepEqual(
    f.proof.operands.map((p) => p.value),
    [5, 3],
  );
  assert.equal(f.proof.margin, 2);
  assert.equal(f.proof.leader, 'first');
  assert.equal(f.claim.evidence.length, 2);
  const s = selectQuestionFacts(m, [f.id, ...f.proof.componentFactIds]);
  assert.equal(s.claims.length, 1);
  for (const o of f.proof.operands) {
    const d = {
      action: 'pass',
      state: 'completed',
      grouping: 'named-entity',
      subjectIds: ['home'],
      timeFrom: o.timeFrom,
      timeTo: o.timeTo,
      timeFromExclusive: !!o.timeFromExclusive,
      timeToExclusive: !!o.timeToExclusive,
      qualifiers: null,
    };
    assert.deepEqual(
      requestedQuantityIssues(
        { requestSpan: 'Give each count', claimIndices: [0], requestedQuantity: [d] },
        { claims: s.claims },
        p,
        s,
      ),
      [],
    );
  }
  for (const change of [
    (v) => v.requestedEvidence.splice(1),
    (v) => (v.requestedEvidence[1].truncated = true),
    (v) => (v.requestedEvidence[1].query.filters.result = false),
  ]) {
    const bad = structuredClone(p);
    change(bad);
    assert.equal(
      buildQuestionFacts(bad).facts.some((f) => f.proof.kind === 'window-count-comparison'),
      false,
    );
  }
});

test('a single named side does not license an invented opponent comparison operand', () => {
  const s = matchState({ kind: 'counter', seed: 1000, time: 120 }),
    c = { roster: s.frames.at(-1).players, teams: s.metadata.teams };
  assert.deepEqual(
    allowedOperationSubjects({
      ...c,
      question:
        'Did the home side complete more passes before 01:00 or from 01:00 onward? Give each count and the difference.',
    }).difference,
    [],
  );
  assert.deepEqual(
    allowedOperationSubjects({
      ...c,
      question: 'Compare the home side with the away side for completed passes.',
    }).difference,
    [['home', 'away']],
  );
});

test('only an unrestricted complete combined zero can replace both confirmed-goal counts', () => {
  const i = { kind: 'sustained', seed: 17, time: 117, question: 'Who scored first?' },
    q = query(i, { type: 'shot', result: true, outcome: 'goal' }, { aggregate: 'count' }),
    p = packet(i, [q]),
    m = buildQuestionFacts(p),
    f = m.facts.find(
      (f) => f.proof.kind === 'count' && f.proof.metric === 'goals' && f.proof.subjectId === null,
    ),
    s = selectQuestionFacts(m, [f.id]);
  assert.equal(canonicalScoreAnswer(s, 117), true);
  for (const change of [
    (p) => (p.value = 1),
    (p) => (p.query.filters.player = 'home-10'),
    (p) => (p.query.filters.bodyPart = 'left-foot'),
    (p) => (p.coverage.missingFields.result = 1),
    (p) => (p.timeToExclusive = true),
  ]) {
    const bad = structuredClone(s);
    change(bad.proofs[0]);
    assert.equal(canonicalScoreAnswer(bad, 117), false);
  }
});
import {
  explicitCompletedPassCount,
  bindExplicitCompletedPassCount,
  passQuerySelectionPermission,
} from './pass-query-permissions.js';
test('aggregate completion questions bind their explicit outcome without changing event or mixed-state queries', () => {
  const input = {
      question:
        'Did the home side complete more passes before 01:00 or from 01:00 onward? Give each count and the difference.',
    },
    q = {
      filters: { type: 'pass', team: 'home' },
      aggregate: 'count',
      timeFrom: 0,
      timeTo: 60,
      timeToExclusive: true,
    };
  assert.equal(explicitCompletedPassCount(input), true);
  assert.deepEqual(passQuerySelectionPermission(input).results, [true]);
  assert.deepEqual(bindExplicitCompletedPassCount(input, q), {
    ...q,
    filters: { ...q.filters, result: true },
  });
  assert.equal(Object.hasOwn(q.filters, 'result'), false);
  for (const question of [
    'Did Cole complete his last pass?',
    'How many completed and failed passes were there?',
    "Since 01:20, give each side's completed-pass count and tell me how many attempts are still unsettled across both sides.",
    'Compare passing accuracy percentages.',
    'Count all passes, not just completed passes.',
  ])
    assert.equal(explicitCompletedPassCount({ question }), false);
  assert.equal(
    bindExplicitCompletedPassCount(input, { ...q, aggregate: 'list' }).filters.result,
    undefined,
  );
  assert.equal(
    bindExplicitCompletedPassCount(input, { ...q, filters: { ...q.filters, result: false } })
      .filters.result,
    false,
  );
});
test('a complete attempt-count comparison cannot satisfy an explicit completion-count request', () => {
  const i = {
      kind: 'counter',
      seed: 1000,
      time: 120,
      question:
        'Did the home side complete more passes before 01:00 or from 01:00 onward? Give each count and the difference.',
    },
    q = query(
      i,
      { type: 'pass', team: 'home' },
      { aggregate: 'count', timeTo: 60, timeToExclusive: true },
    ),
    p = packet(i, [q]),
    m = buildQuestionFacts(p),
    f = m.facts.find((f) => f.proof.kind === 'count' && f.proof.metric === 'passes'),
    s = selectQuestionFacts(m, [f.id]);
  const d = {
    action: 'pass',
    state: 'any',
    grouping: 'named-entity',
    subjectIds: ['home'],
    timeFrom: 0,
    timeTo: 60,
    timeToExclusive: true,
    qualifiers: null,
  };
  assert.ok(
    requestedQuantityIssues(
      { requestSpan: i.question, claimIndices: [0], requestedQuantity: [d] },
      { claims: s.claims },
      p,
      s,
    ).some((issue) => /completed-pass/.test(issue.reason)),
  );
});
test('equivalent complete zero-goal totals render once without collapsing narrower or positive totals', () => {
  const i = { kind: 'sustained', seed: 17, time: 117, question: 'Who scored?' },
    group = query(i, { type: 'shot', result: true }, { aggregate: 'by-team' }),
    combined = query(i, { type: 'shot', result: true, outcome: 'goal' }, { aggregate: 'count' }),
    p = packet(i, [group, combined]),
    m = buildQuestionFacts(p),
    f = m.facts.find((f) => f.proof.kind === 'confirmed-score'),
    a = m.facts.find(
      (f) => f.proof.kind === 'count' && f.proof.subjectId === null && f.proof.metric === 'goals',
    );
  assert.ok(a && f);
  const s = selectQuestionFacts(m, [a.id, f.id]);
  assert.equal(s.claims.length, 1);
  assert.equal(s.proofs[0].kind, 'confirmed-score');
  assert.equal(s.normalizations[0].reason, 'equivalent-complete-zero-goals');
  for (const mutate of [
    (p) => (p.value = 1),
    (p) => (p.query.filters.bodyPart = 'left-foot'),
    (p) => (p.timeFromExclusive = true),
    (p) => (p.coverage.missingFields.result = 1),
  ]) {
    const altered = structuredClone(m);
    mutate(altered.facts.find((x) => x.id === a.id).proof);
    assert.equal(selectQuestionFacts(altered, [a.id, f.id]).claims.length, 2);
  }
});

import { directQuestionFacts } from './direct-question-facts.js';
test('one unique two-window comparison bypasses the writer but not semantic review', () => {
  const i = {
      kind: 'counter',
      seed: 1000,
      time: 120,
      question: 'Compare completed passes in the two intervals.',
    },
    a = query(
      i,
      { type: 'pass', team: 'home', result: true },
      { aggregate: 'count', timeTo: 60, timeToExclusive: true },
    ),
    b = query(
      i,
      { type: 'pass', team: 'home', result: true },
      { aggregate: 'count', timeFrom: 60 },
    ),
    p = { ...packet(i, [a, b]), requestComponents: [i.question] },
    m = buildQuestionFacts(p),
    direct = directQuestionFacts(p, m, { focus: 'other', form: 'fact' });
  assert.equal(direct.composition.factIds.length, 1);
  assert.equal(
    m.facts.find((f) => f.id === direct.composition.factIds[0]).proof.kind,
    'window-count-comparison',
  );
  assert.equal(directQuestionFacts(p, m, { focus: 'other', form: 'explanation' }), null);
  const extra = structuredClone(m);
  extra.facts.push({
    ...structuredClone(extra.facts.find((f) => f.proof.kind === 'window-count-comparison')),
    id: 'ambiguous-comparison',
  });
  assert.equal(directQuestionFacts(p, extra, { focus: 'other', form: 'fact' }), null);
});
import { sourceSequenceWitness, sourceSequenceLinks } from './source-sequence-proof.js';
import { claimEvidenceChecks, projectReviewEvidence } from './question-evidence-check.js';
test('ordered keeper composites preserve their source-linked sequence without treating the shot actor as the answer', () => {
  const i = {
      kind: 'duel',
      seed: 1001,
      time: 120,
      language: 'pt',
      question:
        'Quem ficou com a bola depois do remate defendido mais recente da equipa visitante?',
    },
    s = matchState(i),
    q = query(
      i,
      { type: 'shot', team: 'away', outcome: 'saved', result: false },
      { order: 'desc', limit: 1 },
    ),
    p = {
      ...packet(i, [q]),
      linkedContext: {
        rows: s.events
          .filter((row) => !q.rows.some((sourceRow) => sourceRow.id === row.id))
          .map((row) => ({
            ...row,
            evidence: [{ type: 'event', id: row.id, revision: row.revision }],
          })),
      },
      requestComponents: [i.question],
    },
    m = buildQuestionFacts(p),
    f = m.facts.find((f) => f.proof.kind === 'linked-goalkeeper-hold' && f.proof.orderedShot);
  assert.ok(f);
  const selected = selectQuestionFacts(m, [f.id]),
    answer = { scope: 'match', claims: selected.claims },
    checks = claimEvidenceChecks(answer, p),
    part = {
      requestSpan: i.question,
      requestedAction: 'recovery',
      temporalRelation: 'after-requested-event',
      relationEntityBinding: 'none',
      relationSourceLinkIndex: sourceSequenceLinks(p).findIndex(
        (link) => link.witness.id === f.proof.eventId,
      ),
      claimIndices: [0],
    };
  const witness = () => sourceSequenceWitness(part, answer, checks, selected, p);
  assert.equal(witness().witness.id, f.proof.eventId);
  const projected = projectReviewEvidence(p, answer),
    projectedPart = {
      ...part,
      relationSourceLinkIndex: sourceSequenceLinks(projected).findIndex(
        (link) => link.witness.id === f.proof.eventId,
      ),
    };
  assert.equal(sourceSequenceWitness(projectedPart, answer, checks, selected, projected), false);
  assert.equal(
    sourceSequenceWitness(projectedPart, answer, checks, selected, projected, p).witness.id,
    f.proof.eventId,
  );
  const missingCoverage = structuredClone(p);
  missingCoverage.queryResults.forEach((query) => {
    query.rows = [];
  });
  assert.equal(
    sourceSequenceWitness(projectedPart, answer, checks, selected, projected, missingCoverage),
    false,
  );

  assert.equal(directQuestionFacts(p, m, { form: 'fact', focus: 'event-actor' }), null);
  for (const mutate of [
    (v) => v.proofs[0].shotRevision++,
    (v) => (v.proofs[0].holderId = 'away-10'),
    (v) => delete v.proofs[0].orderedShot,
    (v) => v.claims[0].evidence.splice(0),
  ]) {
    const bad = structuredClone(selected);
    mutate(bad);
    assert.equal(sourceSequenceWitness(part, { claims: bad.claims }, checks, bad, p), false);
  }
  assert.equal(
    sourceSequenceWitness(
      { ...part, relationEntityBinding: 'same-team' },
      answer,
      checks,
      selected,
      p,
    ),
    false,
  );
});
test('window comparisons preserve the exact one-minute boundary and singular units', () => {
  const i = {
      kind: 'duel',
      seed: 1001,
      time: 120,
      question: 'Compare away shots before and since 01:00.',
    },
    a = query(
      i,
      { type: 'shot', team: 'away' },
      { aggregate: 'count', timeTo: 60, timeToExclusive: true },
    ),
    b = query(i, { type: 'shot', team: 'away' }, { aggregate: 'count', timeFrom: 60 }),
    m = buildQuestionFacts(packet(i, [a, b])),
    f = m.facts.find((f) => f.proof.kind === 'window-count-comparison');
  assert.deepEqual(
    f.proof.operands.map((p) => p.value),
    [1, 2],
  );
  assert.equal(f.proof.margin, 1);
  assert.match(f.claim.text, /1 shot;/);
  assert.match(f.claim.text, /Difference: 1 shot,/);
  assert.doesNotMatch(f.claim.text, /1 shots/);
});

test('keeper collection is stated once while both ordered scopes remain provable', () => {
  const i = {
      kind: 'duel',
      seed: 1001,
      time: 120,
      language: 'pt',
      question:
        'Quem ficou com a bola depois do remate defendido mais recente da equipa visitante?',
    },
    shot = query(
      i,
      { type: 'shot', team: 'away', result: false, outcome: 'saved' },
      { order: 'desc', limit: 1 },
    ),
    recovery = query(
      i,
      { type: 'recovery', recoveryClass: 'ball-win' },
      { order: 'asc', limit: 1, timeFrom: 106, timeFromExclusive: true },
    ),
    p = {
      ...packet(i, [shot, recovery]),
      linkedContext: {
        rows: matchState(i)
          .events.filter((row) => ![...shot.rows, ...recovery.rows].some((q) => q.id === row.id))
          .map((row) => ({
            ...row,
            evidence: [{ type: 'event', id: row.id, revision: row.revision }],
          })),
      },
    },
    manifest = buildQuestionFacts(p),
    composite = manifest.facts.find(
      (f) => f.proof.kind === 'linked-goalkeeper-hold' && f.proof.orderedRecovery,
    ),
    atom = manifest.facts.find(
      (f) => f.proof.kind === 'ordered-event' && f.proof.event.eventId === recovery.rows[0].id,
    );
  assert.ok(composite && atom);
  const selection = selectQuestionFacts(manifest, [atom.id, composite.id]);
  assert.equal(selection.claims.length, 1);
  assert.deepEqual(selection.originalToSelectedIndex, [0, 0]);
  assert.deepEqual(selection.proofs[0].orderedRecovery, atom.proof);
  for (const ref of atom.claim.evidence)
    assert.ok(
      selection.claims[0].evidence.some((other) => JSON.stringify(other) === JSON.stringify(ref)),
    );
  assert.equal((selection.claims[0].text.match(/N\. Moreno/g) || []).length, 1);
  for (const mutate of [
    (p) => p.event.revision++,
    (p) => p.event.time++,
    (p) => (p.event.playerId = 'away-10'),
    (p) => (p.query.timeFrom = 0),
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed.facts.find((f) => f.id === atom.id).proof);
    assert.equal(selectQuestionFacts(changed, [atom.id, composite.id]).claims.length, 2);
  }
});
