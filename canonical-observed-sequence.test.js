import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalObservedSequenceWitness as witness } from './canonical-observed-sequence.js';
import { buildQuestionFacts, selectQuestionFacts } from './question-facts.js';
import { matchState } from './match-stream.js';
import { executeMatchQuery } from './match-query.js';
import { explicitNamedShotAnchor, reviewRequestAdequacy } from './match-question-ai.js';

function fixture() {
  const input = {
      kind: 'sustained',
      seed: 17,
      time: 80,
      question: "How did the action develop before Reed's shot at 01:14?",
    },
    state = matchState(input),
    shot = state.events.find((e) => e.type === 'shot' && e.time === 74),
    endpoint = { type: 'event', id: shot.id, revision: shot.revision };
  const anchor = executeMatchQuery(
    { kind: input.kind, seed: input.seed, time: input.time },
    { filters: { id: shot.id }, aggregate: 'list', limit: 1, timeFrom: 0, timeTo: 80 },
  );
  const source = executeMatchQuery(
    { kind: input.kind, seed: input.seed, time: input.time },
    {
      filters: { id: shot.passId, type: 'pass', team: shot.team },
      aggregate: 'list',
      limit: 1,
      timeFrom: 0,
      timeTo: 74,
      timeToExclusive: true,
    },
  );
  const binding = {
    relation: 'before',
    sameTeam: true,
    samePlayer: false,
    anchor: endpoint,
    anchorTime: 74,
    anchorIdentifiedBy: 'requested-moment',
    anchorScope: anchor.scopeReference,
    scopeReference: source.scopeReference,
    query: source.query,
    resultEvents: source.rows.map((row) => ({ type: 'event', id: row.id, revision: row.revision })),
  };
  const packet = {
    question: input.question,
    observedAt: 80,
    requestedForm: 'explanation',
    explanationTarget: 'observed-sequence',
    responseLanguage: 'en',
    roster: state.frames.at(-1).players,
    teams: state.metadata.teams,
    requestedMoment: { time: 74, reference: endpoint },
    queryResults: [anchor, source],
    requestedEvidence: [anchor, source],
    linkedContext: {
      rows: executeMatchQuery(
        { kind: input.kind, seed: input.seed, time: input.time },
        { filters: {}, aggregate: 'list', order: 'asc', limit: 20, timeFrom: 0, timeTo: 80 },
      ).rows,
    },
    queryRelations: [binding],
  };
  const manifest = buildQuestionFacts(packet),
    fact = manifest.facts.find(
      (f) =>
        f.proof.eventId === shot.id &&
        f.proof.sequenceBasis === 'explicit-recovery-pass-reception-shot',
    );
  assert.ok(fact);
  const selection = selectQuestionFacts(manifest, [fact.id]),
    answer = { scope: 'match', claims: selection.claims };
  const part = {
    requestSpan: input.question.slice(0, -1),
    claimIndices: [0],
    answerForm: 'explanation',
    requestedAction: 'other',
    explanationTarget: 'observed-sequence',
    temporalRelation: 'before-requested-event',
    relationAnchorClaimIndex: 0,
    relationEntityBinding: 'same-player',
    requestedQuantity: null,
    requestedSourceAttributes: null,
  };
  return structuredClone({ input, packet, selection, answer, part, endpoint });
}
const check = (f) => witness(f.part, f.answer, f.selection, f.packet, f.endpoint);
test('exact canonical full chain proves shooter reception before named shot despite supplier query actor differing', () => {
  const f = fixture(),
    result = check(f);
  assert.ok(result);
  assert.match(result.witness.id, /receive-72$/);
  assert.equal(result.proves, 'positive-linked-predecessor');
  f.part.requestedAction = 'receive';
  assert.ok(check(f));
  f.part.requestedAction = 'pass';
  assert.equal(check(f), null);
  f.part.relationEntityBinding = 'same-team';
  assert.ok(check(f));
});
test('review adequacy accepts actual generic same-player label only with full canonical chain and executed named anchor', () => {
  const f = fixture(),
    review = {
      checks: [{ claimIndex: 0, supported: true, shotOutcomeAssertions: [] }],
      requestCheck: { coverage: [f.part] },
    };
  assert.deepEqual(
    reviewRequestAdequacy(review, f.answer, f.packet, { canonicalFactSelection: f.selection }),
    [],
  );
  f.part.requestedAction = 'pass';
  assert.ok(
    reviewRequestAdequacy(review, f.answer, f.packet, { canonicalFactSelection: f.selection })
      .length,
  );
});
test('no wrong endpoint, revision, actor, window, deleted/unreceived row, missing dependency or fabricated text can use chain witness', () => {
  for (const mutate of [
    (f) => f.endpoint.revision++,
    (f) => (f.packet.requestedMoment.time = 16),
    (f) => (f.packet.queryRelations = []),
    (f) => (f.packet.queryRelations[0].relation = 'after'),
    (f) => (f.packet.queryRelations[0].anchorTime = 16),
    (f) => (f.packet.queryRelations[0].anchor = { ...f.endpoint, id: 'other-shot' }),
    (f) => (f.packet.queryRelations[0].resultEvents = []),
    (f) =>
      (f.packet.queryRelations[0].scopeReference = { type: 'scope', id: 'other', revision: 1 }),
    (f) => (f.packet.queryRelations[0].query = { ...f.packet.queryRelations[0].query, timeTo: 67 }),
    (f) => (f.selection.proofs[0].sequenceLinks[2].playerId = 'away-7'),
    (f) => (f.selection.proofs[0].sequenceLinks[1].revision = 1),
    (f) => (f.selection.proofs[0].modelGenerated = true),
    (f) =>
      f.packet.linkedContext.rows.push({
        ...f.packet.linkedContext.rows.find((row) => row.id.endsWith('receive-72')),
        revision: 2,
      }),
    (f) => (f.answer.claims[0].text += ' Reed intended to score.'),
    (f) => f.answer.claims[0].evidence.pop(),
    (f) => {
      for (const row of f.packet.linkedContext.rows)
        if (row.id.endsWith('receive-72')) row.operation = 'delete';
    },
    (f) => {
      for (const row of f.packet.linkedContext.rows)
        if (row.id.endsWith('receive-72')) row.arrivedAt = 81;
    },
    (f) => {
      for (const row of f.packet.linkedContext.rows)
        if (row.id.endsWith('receive-72')) row.passId = 'unlinked';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(check(f), null);
  }
});
test('canonical chronology cannot answer intention, absence, count, a different action or an extra source attribute', () => {
  for (const change of [
    { explanationTarget: 'decision-rationale' },
    { answerForm: 'fact' },
    { temporalRelation: 'after-requested-event' },
    { requestedAction: 'recovery' },
    { requestedAction: 'shot' },
    { requestedAnchorOrdinal: 1 },
    { requestedQuantity: [{ action: 'shot', state: 'any' }] },
    { requestedSourceAttributes: [{ source: 'roster', sourceField: 'number' }] },
  ]) {
    const f = fixture();
    Object.assign(f.part, change);
    assert.equal(check(f), null);
  }
  const f = fixture();
  assert.equal(
    explicitNamedShotAnchor(
      { ...f.input, question: f.input.question.replace('01:14', '00:16') },
      f.packet.roster,
      f.packet.linkedContext.rows,
    ).time,
    16,
  );
});
