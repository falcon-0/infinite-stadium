import { quantityPopulationReviewPolicy } from './question-policies.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import {
  explicitPendingCountAction,
  endpointStoryExtraRequirements,
  bindComponentWindowQueries,
  mixedKnownQuantityFacts,
  requestedPlayerRankings,
  componentQuantityCoverageSchema,
  requestedListCounts,
  requestedQuantitySchema,
  inventoryDependencyCovers,
  canonicalPendingReception,
  canonicalCompletedReception,
  asksActualMatchOccurrence,
  independentRankingContextRequested,
  ordinalDependentScope,
  sourceAttributeReviewBudget,
  requestedSourceAttributeIssues,
  deduplicateWriterRequestedEvidence,
  answerMatchQuestionAI,
  explicitOrdinalRelation,
  explicitQuestionOrdinal,
  explicitCombinedQuantitySpans,
  unsupportedNeitherCountClaims,
  canonicalOutcomeDistinction,
  quantityRepairFacts,
  requestedQuantityIssues,
  resolvePlannedRelation,
  goalEndpointRepairFacts,
  canonicalAttributedRoleCorrection,
  canonicalGoalSequenceWitness,
  canonicalRequestedEventOutcome,
  unsupportedGoalEndpointClaims,
  explicitNamedShotStatus,
  explicitNamedShotAnchor,
  bindExplicitTemporalEndpoints,
  projectWriterFactCatalog,
  maximumQuestionModelCalls,
  reviewCoverageMatches,
  requestComponents,
  resolveNumericReview,
  reviewRequestAdequacy,
  ambiguousConversationPlayers,
  sourceScopedSequenceFacts,
  sourceConversationActionAnchor,
  sourceExplicitActionAnchor,
  sourceAnchoredPlanIssues,
  augmentSourceRelativeQueries,
  repeatedUserQuestionReference,
} from './match-question-ai.js';
import { buildQuestionFacts, selectQuestionFacts } from './question-facts.js';
import { compareWatchWorkflow } from './watch-comparison.js';
import { executeMatchQuery } from './match-query.js';
import { matchState } from './match-stream.js';
import { footballKnowledgeCatalog, retrieveFootballKnowledge } from './football-knowledge.js';
import { projectReviewEvidence } from './question-evidence-check.js';
import { passQuerySelectionPermission, passQueryOutcomeAllowed } from './pass-query-permissions.js';
import { actionOutcome, checkActionEvidence } from './action-evidence.js';

test('quantity wire factors action branches while runtime retains population constraints', () => {
  const roster = [{ id: 'home-1' }, { id: 'away-10' }];
  const schema = requestedQuantitySchema(['Count the actions'], roster);
  assert.equal(schema.anyOf.length, 5, 'Do not duplicate each action once per grouping');
  const branch = (action) =>
    schema.anyOf.find((v) => v.properties.action.enum[0] === action).properties;
  assert.deepEqual(branch('recovery').state.enum, ['any']);
  assert.ok(!branch('pass').state.enum.includes('saved'));
  const populations = branch('shot').population.anyOf;
  assert.deepEqual(
    populations.map((p) => p.properties.grouping.enum[0]),
    ['combined', 'by-team', 'by-player', 'named-entity'],
  );
  assert.equal(populations[0].properties.subjectIds.maxItems, 0);
  assert.deepEqual(populations[1].properties.subjectIds.items.enum, ['home', 'away']);
  assert.deepEqual(populations[2].properties.subjectIds.items.enum, ['home-1', 'away-10']);
  assert.deepEqual(branch('recovery').qualifiers.anyOf[1].properties.bodyPart, { type: 'null' });
  assert.ok(
    branch('recovery').qualifiers.anyOf[1].properties.linkedShotOutcome.anyOf[0].enum.includes(
      'saved',
    ),
  );
  const answer = {
    scope: 'match',
    claims: [{ kind: 'observation', text: '0 passes', evidence: [] }],
  };
  for (const [grouping, subjectIds, reason] of [
    ['combined', ['home-1'], /actual entity type/],
    ['by-team', ['home-1'], /Team grouping/],
    ['by-team', ['home', 'home'], /Team grouping/],
    ['by-player', ['home'], /actual entity type/],
    ['named-entity', ['unlisted'], /actual entity type/],
  ]) {
    const part = {
      requestSpan: 'How many passes',
      claimIndices: [0],
      requestedQuantity: [
        {
          requestSpan: 'How many passes',
          action: 'pass',
          state: 'any',
          grouping,
          subjectIds,
          timeFrom: 0,
          timeTo: 120,
          timeFromExclusive: false,
          timeToExclusive: false,
          qualifiers: null,
        },
      ],
    };
    const issues = requestedQuantityIssues(
      part,
      answer,
      { question: 'How many passes?', observedAt: 120, roster, queryResults: [] },
      { proofs: [] },
      [],
    );
    assert.ok(
      issues.some((issue) => reason.test(issue.reason)),
      grouping + JSON.stringify(subjectIds),
    );
  }
});

test('list count augmentation executes exact predicates and bounds instead of counting returned rows', () => {
  const input = { kind: 'duel', seed: 2071, time: 118 },
    source = executeMatchQuery(input, {
      filters: { type: 'shot', team: 'away', bodyPart: 'right-foot' },
      aggregate: 'list',
      limit: 1,
      timeFrom: 0,
      timeTo: 118,
      timeFromExclusive: true,
    });
  let called;
  const [count] = requestedListCounts([source], (query) => {
    called = query;
    return executeMatchQuery(input, query);
  });
  assert.deepEqual(called.filters, source.query.filters);
  assert.equal(called.timeFromExclusive, true);
  assert.equal(called.timeTo, 118);
  assert.equal(called.aggregate, 'count');
  assert.equal(
    count.count,
    executeMatchQuery(input, { ...source.query, aggregate: 'count' }).count,
  );
  assert.notEqual(called.limit, 1);
  assert.deepEqual(
    requestedListCounts(
      [{ ...source, entityResolution: { player: { status: 'unresolved' } } }],
      () => assert.fail('No unresolved query'),
    ),
    [],
  );
});

test('keeper collection quantity needs recovery any plus the exact explicit linked predicates', () => {
  const input = { kind: 'counter', seed: 2063, time: 90 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: {
        type: 'recovery',
        player: 'home-1',
        recoveryKind: 'goalkeeper-hold',
        linkedShotOutcome: 'saved',
      },
      aggregate: 'count',
      timeFrom: 0,
      timeTo: 90,
    });
  const packet = {
      question: 'How many recorded collections?',
      observedAt: 90,
      roster: state.frames.at(-1).players,
      teams: state.metadata.teams,
      requestedEvidence: [source],
    },
    fact = buildQuestionFacts(packet).facts.find(
      (f) => f.proof.metric === 'savedAttemptCollections',
    );
  assert.ok(fact);
  assert.equal(fact.proof.value, 2);
  const demand = {
    action: 'recovery',
    state: 'any',
    grouping: 'named-entity',
    subjectIds: ['home-1'],
    timeFrom: 0,
    timeTo: 90,
    qualifiers: { recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' },
  };
  const check = (d) =>
    requestedQuantityIssues(
      { claimIndices: [0], requestedQuantity: [d] },
      { claims: [fact.claim] },
      packet,
      { proofs: [fact.proof] },
    );
  assert.deepEqual(check(demand), []);
  for (const bad of [
    { ...demand, state: 'saved' },
    { ...demand, qualifiers: null },
    { ...demand, qualifiers: { recoveryKind: 'goalkeeper-hold' } },
    { ...demand, qualifiers: { recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'blocked' } },
    { ...demand, grouping: 'by-team', subjectIds: ['home-1'] },
    { ...demand, subjectIds: ['away-1'] },
    { ...demand, timeTo: 28 },
  ])
    assert.ok(check(bad).length);
});

test('filtered quantity coverage retains subtype, exclusive bounds and explicit team subsets', () => {
  const input = { kind: 'duel', seed: 2071, time: 15 },
    span = 'Combien de centres Northbridge a-t-il réussis avant 00:15';
  const source = executeMatchQuery(input, {
    filters: { type: 'pass', team: 'home', result: true, passType: 'cross' },
    aggregate: 'count',
    timeFrom: 0,
    timeTo: 15,
    timeToExclusive: true,
  });
  const state = matchState(input),
    packet = {
      question: span,
      responseLanguage: 'fr',
      observedAt: 15,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: [source],
      queryResults: [source],
    };
  const manifest = buildQuestionFacts(packet),
    fact = manifest.facts.find(
      (f) =>
        f.proof.kind === 'count' &&
        f.proof.metric === 'completedPasses' &&
        f.proof.query.filters.passType === 'cross',
    );
  assert.ok(fact, 'source-built filtered count is available');
  const demand = {
    requestSpan: span,
    action: 'pass',
    state: 'completed',
    grouping: 'by-team',
    subjectIds: ['home'],
    timeFrom: 0,
    timeTo: 15,
    timeFromExclusive: false,
    timeToExclusive: true,
    qualifiers: { passType: 'cross', bodyPart: null, technique: null },
  };
  const part = {
    requestSpan: span,
    answerForm: 'fact',
    claimIndices: [0],
    requestedQuantity: [demand],
  };
  const check = (d = demand, f = fact, p = packet) =>
    requestedQuantityIssues({ ...part, requestedQuantity: [d] }, { claims: [f.claim] }, p, {
      proofs: [f.proof],
    });
  assert.deepEqual(check(), []);
  for (const bad of [
    { ...demand, requestSpan: 'centres réussis' },
    { ...demand, qualifiers: null },
    { ...demand, qualifiers: { passType: 'short' } },
    { ...demand, timeToExclusive: false },
    { ...demand, timeTo: 14 },
    { ...demand, state: 'any' },
    { ...demand, subjectIds: [] },
    { ...demand, subjectIds: ['home-11'] },
    { ...demand, subjectIds: ['home', 'home'] },
  ])
    assert.ok(check(bad).length, JSON.stringify(bad));
  const generic = structuredClone(fact);
  delete generic.proof.query.filters.passType;
  assert.ok(
    check(demand, generic, { ...packet, requestedEvidence: [], queryResults: [] }).length,
    'all completed passes cannot answer crosses',
  );
  const recovery = quantityRepairFacts(
    manifest,
    {
      requestCheck: {
        coverage: [
          part,
          { requestSpan: 'qui les a tentés', answerForm: 'fact', requestedQuantity: null },
        ],
      },
    },
    packet,
  );
  assert.ok(recovery.includes(fact.id), 'identity-only followup does not invent by-player counts');
});

test('assessment quantity repair includes both attempt and on-target comparisons with exact bounds', () => {
  const input = { kind: 'duel', seed: 2071, time: 118 },
    span = 'Compare both sides attempts and shots on target';
  const sources = [undefined, 'on-target'].map((outcome) =>
    executeMatchQuery(input, {
      filters: { type: 'shot', ...(outcome ? { outcome } : {}) },
      aggregate: 'by-team',
      timeFrom: 0,
      timeTo: 118,
    }),
  );
  const state = matchState(input),
    packet = {
      question: span,
      observedAt: 118,
      teams: state.metadata.teams,
      roster: state.frames.at(-1).players,
      requestedEvidence: sources,
      queryResults: sources,
    },
    manifest = buildQuestionFacts(packet);
  const demands = ['any', 'on-target'].map((state) => ({
    requestSpan: span,
    action: 'shot',
    state,
    grouping: 'by-team',
    subjectIds: [],
    timeFrom: 0,
    timeTo: 118,
    timeFromExclusive: false,
    timeToExclusive: false,
    qualifiers: null,
  }));
  const part = {
    requestSpan: span,
    answerForm: 'assessment',
    claimIndices: [0],
    requestedQuantity: demands,
  };
  const ids = quantityRepairFacts(manifest, { requestCheck: { coverage: [part] } }, packet),
    facts = ids.map((id) => manifest.facts.find((f) => f.id === id));
  assert.equal(facts.length, 2);
  assert.deepEqual(
    new Set(facts.map((f) => f.proof.metric)),
    new Set(['attempts', 'shotsOnTarget']),
  );
  assert.deepEqual(
    requestedQuantityIssues(
      { ...part, claimIndices: [0, 1] },
      { claims: facts.map((f) => f.claim) },
      packet,
      { proofs: facts.map((f) => f.proof) },
    ),
    [],
  );
  const sot = facts.find((f) => f.proof.metric === 'shotsOnTarget');
  assert.ok(
    requestedQuantityIssues(part, { claims: [sot.claim] }, packet, { proofs: [sot.proof] }).length,
    'SOT-only does not cover attempts',
  );
  const wrong = structuredClone(part);
  wrong.requestedQuantity[0].timeFrom = 80;
  assert.deepEqual(
    quantityRepairFacts(manifest, { requestCheck: { coverage: [wrong] } }, packet),
    [],
  );
});

test('actual W operation-first five-call repair preserves attempts before any reviewer feedback', async () => {
  const question =
    "Harbour look busier in attack—are they actually getting more shots on target than Northbridge? Compare both sides' attempts and shots on target so far, then give me a measured verdict.";
  const input = { kind: 'duel', seed: 2071, time: 118, question };
  let repaired = false;
  const plan = {
    answerFocus: 'team-assessment',
    requestedForm: 'assessment',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        { filters: { type: 'shot', team: 'home' }, aggregate: 'by-team', timeFrom: 0, timeTo: 118 },
        {
          filters: { type: 'shot', team: 'home', outcome: 'on-target' },
          aggregate: 'by-team',
          timeFrom: 0,
          timeTo: 118,
        },
      ],
    },
  };
  const choose = (packet, body) => {
    const repair = !!packet.evidence;
    packet = packet.evidence || packet;
    const facts = packet.matchFacts.facts.filter(
      (f) =>
        f.selection.kind === 'team-comparison' &&
        ['attempts', 'shotsOnTarget'].includes(f.selection.metric) &&
        f.selection.timeFrom === 0 &&
        f.selection.timeTo === 118,
    );
    const selected = repair ? facts : facts.filter((f) => f.selection.metric === 'shotsOnTarget');
    if (repair) {
      repaired = true;
      assert.equal(selected.length, 2);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.ok(modes.every((m) => m.properties.mode.enum[0] === 'explanation'));
      assert.equal(modes[0].properties.factIds.minItems, 2);
      assert.equal(modes[0].properties.factIds.maxItems, 2);
      assert.equal(modes[0].properties.factIds.items.enum.length, 2);
    }
    return {
      scope: 'match',
      composition: {
        mode: 'explanation',
        factIds: selected.map((f) => f.id),
        claim: {
          text: 'Harbour produced more attempts, but Northbridge put more on target. Volume alone does not establish better chances.',
          kind: 'interpretation',
          evidence: [],
          dependsOn: selected.map((_, i) => i),
        },
      },
      followUp: '',
    };
  };
  const review = (packet) => ({
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      requestedInformation: question,
      responseIntent: {
        purpose: 'assessment',
        needsAssessment: true,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
        reason: 'A qualified comparison is requested.',
      },
      coverage: packet.requestComponents.map((requestSpan) => ({
        requestSpan,
        claimIndices: packet.answer.claims.map((_, i) => i),
        answerForm: 'assessment',
        requestedAction: 'shot',
        requestedQuantity: ['any', 'on-target'].map((state) => ({
          requestSpan: requestSpan.includes('Compare')
            ? state === 'any'
              ? 'attempts'
              : 'shots on target'
            : requestSpan,
          action: 'shot',
          state,
          grouping: 'by-team',
          subjectIds: [],
          timeFrom: 0,
          timeTo: 118,
          timeFromExclusive: false,
          timeToExclusive: false,
          qualifiers: null,
        })),
      })),
      reason: 'All comparisons and the verdict are stated.',
    },
  });
  const operation = {
    answerFocus: 'team-assessment',
    requestedForm: 'assessment',
    mentionedPlayers: [],
    decision: {
      kind: 'operation',
      plan: {
        version: 1,
        obligations: [
          {
            id: 'shotsOnTargetDifference',
            requestSpan: requestComponents(question)[0],
            operator: 'difference',
            metric: 'shotsOnTarget',
            subjects: ['away', 'home'],
            timeFrom: 0,
            timeTo: 118,
          },
        ],
      },
    },
  };
  const mock = sequenceTransport([operation, plan, choose, choose, review]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.ok(repaired);
  assert.equal(result.execution.modelCalls, 5);
  assert.deepEqual(
    new Set(result.canonicalFactSelection.proofs.filter(Boolean).map((p) => p.metric)),
    new Set(['attempts', 'shotsOnTarget']),
  );
  assert.match(result.answer, /Harbour produced more attempts/);
  assert.ok(result.claims.filter((c) => c.kind === 'observation').every((c) => c.evidence.length));
});

test('French filtered count repair retains the independently requested delivery identity', async () => {
  const input = {
    kind: 'duel',
    seed: 2071,
    time: 15,
    language: 'fr',
    question: 'Combien de centres Northbridge a-t-il réussis avant 00:15, et qui les a tentés ?',
  };
  const plan = {
    answerFocus: 'other',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', team: 'home', result: true, passType: 'cross' },
          aggregate: 'count',
          timeFrom: 0,
          timeTo: 900,
          timeFromExclusive: false,
          timeToExclusive: true,
        },
        {
          filters: { type: 'pass', team: 'home', passType: 'cross' },
          aggregate: 'by-player',
          timeFrom: 0,
          timeTo: 900,
          timeFromExclusive: false,
          timeToExclusive: true,
        },
      ],
    },
  };
  const choose = (packet) => {
    const repair = !!packet.evidence;
    packet = packet.evidence || packet;
    const event = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'event' && f.selection.attributes?.passType === 'cross',
      ),
      count = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === 'home',
      );
    assert.ok(event);
    if (repair) assert.ok(count);
    return {
      scope: 'match',
      composition: { mode: 'facts', factIds: repair ? [count.id, event.id] : [event.id] },
      followUp: '',
    };
  };
  const review = (packet, body) => {
    const quantity = resolvedWireSchema(
      body,
    ).properties.requestCheck.properties.coverage.items.anyOf[0].properties.requestedQuantity.anyOf.find(
      (v) => v.type === 'array',
    ).items.anyOf[0].properties;
    assert.deepEqual(quantity.requestSpan.enum, [requestComponents(input.question)[0]]);
    assert.ok(!quantity.requestSpan.enum.includes('centres réussis'));
    assert.deepEqual(quantity.timeTo.enum, [15]);
    assert.deepEqual(quantity.timeToExclusive.enum, [true]);
    return {
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Le nombre et le joueur sont explicitement indiqués.',
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: [packet.answer.claims.length === 1 ? 0 : i],
          answerForm: 'fact',
          requestedAction: 'pass',
          requestedQuantity: i
            ? null
            : [
                {
                  requestSpan,
                  action: 'pass',
                  state: 'completed',
                  grouping: 'by-team',
                  subjectIds: ['home'],
                  timeFrom: 0,
                  timeTo: 15,
                  timeFromExclusive: false,
                  timeToExclusive: true,
                  qualifiers: { passType: 'cross', bodyPart: null, technique: null },
                },
              ],
        })),
      },
    };
  };
  const correct = structuredClone(plan);
  correct.decision.queries.forEach((q) => (q.timeTo = 15));
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      assert.equal(packet.planningCorrection.kind, 'explicit-clock-window');
      const query = decisionBranch(body, 'queries').properties.queries.items.anyOf[0];
      assert.deepEqual(query.properties.timeTo.enum, [15]);
      assert.deepEqual(query.properties.timeToExclusive.enum, [true]);
      return correct;
    },
    choose,
    review,
    choose,
    review,
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 6);
  assert.match(result.answer, /N\. Aziz/);
  assert.match(result.answer, /1/);
  const count = result.canonicalFactSelection.proofs.find((p) => p?.kind === 'count');
  assert.equal(count.query.filters.passType, 'cross');
  assert.equal(count.timeTo, 15);
  assert.equal(count.timeToExclusive, true);
  const invalid = sequenceTransport([plan, plan]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: invalid.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-invalid-operation' && /absolute clock/.test(error.message),
  );
  assert.equal(invalid.count(), 2);
});

test('actual W French list-only plan recovers a complete filtered count in the existing five calls', async () => {
  const input = {
    kind: 'duel',
    seed: 2071,
    time: 15,
    language: 'fr',
    question: 'Combien de centres Northbridge a-t-il réussis avant 00:15, et qui les a tentés ?',
  };
  const plan = {
    answerFocus: 'event-actor',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', team: 'home', result: true, passType: 'cross' },
          aggregate: 'list',
          order: 'asc',
          limit: 20,
          timeFrom: 0,
          timeTo: 15,
          timeFromExclusive: false,
          timeToExclusive: true,
        },
      ],
    },
  };
  let recoveredCount;
  const choose = (packet) => {
    const repair = !!packet.evidence;
    packet = packet.evidence || packet;
    const event = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'event' && f.selection.attributes?.passType === 'cross',
      ),
      count = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === 'home',
      );
    assert.ok(event && count, 'executed count exists even though planner asked for list only');
    if (repair) recoveredCount = count.id;
    return {
      scope: 'match',
      composition: { mode: 'facts', factIds: repair ? [count.id, event.id] : [event.id] },
      followUp: '',
    };
  };
  const review = (packet) => ({
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      requestedInformation: input.question,
      reason: 'Count and player supplied.',
      coverage: packet.requestComponents.map((requestSpan, i) => ({
        requestSpan,
        claimIndices: [packet.answer.claims.length === 1 ? 0 : i],
        answerForm: 'fact',
        requestedAction: 'pass',
        requestedQuantity: i
          ? null
          : [
              {
                requestSpan,
                action: 'pass',
                state: 'completed',
                grouping: 'by-team',
                subjectIds: ['home'],
                timeFrom: 0,
                timeTo: 15,
                timeFromExclusive: false,
                timeToExclusive: true,
                qualifiers: { passType: 'cross' },
              },
            ],
      })),
    },
  });
  const mock = sequenceTransport([plan, choose, review, choose, review]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.ok(result.canonicalFactSelection.selectedFactIds.includes(recoveredCount));
  assert.match(result.answer, /N\. Aziz/);
  const proof = result.canonicalFactSelection.proofs.find((p) => p.kind === 'count');
  assert.equal(proof.value, 1);
  assert.deepEqual(proof.query.filters, {
    type: 'pass',
    team: 'home',
    result: true,
    passType: 'cross',
  });
  assert.equal(proof.timeToExclusive, true);
  assert.equal(proof.timeTo, 15);
});

test('mixed absolute-clock and overall quantity planning keeps distinct source windows', async () => {
  const input = {
    kind: 'duel',
    seed: 2071,
    time: 118,
    question: 'How many completed passes before 00:15, and how many shots overall?',
  };
  const plan = {
    answerFocus: 'other',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', result: true },
          aggregate: 'count',
          timeFrom: 0,
          timeTo: 15,
          timeFromExclusive: false,
          timeToExclusive: true,
        },
        {
          filters: { type: 'shot' },
          aggregate: 'count',
          timeFrom: 0,
          timeTo: 118,
          timeFromExclusive: false,
          timeToExclusive: false,
        },
      ],
    },
  };
  const review = (packet, body) => {
    const q = resolvedWireSchema(
      body,
    ).properties.requestCheck.properties.coverage.items.anyOf[0].properties.requestedQuantity.anyOf.find(
      (v) => v.type === 'array',
    ).items.anyOf[0].properties;
    assert.equal(q.timeTo.enum, undefined, 'review does not globally impose the first window');
    return {
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Each measure has its own requested window.',
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: [i],
          answerForm: 'fact',
          requestedAction: i ? 'shot' : 'pass',
          requestedQuantity: [
            {
              requestSpan,
              action: i ? 'shot' : 'pass',
              state: i ? 'any' : 'completed',
              grouping: 'combined',
              subjectIds: [],
              timeFrom: 0,
              timeTo: i ? 118 : 15,
              timeFromExclusive: false,
              timeToExclusive: !i,
              qualifiers: null,
            },
          ],
        })),
      },
    };
  };
  const mock = sequenceTransport([
    (_packet, body) => {
      const variants = decisionBranch(body, 'queries').properties.queries.items.anyOf;
      assert.ok(variants.every((v) => !v.properties.timeTo.enum));
      return plan;
    },
    (packet) => {
      const facts = [
        ['completedPasses', 15],
        ['attempts', 118],
      ].map(([metric, to]) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === metric &&
            f.selection.subjectId === null &&
            f.selection.timeFrom === 0 &&
            f.selection.timeTo === to,
        ),
      );
      assert.ok(facts.every(Boolean));
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
        followUp: '',
      };
    },
    review,
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.deepEqual(
    result.canonicalFactSelection.proofs.map((p) => [p.metric, p.timeTo, !!p.timeToExclusive]),
    [
      ['completedPasses', 15, true],
      ['attempts', 118, false],
    ],
  );
});

test('question ordinal is bounded, action-scoped and independent of selected evidence', () => {
  for (const [text, value] of [
    ["After Walker's second saved attempt, whose pass came next?", 2],
    ['After the 2nd saved shot, who passed?', 2],
    ['Who made the first completed pass?', 1],
    ['Before the twentieth recovery, who shot?', 20],
  ])
    assert.equal(explicitQuestionOrdinal(text), value);
  for (const text of [
    'Who made the next pass?',
    'After the second shot and third pass, who recovered?',
    'After the 21st shot, who passed?',
    'In the first half, who shot?',
    'After the 2th shot, who passed?',
  ])
    assert.equal(explicitQuestionOrdinal(text), null);
});

test('explicit combined quantity spans preserve grouping without classifying outcome words', () => {
  const component =
    "give each side's completed-pass count and tell me how many attempts are still unsettled across both sides";
  assert.deepEqual(explicitCombinedQuantitySpans(component), [
    'tell me how many attempts are still unsettled across both sides',
  ]);
  for (const text of [
    'Who played across both teams?',
    'Which team played better across both sides?',
    'Compare both teams together.',
  ])
    assert.deepEqual(explicitCombinedQuantitySpans(text), []);
  const base = {
    action: 'pass',
    state: 'pending',
    grouping: 'by-team',
    subjectIds: [],
    timeFrom: 80,
    timeTo: 118,
    requestSpan: 'tell me how many attempts are still unsettled across both sides',
  };
  assert.ok(
    requestedQuantityIssues(
      { requestSpan: component, claimIndices: [], requestedQuantity: [base] },
      { claims: [] },
      {},
      null,
    ).some((issue) => issue.missingCombinedSpan),
  );
  assert.ok(
    requestedQuantityIssues(
      {
        requestSpan: component,
        claimIndices: [],
        requestedQuantity: [{ ...base, requestSpan: 'invented quantity' }],
      },
      { claims: [] },
      {},
      null,
    ).some((issue) => /exact source span/.test(issue.reason)),
  );
});

test('neither-team metric absence requires claim-local matching scope without treating uncertainty as zero', () => {
  const input = { kind: 'counter', seed: 1002, time: 118 };
  const shot = executeMatchQuery(input, {
      filters: { type: 'shot' },
      aggregate: 'count',
      timeFrom: 88,
      timeTo: 118,
    }),
    target = executeMatchQuery(input, {
      filters: { type: 'shot', outcome: 'on-target' },
      aggregate: 'count',
      timeFrom: 88,
      timeTo: 118,
    });
  shot.scopeReference = { type: 'scope', id: 'attempts', revision: 1 };
  target.scopeReference = { type: 'scope', id: 'on-target', revision: 1 };
  const packet = {
    question: 'Which side produced more shots?',
    observedAt: 118,
    queryResults: [shot, target],
    requestedEvidence: [shot, target],
  };
  const answer = {
    scope: 'match',
    claims: [
      {
        kind: 'limitation',
        text: 'Neither team had any shots on target during that period.',
        evidence: [],
      },
    ],
  };
  assert.equal(unsupportedNeitherCountClaims(answer, packet).length, 1);
  answer.claims[0].evidence = [shot.scopeReference];
  assert.equal(unsupportedNeitherCountClaims(answer, packet).length, 1);
  answer.claims[0].evidence = [target.scopeReference];
  assert.equal(unsupportedNeitherCountClaims(answer, packet).length, 0);
  answer.claims[0] = {
    kind: 'limitation',
    text: 'It is unclear whether neither team had any shots on target.',
    evidence: [],
  };
  assert.deepEqual(unsupportedNeitherCountClaims(answer, packet), []);
  answer.claims[0] = {
    kind: 'limitation',
    text: 'Shot counts do not establish which team was fitter.',
    evidence: [],
  };
  assert.deepEqual(unsupportedNeitherCountClaims(answer, packet), []);
});

test('complete same-player shot outcomes can correct an all-saved premise without invented numeric prose', async () => {
  const input = {
    kind: 'duel',
    seed: 1012,
    time: 118,
    question:
      "A. Blake's three attempts were all kept out by the goalkeeper, right? Break down how they actually ended.",
  };
  let captured;
  for (const requestedForm of ['fact', 'explanation']) {
    const mock = sequenceTransport([
      {
        answerFocus: 'event-sequence',
        explanationTarget: 'observed-sequence',
        requestedForm,
        mentionedPlayers: ['A. Blake'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'shot', team: 'away', player: 'A. Blake' },
              aggregate: 'list',
              order: 'asc',
              limit: 3,
              timeFrom: 0,
              timeTo: 118,
            },
          ],
        },
      },
      (packet) => {
        const facts = packet.matchFacts.facts.filter(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'shot' &&
            f.selection.playerId === 'away-10' &&
            !f.selection.attributes,
        );
        assert.equal(facts.length, 3);
        return {
          premiseCheck: {
            questionAssumption: 'All saved.',
            recordedAction: 'Blocked, off target and saved.',
            conclusion: 'contradicted',
          },
          scope: 'match',
          composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
          followUp: '',
        };
      },
      (packet) => {
        captured = packet;
        return {
          decision: 'approve',
          requestCheck: {
            status: 'answered',
            requestedInformation: input.question,
            reason: 'The complete source outcomes answer the alternative.',
            responseIntent: {
              purpose: 'premise-correction',
              needsAssessment: false,
              needsExplicitCorrection: true,
              needsMeasurementLimitation: false,
              reason: 'Outcomes explicitly correct all saved.',
            },
            coverage: packet.requestComponents.map((requestSpan) => ({
              requestSpan,
              claimIndices: [0, 1, 2],
              answerForm: requestedForm,
              requestedAction: 'shot',
              requestedQuantity: null,
            })),
          },
        };
      },
    ]);
    const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 3);
    assert.match(result.answer, /saved/);
    assert.doesNotMatch(result.answer, /defender/);
  }
  const fullPacket = {
    ...captured.evidence,
    requestedEvidence: [
      executeMatchQuery(
        { kind: input.kind, seed: input.seed, time: input.time },
        {
          filters: { type: 'shot', team: 'away', player: 'A. Blake' },
          aggregate: 'list',
          order: 'asc',
          limit: 3,
          timeFrom: 0,
          timeTo: 118,
        },
      ),
    ],
  };
  assert.equal(canonicalOutcomeDistinction(captured.canonicalFactSelection, fullPacket), true);
  for (const mutate of [
    (s) => {
      s.proofs.pop();
    },
    (s) => {
      s.proofs[0].revision++;
    },
    (s) => {
      s.proofs[0].playerId = 'home-10';
    },
  ]) {
    const bad = structuredClone(captured.canonicalFactSelection);
    mutate(bad);
    assert.equal(canonicalOutcomeDistinction(bad, fullPacket), false);
  }
  const truncated = structuredClone(fullPacket);
  truncated.requestedEvidence.forEach((q) => (q.truncated = true));
  assert.equal(canonicalOutcomeDistinction(captured.canonicalFactSelection, truncated), false);
  assert.ok(
    requestedQuantityIssues(
      {
        claimIndices: [0, 1, 2],
        requestedQuantity: [
          {
            action: 'shot',
            state: 'any',
            grouping: 'named-entity',
            subjectIds: ['away-10'],
            timeFrom: 0,
            timeTo: 118,
          },
        ],
      },
      captured.answer,
      captured.evidence,
      captured.canonicalFactSelection,
    ).length,
    'event facts cannot replace a requested complete numeric count',
  );
});

test('semantic quantity coverage repairs a pending subset omitted beside both team completions', async () => {
  const input = {
    kind: 'duel',
    seed: 1012,
    time: 118,
    question:
      "Since 01:20, give each side's completed-pass count and tell me how many attempts are still unsettled across both sides.",
  };
  let captured;
  const demands = [
    {
      action: 'pass',
      state: 'completed',
      grouping: 'by-team',
      subjectIds: [],
      timeFrom: 80,
      timeTo: 118,
    },
    {
      action: 'pass',
      state: 'pending',
      grouping: 'combined',
      subjectIds: [],
      timeFrom: 80,
      timeTo: 118,
    },
  ];
  const choose = (packet, pending) => {
    packet = packet.evidence || packet;
    const facts = packet.matchFacts.facts;
    const selected = ['home', 'away'].map((side) =>
      facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === side &&
          f.selection.timeFrom === 80,
      ),
    );
    selected.push(
      facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === (pending ? 'pendingPasses' : 'passes') &&
          f.selection.subjectId === null &&
          f.selection.timeFrom === 80,
      ),
    );
    assert.ok(selected.every(Boolean));
    return {
      scope: 'match',
      composition: { mode: 'facts', factIds: selected.map((f) => f.id) },
      followUp: '',
    };
  };
  const approve = (packet, body) => {
    captured = packet;
    assert.ok(
      resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf.every((v) =>
        v.required.includes('requestedQuantity'),
      ),
    );
    return {
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Independent typed obligations despite deliberately approving the initial total.',
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: packet.answer.claims.map((_, i) => i),
          answerForm: 'fact',
          requestedAction: 'pass',
          requestedQuantity: demands,
        })),
      },
    };
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', team: 'home', result: true },
            aggregate: 'count',
            timeFrom: 80,
            timeTo: 118,
          },
          {
            filters: { type: 'pass', team: 'away', result: true },
            aggregate: 'count',
            timeFrom: 80,
            timeTo: 118,
          },
          {
            filters: { type: 'pass', result: null },
            aggregate: 'count',
            timeFrom: 80,
            timeTo: 118,
          },
        ],
      },
    },
    (packet) => choose(packet, false),
    approve,
    (packet) => choose(packet, true),
    approve,
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.ok(
    result.canonicalFactSelection.proofs.some((p) => p.metric === 'pendingPasses' && p.value === 1),
  );
  const initialPlan = {
    answerFocus: 'team-assessment',
    explanationTarget: 'none',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: ['home', 'away', null].map((team) => ({
        filters: { type: 'pass', ...(team ? { team, result: true } : { result: null }) },
        aggregate: 'count',
        timeFrom: 80,
        timeTo: 118,
      })),
    },
  };
  const partitioned = sequenceTransport([
    initialPlan,
    (packet) => {
      const facts = [
        ...new Map(
          packet.matchFacts.facts
            .filter(
              (f) =>
                f.selection.kind === 'count' &&
                ['completedPasses', 'pendingPasses'].includes(f.selection.metric) &&
                ['home', 'away'].includes(f.selection.subjectId) &&
                f.selection.timeFrom === 80,
            )
            .map((f) => [f.selection.metric + f.selection.subjectId, f]),
        ).values(),
      ];
      assert.equal(facts.length, 4);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
        followUp: '',
      };
    },
    approve,
    (packet, body) => {
      const mode = resolvedWireSchema(body).properties.composition.anyOf[0];
      assert.deepEqual(mode.properties.mode.enum, ['facts']);
      assert.equal(mode.properties.factIds.minItems, 3);
      assert.equal(mode.properties.factIds.maxItems, 3);
      assert.equal(packet.evidence.matchFacts.facts.length, 3);
      return choose(packet, true);
    },
    approve,
  ]);
  const partitionAnswer = await answerMatchQuestionAI(input, {
    config,
    fetcher: partitioned.fetcher,
    canRepair: () => true,
  });
  assert.equal(partitionAnswer.execution.modelCalls, 5);
  assert.ok(
    partitionAnswer.canonicalFactSelection.proofs.some(
      (p) => p.metric === 'pendingPasses' && p.subjectId === null && p.value === 1,
    ),
  );
  const typedDemands = demands.map((d, i) => ({
    ...d,
    requestSpan: i
      ? 'tell me how many attempts are still unsettled across both sides'
      : "give each side's completed-pass count",
  }));
  let groupingReviews = 0;
  const groupingReview = (packet, body) => {
    groupingReviews++;
    const reply = approve(packet, body);
    reply.requestCheck.coverage.forEach((part) => {
      part.requestedQuantity = typedDemands.map((d, i) => ({
        ...d,
        grouping: i && groupingReviews === 1 ? 'by-team' : d.grouping,
      }));
    });
    return reply;
  };
  const groupingMock = sequenceTransport([
    initialPlan,
    (packet) => {
      const all = [
        ...new Map(
          packet.matchFacts.facts
            .filter(
              (f) =>
                f.selection.kind === 'count' &&
                ['completedPasses', 'pendingPasses'].includes(f.selection.metric) &&
                ['home', 'away'].includes(f.selection.subjectId) &&
                f.selection.timeFrom === 80,
            )
            .map((f) => [f.selection.metric + f.selection.subjectId, f]),
        ).values(),
      ];
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: all.map((f) => f.id) },
        followUp: '',
      };
    },
    groupingReview,
    (packet) => choose(packet, true),
    groupingReview,
  ]);
  const grouped = await answerMatchQuestionAI(input, {
    config,
    fetcher: groupingMock.fetcher,
    canRepair: () => true,
  });
  assert.equal(grouped.execution.modelCalls, 5);
  assert.ok(
    grouped.canonicalFactSelection.proofs.some(
      (p) => p.metric === 'pendingPasses' && p.subjectId === null && p.value === 1,
    ),
  );
  const manifest = {
      facts: captured.canonicalFactSelection.proofs.map((proof, i) => ({
        id: 'test-' + i,
        proof,
        claim: captured.answer.claims[i],
      })),
    },
    review = { requestCheck: { coverage: [{ answerForm: 'fact', requestedQuantity: demands }] } };
  assert.equal(quantityRepairFacts(manifest, review, captured.evidence).length, 3);
  for (const mutate of [
    (m) => {
      m.facts = m.facts.filter((f) => f.proof.subjectId !== null);
    },
    (m) => {
      m.facts.find((f) => f.proof.subjectId === null).proof.timeFrom = 0;
    },
    (m) => {
      m.facts.find((f) => f.proof.subjectId === null).proof.metric = 'passes';
    },
  ]) {
    const bad = structuredClone(manifest);
    mutate(bad);
    assert.deepEqual(quantityRepairFacts(bad, review, captured.evidence), []);
  }
  assert.equal(
    quantityRepairFacts(
      manifest,
      { requestCheck: { coverage: [{ answerForm: 'assessment', requestedQuantity: demands }] } },
      captured.evidence,
    ).length,
    3,
    'mixed assessment retains required source counts; its composition must still include prose',
  );
  const part = {
    requestSpan: 'Separate successful deliveries by side, then give the shared unresolved tally.',
    claimIndices: captured.answer.claims.map((_, i) => i),
    requestedQuantity: demands,
  };
  assert.deepEqual(
    requestedQuantityIssues(
      part,
      captured.answer,
      captured.evidence,
      captured.canonicalFactSelection,
    ),
    [],
  );
  for (const changed of [
    { ...demands[1], state: 'unsuccessful' },
    { ...demands[1], grouping: 'by-team' },
    { ...demands[1], timeFrom: 0 },
    { ...demands[1], grouping: 'named-entity', subjectIds: ['home'] },
  ])
    assert.ok(
      requestedQuantityIssues(
        { ...part, requestedQuantity: [changed] },
        captured.answer,
        captured.evidence,
        captured.canonicalFactSelection,
      ).length,
    );
  const wrong = structuredClone(captured.canonicalFactSelection);
  const pending = wrong.proofs.find((p) => p.metric === 'pendingPasses');
  pending.metric = 'passes';
  pending.value = 6;
  assert.ok(requestedQuantityIssues(part, captured.answer, captured.evidence, wrong).length);
});

test('typed quantity matching permits only the exact proved ratio pending scope', () => {
  const refs = [0, 1, 2].map((i) => ({ type: 'scope', id: 'scope-' + i }));
  const answer = { claims: [{ evidence: refs }] };
  const demand = {
    action: 'pass',
    state: 'pending',
    grouping: 'combined',
    subjectIds: [],
    timeFrom: 80,
    timeTo: 118,
  };
  const part = { claimIndices: [0], requestedQuantity: [demand] };
  const proof = {
    operator: 'ratio',
    metric: 'passCompletionRate',
    status: 'proved',
    sourceFingerprint: 'verified-source',
    evidence: refs,
    window: { from: 80, to: 118 },
    values: { pendingExcluded: true, combined: { id: null, pending: 1 } },
  };
  assert.deepEqual(requestedQuantityIssues(part, answer, {}, null, [proof]), []);
  for (const change of [{ state: 'any' }, { grouping: 'by-team' }, { timeFrom: 0 }])
    assert.ok(
      requestedQuantityIssues(
        { ...part, requestedQuantity: [{ ...demand, ...change }] },
        answer,
        {},
        null,
        [proof],
      ).length,
    );
  assert.ok(
    requestedQuantityIssues(part, { claims: [{ evidence: refs.slice(1) }] }, {}, null, [proof])
      .length,
  );
  assert.deepEqual(
    requestedQuantityIssues({ claimIndices: [0] }, answer, {}, null, [proof]),
    [],
    'legacy fixtures defer to prior checks',
  );
  assert.ok(
    requestedQuantityIssues(
      {
        claimIndices: [0],
        requestSpan: 'How many attempts are unsettled?',
        requestedQuantity: null,
      },
      answer,
      {},
      null,
      [proof],
    ).length,
  );
  assert.deepEqual(
    requestedQuantityIssues(
      { claimIndices: [0], requestSpan: 'What does offside mean?', requestedQuantity: null },
      answer,
      {},
      null,
      [proof],
    ),
    [],
  );
});

test('typed ordinal anchor proves a current ascending prefix and independently reviewed next action', async () => {
  const input = {
    kind: 'counter',
    seed: 1002,
    time: 118,
    question:
      "After W. Walker's second saved attempt, whose next pass reached a teammate, and at what time?",
  };
  let captured;
  const anchor = {
    filters: { type: 'shot', player: 'W. Walker', outcome: 'saved' },
    aggregate: 'list',
    order: 'asc',
    limit: 2,
  };
  const dependent = {
    filters: { type: 'pass', result: true },
    aggregate: 'list',
    order: 'asc',
    limit: 1,
    relativeTo: {
      queryIndex: 0,
      relation: 'after',
      sameTeam: false,
      samePlayer: false,
      anchorOrdinal: 2,
    },
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['W. Walker'],
      decision: { kind: 'queries', queries: [anchor, dependent] },
    },
    (packet) => {
      const binding = packet.queryRelations[0];
      assert.equal(binding.anchorTime, 87);
      assert.equal(binding.query.timeFromExclusive, true);
      assert.equal(binding.anchorOrdinal.position, 2);
      assert.deepEqual(
        binding.anchorOrdinal.prefix.map((ref) => ref.time),
        [26, 87],
      );
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'ordered-event' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.timeFrom === 87,
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet, body) => {
      captured = packet;
      assert.ok(
        resolvedWireSchema(
          body,
        ).properties.requestCheck.properties.coverage.items.required.includes(
          'requestedAnchorOrdinal',
        ),
      );
      assert.deepEqual(
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.properties
          .requestedAnchorOrdinal,
        {
          type: 'integer',
          enum: [2],
          description:
            'This ordinal is independently extracted from the unique explicit action ordinal in the actual question, not from the chosen source anchor. Verify that the selected anchor matches it; withhold if it does not.',
        },
      );
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Second saved attempt at87 and next completed pass91 by a different actor.',
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'after-requested-event',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            requestedAnchorOrdinal: 2,
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /Q\. Blake/);
  const missingPlan = {
    answerFocus: 'event-actor',
    explanationTarget: 'none',
    requestedForm: 'fact',
    mentionedPlayers: ['W. Walker'],
    decision: {
      kind: 'queries',
      queries: [
        anchor,
        { ...dependent, relativeTo: { ...dependent.relativeTo, anchorOrdinal: null } },
      ],
    },
  };
  for (const onlyAnchor of [false, true]) {
    const retry = sequenceTransport([
      onlyAnchor
        ? { ...missingPlan, decision: { kind: 'queries', queries: [anchor] } }
        : missingPlan,
      (packet) => {
        assert.equal(
          packet.planningCorrection.kind,
          onlyAnchor ? 'missing-ordinal-dependent-query' : 'missing-ordinal-anchor',
        );
        if (onlyAnchor) {
          assert.equal(packet.planningCorrection.requiredOrdinal, 2);
          assert.equal(packet.planningCorrection.requiredRelation, 'after');
        } else
          assert.deepEqual(
            packet.planningCorrection.returnedPrefix.map((row) => row.time),
            [26, 87],
          );
        return { ...missingPlan, decision: { kind: 'queries', queries: [anchor, dependent] } };
      },
      (packet) => {
        const fact = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'ordered-event' &&
            f.selection.metric === 'completedPasses' &&
            f.selection.timeFrom === 87,
        );
        return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
      },
      (packet) => ({
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Independently requested second anchor and next pass.',
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'after-requested-event',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            requestedAnchorOrdinal: 2,
          })),
        },
      }),
    ]);
    const repaired = await answerMatchQuestionAI(input, {
      config,
      fetcher: retry.fetcher,
      canRepair: () => true,
    });
    assert.equal(repaired.execution.modelCalls, 4);
    assert.equal(repaired.execution.planningRepairs, 1);
    assert.match(repaired.answer, /01:31/);
  }
  assert.match(answer.answer, /01:31/);
  const review = {
    checks: [{ claimIndex: 0, supported: true, counts: [], shotOutcomeAssertions: [] }],
    requestCheck: {
      coverage: [
        {
          requestSpan: input.question,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'pass',
          temporalRelation: 'after-requested-event',
          relationAnchorClaimIndex: null,
          relationEntityBinding: 'none',
          requestedAnchorOrdinal: 2,
        },
      ],
    },
  };
  const packet = { ...captured.evidence, queryRelations: captured.queryRelations };
  assert.deepEqual(
    reviewRequestAdequacy(review, captured.answer, packet, {
      canonicalFactSelection: captured.canonicalFactSelection,
    }),
    [],
  );
  for (const change of [
    { requestedAnchorOrdinal: 1 },
    { requestedAnchorOrdinal: null },
    { relationEntityBinding: 'same-player' },
    { temporalRelation: 'before-requested-event' },
    { temporalRelation: 'none' },
  ]) {
    const wrong = structuredClone(review);
    Object.assign(wrong.requestCheck.coverage[0], change);
    assert.ok(
      reviewRequestAdequacy(wrong, captured.answer, packet, {
        canonicalFactSelection: captured.canonicalFactSelection,
      }).some((issue) => issue.anchorOrdinal === 2),
    );
  }
  const wrongBinding = structuredClone(packet);
  wrongBinding.queryRelations[0].anchorOrdinal.position = 1;
  const agreesWithWrongAnchor = structuredClone(review);
  agreesWithWrongAnchor.requestCheck.coverage[0].requestedAnchorOrdinal = 1;
  assert.ok(
    reviewRequestAdequacy(agreesWithWrongAnchor, captured.answer, wrongBinding, {
      canonicalFactSelection: captured.canonicalFactSelection,
    }).some((issue) => issue.anchorOrdinal === 1),
    'question second rejects agreement on an incorrect first anchor',
  );
  const anchorOnly = { ...missingPlan, decision: { kind: 'queries', queries: [anchor] } };
  const repeatedAnchor = sequenceTransport([anchorOnly, anchorOnly]);
  await assert.rejects(
    answerMatchQuestionAI(input, {
      config,
      fetcher: repeatedAnchor.fetcher,
      canRepair: () => true,
    }),
    /both its ordered anchor/,
  );
  assert.equal(
    repeatedAnchor.count(),
    2,
    'one planning repair only; no writer runs on missing dependent evidence',
  );
  assert.deepEqual(explicitOrdinalRelation(input.question), { ordinal: 2, relation: 'after' });
  assert.deepEqual(
    explicitOrdinalRelation('Before the second completed pass, whose shot came last?'),
    { ordinal: 2, relation: 'before' },
  );
  assert.equal(
    explicitOrdinalRelation('After the second shot but before the pass, who recovered?'),
    null,
  );
  assert.equal(explicitOrdinalRelation('Who made the second pass?'), null);
  assert.equal(explicitOrdinalRelation('Who made the second pass before halftime?'), null);
  const state = matchState(input),
    current = new Map(state.events.map((row) => [row.id, row])),
    roster = state.frames.at(-1).players,
    source = executeMatchQuery({ kind: input.kind, seed: input.seed, time: 118 }, anchor);
  assert.equal(
    resolvePlannedRelation(dependent, [source], 118, roster, current).binding.anchorOrdinal.prefix
      .length,
    2,
  );
  for (const mutate of [
    (s) => {
      s.rows[1].revision++;
    },
    (s) => {
      s.rows.reverse();
    },
    (s) => {
      s.rows.pop();
    },
    (s) => {
      s.scope.missingFields.outcome = 1;
    },
    (s) => {
      s.query.order = 'desc';
    },
    (s) => {
      s.scope.entityResolution.player.status = 'unresolved';
    },
  ]) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.throws(
      () => resolvePlannedRelation(dependent, [bad], 118, roster, current),
      /ordinal anchor/,
    );
  }
  for (const ordinal of [0, 21, 1.5])
    assert.throws(
      () =>
        resolvePlannedRelation(
          { ...dependent, relativeTo: { ...dependent.relativeTo, anchorOrdinal: ordinal } },
          [source],
          118,
          roster,
          current,
        ),
      /ordinal/,
    );
  const empty = executeMatchQuery(
    { kind: input.kind, seed: input.seed, time: 118 },
    { ...anchor, filters: { ...anchor.filters, result: true } },
  );
  assert.equal(
    empty.count,
    0,
    'contradictory intersection remains a legitimate empty query result',
  );
  assert.throws(
    () => resolvePlannedRelation(dependent, [empty], 118, roster, current),
    (error) => error.planningCorrection?.kind === 'contradictory-empty-shot-anchor',
  );
});

test('operation coverage rejection uses one bounded query repair for measured facts plus an unavailable inference', async () => {
  const input = {
    kind: 'counter',
    seed: 1002,
    time: 118,
    question:
      'Over the last half-minute, which side produced more shots, and is that enough to say they were the fitter side?',
  };
  const plan = {
    answerFocus: 'team-attacking-assessment',
    explanationTarget: 'other',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'operation',
      plan: {
        version: 1,
        obligations: [
          {
            id: 'shots',
            requestSpan: 'which side produced more shots',
            operator: 'difference',
            metric: 'attempts',
            subjects: ['home', 'away'],
            timeFrom: 88,
            timeTo: 118,
          },
        ],
      },
    },
  };
  const mistaken = (packet) => ({
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      requestedInformation: input.question,
      reason: 'Deliberately wrong approval of adjacent counts as inference.',
      coverage: packet.requestComponents.map((requestSpan, index) => ({
        requestSpan,
        claimIndices: [0],
        answerForm: index ? 'assessment' : 'fact',
        requestedAction: index ? 'other' : 'shot',
      })),
    },
  });
  const query = {
    answerFocus: 'team-attacking-assessment',
    explanationTarget: 'other',
    requestedForm: 'assessment',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'shot' }, aggregate: 'by-team', timeFrom: 88, timeTo: 118 }],
    },
  };
  const mock = sequenceTransport([
    plan,
    mistaken,
    (packet, body) => {
      assert.equal(packet.planningCorrection.kind, 'operation-coverage-incomplete');
      assert.ok(packet.planningCorrection.verifiedFacts.length);
      assert.deepEqual(
        resolvedWireSchema(body).properties.decision.anyOf.map(
          (branch) => branch.properties.kind.enum[0],
        ),
        ['queries'],
      );
      return query;
    },
    (packet) => {
      const facts = packet.matchFacts.facts.filter(
        (f) =>
          f.selection.kind === 'team-comparison' &&
          ['attempts', 'shotsOnTarget'].includes(f.selection.metric) &&
          f.selection.timeFrom === 88,
      );
      assert.equal(facts.length, 2);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: facts.map((f) => f.id),
          claim: {
            text: 'These shot counts cannot establish which side was fitter; fitness is not measured by these recorded actions.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'useful-limitation',
        requestedInformation: input.question,
        reason: 'Measured comparison and explicit unavailable inference.',
        coverage: packet.requestComponents.map((requestSpan, index) => ({
          requestSpan,
          claimIndices: index ? [2] : [0, 1],
          answerForm: index ? 'unavailable-measurement' : 'fact',
          requestedAction: index ? 'other' : 'shot',
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 5);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.ok(answer.execution.operationCoverageRecovery);
  assert.match(answer.answer, /cannot establish/);
  assert.ok(
    answer.canonicalFactSelection.proofs.some(
      (proof) => proof.metric === 'attempts' && proof.values.home === 2 && proof.values.away === 0,
    ),
  );
  let finalReviewPacket;
  const keepLimitation = (packet, body) => {
    const wireModes = resolvedWireSchema(body).properties.composition.anyOf;
    assert.equal(wireModes[0].properties.factIds.minItems, 2);
    assert.equal(wireModes[0].properties.factIds.maxItems, 2);
    const modes = wireModes.map((mode) => mode.properties.mode.enum[0]);
    assert.ok(!modes.includes('facts'), 'original missing assessment survives repair schema');
    packet = packet.evidence || packet;
    const facts = packet.matchFacts.facts.filter(
      (f) =>
        f.selection.kind === 'team-comparison' &&
        ['attempts', 'shotsOnTarget'].includes(f.selection.metric) &&
        f.selection.timeFrom === 88,
    );
    return {
      scope: 'match',
      composition: {
        mode: 'explanation',
        factIds: facts.map((f) => f.id),
        claim: {
          text: 'Northbridge produced more shots than Harbour Athletic in the last half-minute, with 2 shots to 0. However, this alone is not enough to conclude that Northbridge was the fitter side.',
          kind: 'limitation',
          evidence: [],
          dependsOn: [],
        },
      },
      followUp: '',
    };
  };
  const repairedMock = sequenceTransport([
    plan,
    mistaken,
    query,
    (packet) => {
      const facts = packet.matchFacts.facts.filter(
        (f) =>
          f.selection.kind === 'team-comparison' &&
          ['attempts', 'shotsOnTarget'].includes(f.selection.metric) &&
          f.selection.timeFrom === 88,
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: facts.map((f) => f.id),
          claim: {
            text: 'Neither team had any shots on target. These counts cannot establish fitness.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    keepLimitation,
    (packet) => {
      finalReviewPacket = packet;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'useful-limitation',
          requestedInformation: input.question,
          reason: 'Original assessment is preserved explicitly.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: index ? [2] : [0],
            answerForm: index ? 'assessment' : 'fact',
            requestedAction: index ? 'other' : 'shot',
          })),
        },
      };
    },
  ]);
  const repaired = await answerMatchQuestionAI(input, {
    config,
    fetcher: repairedMock.fetcher,
    canRepair: () => true,
  });
  assert.equal(repaired.execution.modelCalls, 6);
  assert.match(repaired.answer, /not enough to conclude/);
  assert.doesNotMatch(repaired.answer, /neither|with 2 shots to 0/i);
  const requiredResponseForms = repaired.execution.operationCoverageRecovery.requiredResponseForms;
  assert.equal(requiredResponseForms.length, 1);
  const dropped = {
    ...finalReviewPacket.answer,
    claims: finalReviewPacket.answer.claims.slice(0, 1),
  };
  const dishonest = {
    checks: [{ claimIndex: 0, supported: true, counts: [], shotOutcomeAssertions: [] }],
    requestCheck: {
      coverage: input.question
        ? requestComponents(input.question).map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: index ? 'assessment' : 'fact',
            requestedAction: index ? 'other' : 'shot',
          }))
        : [],
    },
  };
  assert.ok(
    reviewRequestAdequacy(
      dishonest,
      dropped,
      { ...finalReviewPacket.evidence, requiredResponseForms },
      { canonicalFactSelection: finalReviewPacket.canonicalFactSelection },
    ).some((issue) => issue.requiredAnswerForm === 'assessment'),
  );
  const denied = sequenceTransport([plan, mistaken]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: denied.fetcher, canRepair: () => false }),
    /did not fully answer/,
  );
  assert.equal(denied.count(), 2);
  const repeated = sequenceTransport([plan, mistaken, plan]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: repeated.fetcher, canRepair: () => true }),
    /query\/composition route/,
  );
  assert.equal(repeated.count(), 3);
});

test('writer catalog projection follows finite selection unions and local references without changing facts or proofs', () => {
  const catalog = {
    sourceFingerprint: 'source-identity',
    truncated: false,
    facts: ['a', 'b', 'c'].map((id) => ({
      id,
      claim: { text: id },
      proof: { scope: { id }, value: 2 },
    })),
  };
  const mode = (properties) => ({ type: 'object', additionalProperties: false, properties });
  const schema = {
    properties: {
      composition: {
        oneOf: [
          { $ref: '#/$defs/first' },
          mode({
            contextFactIds: {
              type: 'array',
              items: { anyOf: [{ const: 'b' }, { $ref: '#/$defs/id' }] },
            },
            limitationFactId: { enum: ['a'] },
          }),
        ],
      },
    },
    $defs: {
      first: mode({ factIds: { type: 'array', items: { $ref: '#/$defs/id' } } }),
      id: { type: 'string', enum: ['b'] },
      unused: { enum: ['c'] },
    },
  };
  const before = structuredClone(catalog),
    projected = projectWriterFactCatalog(catalog, schema);
  assert.deepEqual(
    projected.facts.map((f) => f.id),
    ['a', 'b'],
  );
  assert.equal(projected.sourceFingerprint, catalog.sourceFingerprint);
  assert.equal(projected.truncated, false);
  assert.equal(projected.facts[0], catalog.facts[0]);
  assert.equal(projected.facts[1].proof, catalog.facts[1].proof);
  assert.deepEqual(catalog, before);
  for (const items of [
    { type: 'string' },
    { $ref: '#/$defs/missing' },
    { $ref: 'external.json' },
    { allOf: [{ enum: ['a'] }] },
    { $ref: '#/$defs/cycle' },
  ]) {
    const open = {
      properties: { composition: mode({ factIds: { type: 'array', items } }) },
      $defs: { cycle: { $ref: '#/$defs/cycle' } },
    };
    assert.equal(projectWriterFactCatalog(catalog, open), catalog);
  }
  const mixed = {
    properties: {
      composition: {
        anyOf: [
          mode({ factIds: { type: 'array', items: { enum: ['a'] } } }),
          mode({
            factIds: { type: 'array', items: { type: 'string' } },
            claim: { type: 'string' },
          }),
        ],
      },
    },
  };
  assert.equal(
    projectWriterFactCatalog(catalog, mixed),
    catalog,
    'an unconstrained explanation preserves the full catalog',
  );
});

test('combined passing accuracy and its pending count use the same proved operation claim', async () => {
  const question =
    'What is the combined passing accuracy on settled passes, and how many attempts are still awaiting an outcome?';
  let captured;
  const mock = sequenceTransport([
    {
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'operation',
        plan: {
          version: 1,
          obligations: [
            {
              id: 'accuracy',
              requestSpan: 'combined passing accuracy on settled passes',
              operator: 'ratio',
              metric: 'passCompletionRate',
              subjects: [],
              timeFrom: 0,
              timeTo: 118,
            },
          ],
        },
      },
    },
    (packet) => {
      captured = packet;
      assert.equal(packet.operationProofs[0].values.combined.pending, 1);
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: question,
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
          })),
          reason: 'Combined settled-pass accuracy and separately reported pending count.',
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(
    { kind: 'interrupted', seed: 41, time: 118, question },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(answer.execution.modelCalls, 2);
  assert.match(answer.answer, /91\.7%/);
  assert.equal(answer.proofs[0].values.combined.completed, 11);
  assert.equal(answer.proofs[0].values.combined.denominator, 12);
  const span = requestComponents(question).at(-1),
    review = {
      requestCheck: {
        coverage: [
          { requestSpan: span, claimIndices: [0], answerForm: 'fact', requestedAction: 'pass' },
        ],
      },
      checks: [{ claimIndex: 0, counts: [], supported: true, shotOutcomeAssertions: [] }],
    };
  const packet = { ...captured.evidence, question, observedAt: 118 };
  assert.deepEqual(
    reviewRequestAdequacy(review, captured.answer, packet, {
      operationProofs: captured.operationProofs,
    }),
    [],
  );
  for (const mutate of [
    (proof) => {
      proof.status = 'unavailable';
    },
    (proof) => {
      proof.evidence[0].id = 'unrelated';
    },
    (proof) => {
      proof.metric = 'attempts';
    },
    (proof) => {
      delete proof.values.combined.pending;
    },
  ]) {
    const proofs = structuredClone(captured.operationProofs);
    mutate(proofs[0]);
    assert.ok(
      reviewRequestAdequacy(review, captured.answer, packet, { operationProofs: proofs }).some(
        (issue) => /quantity/.test(issue.reason),
      ),
    );
  }
  for (const requestSpan of [
    'how many shots are awaiting an outcome',
    'how many completed passes were there',
  ]) {
    const wrong = structuredClone(review);
    wrong.requestCheck.coverage[0].requestSpan = requestSpan;
    wrong.requestCheck.coverage[0].requestedAction = requestSpan.includes('shots')
      ? 'shot'
      : 'pass';
    assert.ok(
      reviewRequestAdequacy(
        wrong,
        captured.answer,
        { ...packet, question: question + ' ' + requestSpan },
        { operationProofs: captured.operationProofs },
      ).some((issue) => /quantity/.test(issue.reason)),
    );
  }
});

test('explicit named temporal anchors bind both pass endpoints despite erroneous reviewer actor metadata', async () => {
  const input = {
    kind: 'interrupted',
    seed: 41,
    time: 118,
    question:
      "Who made the last pass before Walker's saved shot at 01:04, and who made the first pass after it?",
  };
  const queries = [
    {
      filters: { type: 'pass' },
      aggregate: 'list',
      order: 'desc',
      limit: 1,
      timeFrom: 0,
      timeTo: 64,
    },
    {
      filters: { type: 'pass' },
      aggregate: 'list',
      order: 'asc',
      limit: 1,
      timeFrom: 64,
      timeTo: 118,
      timeFromExclusive: true,
    },
  ];
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['N. Walker'],
      decision: { kind: 'queries', queries },
    },
    (packet) => {
      assert.equal(packet.queryRelations.length, 2);
      assert.ok(
        packet.queryRelations.every(
          (binding) =>
            binding.anchor.id === 'comparison-interrupted-41-shot-64' &&
            binding.anchorIdentifiedBy === 'explicit-named-event-clock',
        ),
      );
      const facts = packet.matchFacts.facts.filter(
        (f) =>
          f.selection.kind === 'ordered-event' &&
          f.selection.metric === 'passes' &&
          (f.selection.timeTo === 64 || f.selection.timeFrom === 64),
      );
      assert.equal(facts.length, 2);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Source-bound endpoints with independent relevance review.',
        coverage: packet.requestComponents.map((requestSpan, index) => ({
          requestSpan,
          claimIndices: [index],
          answerForm: 'fact',
          requestedAction: 'pass',
          temporalRelation: index ? 'after-requested-event' : 'before-requested-event',
          relationAnchorClaimIndex: 0,
          relationEntityBinding: index ? 'none' : 'same-player',
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /Osei/);
  assert.match(answer.answer, /Dawson/);
  assert.equal(answer.queryRelations[0].query.timeToExclusive, true);
  assert.equal(answer.queryRelations[1].query.timeFromExclusive, true);
  const state = matchState(input),
    run = (query) =>
      executeMatchQuery({ kind: input.kind, seed: input.seed, time: input.time }, query),
    planned = queries.map(run),
    roster = [{ id: 'home-10', name: 'N. Walker' }];
  assert.ok(bindExplicitTemporalEndpoints(input, planned, roster, state.events, run));
  for (const question of [
    input.question.replace('saved', 'blocked'),
    input.question.replace('Walker', 'Dawson'),
    input.question.replace('01:04', '01:05'),
    input.question.replace('who made the first', 'who on the same team made the first'),
  ])
    assert.equal(
      bindExplicitTemporalEndpoints({ ...input, question }, planned, roster, state.events, run),
      null,
    );
  assert.equal(
    bindExplicitTemporalEndpoints(
      input,
      planned,
      roster,
      [
        ...state.events,
        { ...state.events.find((e) => e.type === 'shot' && e.time === 64), id: 'ambiguous-shot' },
      ],
      run,
    ),
    null,
  );
  assert.equal(
    bindExplicitTemporalEndpoints(
      input,
      [planned[0], { ...planned[1], query: { ...planned[1].query, timeFrom: 65 } }],
      roster,
      state.events,
      run,
    ),
    null,
  );
});

test('supported-language multipart quantities preserve both source-backed count obligations', () => {
  for (const question of [
    'Combien de passes ont été tentées et combien ont été réussies ?',
    '¿Cuántos pases hubo y cuántos fueron completados?',
    'Quantos passes houve e quantos foram completos?',
  ]) {
    const parts = requestComponents(question);
    assert.equal(parts.length, 2);
    const review = {
      requestCheck: {
        coverage: parts.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'pass',
        })),
      },
      checks: [{ claimIndex: 0, supported: true, counts: [], shotOutcomeAssertions: [] }],
    };
    const answer = {
      scope: 'match',
      claims: [{ kind: 'observation', text: 'Category definition only.', evidence: [] }],
    };
    assert.equal(
      reviewRequestAdequacy(review, answer, { question, observedAt: 118 }).filter((issue) =>
        /quantity/.test(issue.reason),
      ).length,
      2,
    );
  }
});

test('requested French pass window supplies and requires the actual completed partition', async () => {
  const input = {
    kind: 'interrupted',
    seed: 41,
    time: 118,
    language: 'fr',
    question:
      'Depuis 01:20, combien de passes ont été tentées au total, et combien sont déjà réussies ?',
  };
  let captured;
  const mock = sequenceTransport([
    {
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass' }, aggregate: 'count', timeFrom: 80, timeTo: 118 },
          { filters: { type: 'pass' }, aggregate: 'count', timeFrom: 80, timeTo: 118 },
        ],
      },
    },
    (packet) => {
      const facts = ['passes', 'completedPasses'].map((metric) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === metric &&
            f.selection.subjectId === null &&
            f.selection.timeFrom === 80,
        ),
      );
      assert.ok(facts.every(Boolean));
      assert.match(facts[0].claim.text, /4/);
      assert.match(facts[1].claim.text, /3/);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
        followUp: '',
      };
    },
    (packet) => {
      captured = packet;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Both actual totals for the requested interval.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: 'fact',
            requestedAction: 'pass',
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.canonicalFactSelection.proofs[1].value, 3);
  const review = {
    requestCheck: {
      coverage: [
        {
          requestSpan: requestComponents(input.question)[1],
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'pass',
        },
      ],
    },
    checks: [
      { claimIndex: 0, supported: true, counts: [], shotOutcomeAssertions: [] },
      { claimIndex: 1, supported: true, counts: [], shotOutcomeAssertions: [] },
    ],
  };
  assert.ok(
    reviewRequestAdequacy(
      review,
      captured.answer,
      { question: input.question, observedAt: 118 },
      { canonicalFactSelection: captured.canonicalFactSelection },
    ).some((issue) => /quantity/.test(issue.reason)),
    'total attempts do not answer the completed-pass component',
  );
});

test('a recorded non-goal shot supply can answer supplier and assist distinction with one canonical fact', async () => {
  const input = {
    kind: 'interrupted',
    seed: 41,
    time: 118,
    question:
      "Who supplied Moreno's effort at 01:46, and did that delivery earn a credited assist?",
  };
  let captured;
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['I. Moreno'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'shot', player: 'away-10' },
            aggregate: 'list',
            order: 'asc',
            limit: 1,
            timeFrom: 106,
            timeTo: 106,
          },
        ],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find((f) => f.selection.kind === 'linked-shot-supply');
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet) => {
      captured = packet;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason:
            'An explicit completed supply and final non-goal shot distinguish supply from a credited goal assist.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: index ? 'assist' : 'pass',
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.canonicalFactSelection.proofs[0].kind, 'linked-shot-supply');
  assert.match(answer.answer, /Kamau/);
  assert.match(answer.answer, /assist/);
  assert.equal(answer.claims.length, 1);
  const review = {
    requestCheck: {
      coverage: [
        {
          requestSpan: requestComponents(input.question)[1],
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'assist',
        },
      ],
    },
    checks: [{ claimIndex: 0, supported: true, counts: [], shotOutcomeAssertions: [] }],
  };
  const current = captured.canonicalFactSelection.proofs[0],
    statusPacket = {
      ...captured.evidence,
      requestedEventOutcome: {
        type: 'shot',
        time: 106,
        status: 'off-target',
        reference: { type: 'event', id: current.eventId, revision: current.revision },
      },
    };
  assert.deepEqual(
    reviewRequestAdequacy(review, captured.answer, statusPacket, {
      canonicalFactSelection: captured.canonicalFactSelection,
    }),
    [],
    'the composite already states this exact shot outcome',
  );
  const stale = structuredClone(captured.canonicalFactSelection);
  stale.proofs[0].revision++;
  assert.ok(
    reviewRequestAdequacy(review, captured.answer, statusPacket, {
      canonicalFactSelection: stale,
    }).some((issue) => issue.requestedEventOutcome),
    'a different source revision cannot satisfy current status',
  );
  for (const mutate of [
    (proof) => {
      proof.assistBasis = 'unknown';
    },
    (proof) => {
      proof.actionOutcome.status = 'pending';
    },
    (proof) => {
      proof.passId = 'unrelated-pass';
    },
    (proof) => {
      proof.passRevision++;
    },
    (proof) => {
      proof.supplierId = 'home-1';
    },
  ]) {
    const selection = structuredClone(captured.canonicalFactSelection);
    mutate(selection.proofs[0]);
    assert.ok(
      reviewRequestAdequacy(review, captured.answer, captured.evidence, {
        canonicalFactSelection: selection,
      }).some((issue) => issue.requestedAction === 'assist'),
    );
  }
});

test('an explicitly named Spanish pending-shot request cannot pass as a score-only answer', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 116,
    language: 'es',
    question: '¿El remate de Reed en el 01:56 ya cuenta como gol confirmado, o sigue pendiente?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'score',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['A. Reed'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'shot', player: 'home-10' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
        ],
      },
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'The exact current shot is pending; future confirmation is unavailable.',
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'shot',
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 2);
  assert.equal(answer.execution.repairs, 0);
  assert.deepEqual(answer.execution.answerFocusNormalization, {
    from: 'score',
    to: 'event-actor',
    basis: 'explicit-named-event-status',
    reference: { type: 'event', id: 'comparison-sustained-17-shot-116', revision: 1 },
  });
  assert.match(answer.answer, /pendiente/);
  assert.equal(answer.claims.length, 1);
  assert.doesNotMatch(answer.answer, /0 goles/);
  assert.ok(
    answer.canonicalFactSelection.proofs.some((proof) => {
      const p = proof.kind === 'ordered-event' ? proof.event : proof;
      return (
        p.kind === 'event' &&
        p.eventId === 'comparison-sustained-17-shot-116' &&
        p.actionOutcome.status === 'pending' &&
        p.revision === 1
      );
    }),
  );
  const expected = {
    type: 'shot',
    status: 'pending',
    reference: { type: 'event', id: 'comparison-sustained-17-shot-116', revision: 1 },
  };
  assert.equal(
    canonicalRequestedEventOutcome(answer.canonicalFactSelection, answer, expected),
    true,
  );
  for (const changed of [
    { ...expected, status: 'goal' },
    { ...expected, reference: { ...expected.reference, revision: 2 } },
    { ...expected, reference: { ...expected.reference, id: 'unrelated-shot' } },
    null,
  ])
    assert.equal(
      canonicalRequestedEventOutcome(answer.canonicalFactSelection, answer, changed),
      false,
    );
  assert.equal(
    canonicalRequestedEventOutcome(
      answer.canonicalFactSelection,
      { claims: answer.claims.map((claim) => ({ ...claim, evidence: [] })) },
      expected,
    ),
    false,
  );
  assert.equal(
    canonicalRequestedEventOutcome(answer.canonicalFactSelection, answer, expected, new Set()),
    false,
  );
  const state = matchState(input),
    roster = [{ id: 'home-10', name: 'A. Reed' }];
  assert.ok(explicitNamedShotStatus(input, roster, state.events));
  for (const question of [
    "What is the score after Reed's shot at 01:56, still pending?",
    input.question.replace('Reed', 'Walker'),
    input.question.replace('01:56', '01:55'),
  ])
    assert.equal(explicitNamedShotStatus({ ...input, question }, roster, state.events), null);
  assert.equal(
    explicitNamedShotStatus(input, roster, [
      ...state.events,
      { ...state.events.find((e) => e.type === 'shot' && e.time === 116), id: 'ambiguous-shot' },
    ]),
    null,
  );
});

test('exact status normalization preserves canonical contradiction handling and real score questions', async () => {
  const question =
    '¿El remate de Reed en el 01:56 ya cuenta como gol confirmado, o sigue pendiente?';
  const mock = sequenceTransport([
    {
      answerFocus: 'score',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['A. Reed'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'shot', player: 'home-10' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
          { filters: { type: 'shot', result: true }, aggregate: 'by-team' },
        ],
      },
    },
    (packet) => {
      assert.equal(packet.answerFocus, 'event-actor');
      const shot = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'shot' &&
          f.selection.time === 116 &&
          !f.selection.attributes,
      );
      return {
        premiseCheck: {
          questionAssumption: 'The named shot is already a goal',
          recordedAction: 'It is pending',
          conclusion: 'contradicted',
        },
        scope: 'match',
        composition: { mode: 'facts', factIds: [shot.id] },
        followUp: '',
      };
    },
    { decision: 'approve', reason: 'The exact named shot is pending.' },
  ]);
  const result = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 17, time: 116, language: 'es', question },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.execution.repairs, 0);
  assert.match(result.answer, /pendiente/);
  const score = sequenceTransport([
    {
      answerFocus: 'score',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['A. Reed'],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', result: true }, aggregate: 'by-team' }],
      },
    },
    {
      decision: 'approve',
      reason: 'Both current confirmed goal counts answer the score question.',
    },
  ]);
  const actual = await answerMatchQuestionAI(
    {
      kind: 'sustained',
      seed: 17,
      time: 116,
      question: "What is the score after Reed's shot at 01:56, still pending?",
    },
    { config, fetcher: score.fetcher },
  );
  assert.equal(actual.execution.answerFocus, 'score');
  assert.equal(actual.execution.answerFocusNormalization, undefined);
  assert.equal(actual.execution.modelCalls, 2);
});

test('positive goal endpoints need their exact current event citation in four supported scoring grammars', () => {
  const input = { kind: 'sustained', seed: 17, time: 118 },
    shots = executeMatchQuery(
      { kind: input.kind, seed: input.seed, time: input.time },
      { filters: { type: 'shot' }, aggregate: 'list', limit: 20 },
    ),
    passes = executeMatchQuery(
      { kind: input.kind, seed: input.seed, time: input.time },
      { filters: { type: 'pass' }, aggregate: 'list', limit: 20 },
    );
  const packet = { observedAt: 118, queryResults: [shots, passes] },
    goal = shots.rows.find((row) => row.time === 116),
    saved = shots.rows.find((row) => row.time === 96),
    pass = passes.rows.find((row) => row.time === 110);
  const ref = (row) => ({ type: 'event', id: row.id, revision: row.revision });
  const issues = (text, evidence, source = packet, kind = 'interpretation', scope = 'match') =>
    unsupportedGoalEndpointClaims({ scope, claims: [{ text, kind, evidence }] }, source);
  for (const text of [
    'A. Reed scored at 01:56.',
    'A. Reed marcó a las 01:56.',
    'A. Reed a marqué à 01:56.',
    'A. Reed marcou aos 01:56.',
  ]) {
    assert.equal(issues(text, [ref(pass)]).length, 1);
    assert.deepEqual(issues(text, [ref(goal)]), []);
    assert.equal(issues(text, [ref(saved)]).length, 1);
    assert.equal(issues(text, [{ ...ref(goal), revision: goal.revision - 1 }]).length, 1);
  }
  assert.equal(issues('A. Reed scored at 01:54.', [ref(goal)]).length, 1);
  const pending = executeMatchQuery(
      { ...input, time: 116 },
      { filters: { type: 'shot' }, aggregate: 'list', limit: 20 },
    ),
    unsettled = pending.rows.find((row) => row.time === 116);
  assert.equal(
    issues('A. Reed scored at 01:56.', [ref(unsettled)], {
      observedAt: 116,
      queryResults: [pending],
    }).length,
    1,
  );
  for (const text of [
    'Nobody has scored yet.',
    'Reed has not scored.',
    'Reed could have scored.',
    'It is unclear whether Reed scored.',
    'Reed não marcou.',
  ])
    assert.deepEqual(issues(text, []), []);
  assert.deepEqual(
    issues(
      'A goal is scored when the whole ball crosses the line.',
      [],
      packet,
      'general',
      'general',
    ),
    [],
  );
});

test('a buildup cannot add an uncited goal endpoint to correctly cited precursor actions', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question:
      'Trace the move that produced the goal, starting with the recovery immediately before the final pass.',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-sequence',
      explanationTarget: 'observed-sequence',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'recovery', recoveryClass: 'ball-win' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
        ],
      },
    },
    (packet) => {
      const recovery = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'ballWins',
        ),
        pass = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'pass' &&
            f.selection.time === 110 &&
            !f.selection.attributes,
        ),
        receive = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'receive' &&
            f.selection.time === 114,
        );
      assert.ok(recovery && pass && receive);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [recovery.id, pass.id, receive.id],
          claim: {
            text: 'The move started with Cole winning the ball. He passed to Reed, who received it and scored at 01:56.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1, 2],
          },
        },
        followUp: '',
      };
    },
    (packet, body) => {
      assert.ok(packet.feedback.issues.some((issue) => issue.attribute === 'goal-endpoint'));
      const story = packet.evidence.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-goal-sequence',
      );
      assert.ok(story);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.equal(modes.length, 1);
      assert.deepEqual(modes[0].properties.mode.enum, ['facts']);
      assert.deepEqual(modes[0].properties.factIds.items.enum, [story.id]);
      assert.equal(
        packet.evidence.matchFacts.facts.length,
        1,
        'writer projection retains only the reachable complete story',
      );
      const sources = ['shot', 'pass', 'receive', 'recovery'].map((type) =>
          executeMatchQuery(
            { kind: input.kind, seed: input.seed, time: input.time },
            { filters: { type }, aggregate: 'list', limit: 20 },
          ),
        ),
        sourcePacket = { ...packet.evidence, queryResults: sources, requestedEvidence: sources };
      const manifest = buildQuestionFacts(sourcePacket),
        chosen = [
          ['recovery', 108],
          ['pass', 110],
          ['receive', 114],
        ].map(([type, time]) =>
          manifest.facts.find(
            (f) =>
              f.proof.kind === 'event' &&
              f.proof.eventType === type &&
              f.proof.time === time &&
              !f.proof.attributes,
          ),
        );
      assert.ok(chosen.every(Boolean));
      const rejected = { composition: { mode: 'explanation', factIds: chosen.map((f) => f.id) } };
      const ids = goalEndpointRepairFacts(manifest, rejected, sourcePacket, [
        { attribute: 'goal-endpoint', time: 116 },
      ]);
      assert.equal(ids.length, 1);
      assert.deepEqual(
        goalEndpointRepairFacts(manifest, rejected, sourcePacket, [
          { attribute: 'goal-endpoint', time: 114 },
        ]),
        [],
      );
      const complete = manifest.facts.find((f) => f.id === ids[0]);
      assert.deepEqual(
        goalEndpointRepairFacts(
          { ...manifest, facts: manifest.facts.filter((f) => f.id !== complete.id) },
          rejected,
          sourcePacket,
          [{ attribute: 'goal-endpoint' }],
        ),
        [],
      );
      assert.deepEqual(
        goalEndpointRepairFacts(
          { ...manifest, facts: [...manifest.facts, { ...complete, id: 'ambiguous-story' }] },
          rejected,
          sourcePacket,
          [{ attribute: 'goal-endpoint' }],
        ),
        [],
      );
      const unrelated = manifest.facts.find(
        (f) =>
          f.proof.kind === 'event' &&
          f.proof.eventType === 'pass' &&
          f.proof.time === 102 &&
          !f.proof.attributes,
      );
      assert.ok(unrelated);
      assert.deepEqual(
        goalEndpointRepairFacts(
          manifest,
          { composition: { factIds: [chosen[0].id, unrelated.id] } },
          sourcePacket,
          [{ attribute: 'goal-endpoint' }],
        ),
        [],
      );
      return { scope: 'match', composition: { mode: 'facts', factIds: [story.id] }, followUp: '' };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'The complete linked narrative includes the recovery before the final pass.',
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'explanation',
          requestedAction: 'recovery',
          temporalRelation: 'before-requested-event',
          relationAnchorClaimIndex: 0,
          relationEntityBinding: 'same-team',
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.claims.length, 1);
  assert.equal(answer.canonicalFactSelection.proofs[0].kind, 'linked-goal-sequence');
  assert.ok(
    answer.claims[0].evidence.some(
      (ref) => ref.id === 'comparison-sustained-17-shot-116' && ref.revision === 2,
    ),
  );
  const state = matchState(input),
    selection = answer.canonicalFactSelection,
    part = {
      claimIndices: [0],
      answerForm: 'explanation',
      requestedAction: 'recovery',
      temporalRelation: 'before-requested-event',
      relationAnchorClaimIndex: 0,
      relationEntityBinding: 'same-team',
    };
  const checks = [
    {
      cited: answer.claims[0].evidence.map((reference) => ({
        reference,
        record: state.events.find(
          (row) => row.id === reference.id && row.revision === reference.revision,
        ),
      })),
    },
  ];
  assert.equal(canonicalGoalSequenceWitness(part, answer, checks, selection, 118), true);
  for (const mutate of [
    (value) => {
      value.proofs[0].links[0].revision--;
    },
    (value) => {
      value.proofs[0].links.pop();
    },
    (value) => {
      value.proofs[0].links.reverse();
    },
    (value) => {
      value.proofs[0].links[1].cause = 'unrelated';
    },
  ]) {
    const changed = structuredClone(selection);
    mutate(changed);
    assert.equal(canonicalGoalSequenceWitness(part, answer, checks, changed, 118), false);
  }
  for (const mutate of [
    (value) => {
      value[0].cited.find((x) => x.record.type === 'pass').record.time = 118;
    },
    (value) => {
      value[0].cited.find((x) => x.record.type === 'pass').record.receiverId = 'away-10';
    },
    (value) => {
      value[0].cited.find((x) => x.record.type === 'recovery').record.team = 'away';
    },
  ]) {
    const changed = structuredClone(checks);
    mutate(changed);
    assert.equal(canonicalGoalSequenceWitness(part, answer, changed, selection, 118), false);
  }
  assert.equal(
    canonicalGoalSequenceWitness(
      { ...part, requestedAction: 'assist' },
      answer,
      checks,
      selection,
      118,
    ),
    false,
  );
  assert.equal(
    canonicalGoalSequenceWitness(
      { ...part, temporalRelation: 'after-requested-event' },
      answer,
      checks,
      selection,
      118,
    ),
    false,
  );
});

test('a canonical zero-goal and credited role pair corrects the premise without invented numerical prose', async () => {
  for (const requestedForm of ['fact', 'explanation']) {
    const input = {
      kind: 'sustained',
      seed: 17,
      time: 118,
      question: "Cole finished the scoring move himself, didn't he, or was his role different?",
    };
    let captured;
    const mock = sequenceTransport([
      {
        answerFocus: 'event-actor',
        explanationTarget: 'observed-sequence',
        requestedForm,
        mentionedPlayers: ['J. Cole'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'shot', player: 'home-7', outcome: 'goal' },
              aggregate: 'list',
              order: 'desc',
              limit: 1,
            },
          ],
        },
      },
      (packet) => {
        const zero = packet.matchFacts.facts.find(
            (f) =>
              f.selection.kind === 'count' &&
              f.selection.metric === 'goals' &&
              f.selection.subjectId === 'home-7',
          ),
          assist = packet.matchFacts.facts.find((f) => f.selection.kind === 'credited-goal-assist');
        assert.ok(zero && assist);
        return {
          premiseCheck: {
            questionAssumption: 'Cole scored',
            recordedAction: 'Cole has zero goals and assisted Reed',
            conclusion: 'contradicted',
          },
          scope: 'match',
          composition: { mode: 'facts', factIds: [zero.id, assist.id] },
          followUp: '',
        };
      },
      (packet) => {
        captured = packet;
        return {
          decision: 'approve',
          requestCheck: {
            status: 'answered',
            requestedInformation: input.question,
            responseIntent: {
              purpose: 'premise-correction',
              needsAssessment: false,
              needsExplicitCorrection: true,
              needsMeasurementLimitation: false,
              reason: 'The zero goal and explicit credited role answer the two components.',
            },
            reason: 'Source-established roles.',
            coverage: packet.requestComponents.map((requestSpan) => ({
              requestSpan,
              claimIndices: [0, 1],
              answerForm: 'premise-correction',
              requestedAction: 'other',
            })),
          },
        };
      },
    ]);
    const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.equal(answer.execution.modelCalls, 3);
    assert.equal(answer.execution.repairs, 0);
    assert.match(answer.answer, /0 confirmed goals/);
    assert.match(answer.answer, /Cole.*assist.*Reed/);
    assert.equal(
      canonicalAttributedRoleCorrection(
        captured.canonicalFactSelection,
        captured.answer,
        captured.evidence,
      ),
      true,
    );
    for (const mutate of [
      (value) => {
        value.proofs[1].revision--;
      },
      (value) => {
        value.proofs[1].assisterId = 'away-7';
      },
      (value) => {
        value.proofs[1].scorerId = 'away-10';
      },
      (value) => {
        value.proofs[0].subjectId = 'away-7';
      },
    ]) {
      const changed = structuredClone(captured.canonicalFactSelection);
      mutate(changed);
      assert.equal(
        canonicalAttributedRoleCorrection(changed, captured.answer, captured.evidence),
        false,
      );
    }
    const noAssist = JSON.parse(
      JSON.stringify(captured.evidence, (key, value) => (key === 'assist' ? null : value)),
    );
    assert.equal(
      canonicalAttributedRoleCorrection(captured.canonicalFactSelection, captured.answer, noAssist),
      false,
    );
  }
});

test('multipart tag-question corrections preserve the premise and require the requested positive player role', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: "Cole finished the scoring move himself, didn't he, or was his role different?",
  };
  assert.deepEqual(requestComponents(input.question), [
    "Cole finished the scoring move himself, didn't he",
    'was his role different',
  ]);
  const premiseCheck = {
    questionAssumption: 'Cole scored',
    recordedAction: 'Reed scored, with Cole credited as assister',
    conclusion: 'contradicted',
  };
  let zero;
  const mock = sequenceTransport([
    {
      answerFocus: 'event-sequence',
      explanationTarget: 'observed-sequence',
      requestedForm: 'explanation',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot', player: 'home-7' }, aggregate: 'count' },
          { filters: { type: 'shot', result: true }, aggregate: 'list', order: 'desc', limit: 1 },
        ],
      },
    },
    (packet) => {
      zero = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'attempts' &&
          f.selection.subjectId === 'home-7',
      );
      assert.ok(zero);
      return {
        premiseCheck,
        scope: 'match',
        composition: { mode: 'no-action-correction', factIds: [zero.id] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Deliberately mistaken approval of negation alone.',
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
          answerForm: 'premise-correction',
          requestedAction: 'other',
        })),
      },
    }),
    (packet, body) => {
      assert.ok(packet.feedback.requestAdequacy.some((issue) => /player role/.test(issue.reason)));
      assert.ok(
        resolvedWireSchema(body).properties.composition.anyOf.some((mode) =>
          mode.properties.mode.enum.includes('explanation'),
        ),
        'multipart repair must not be forced to zero-action-only mode',
      );
      const facts = packet.evidence.matchFacts.facts,
        assist = facts.find((f) => f.selection.kind === 'credited-goal-assist'),
        goal = facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'shot' &&
            f.selection.time === 116 &&
            !f.selection.attributes,
        );
      assert.ok(assist && goal);
      return {
        premiseCheck,
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [zero.id, assist.id, goal.id],
          claim: {
            text: 'Cole did not score; Reed scored at 01:56, with Cole credited for the assist.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1, 2],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Corrected scorer and explicit credited role are both supplied.',
        coverage: packet.requestComponents.map((requestSpan, index) => ({
          requestSpan,
          claimIndices: index ? [1, 3] : [0, 2, 3],
          answerForm: index ? 'fact' : 'premise-correction',
          requestedAction: 'other',
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 5);
  assert.match(answer.answer, /Reed.*scor/);
  assert.match(answer.answer, /Cole.*assist/);
  assert.equal(requestComponents('Cole did not shoot, did he?').length, 1);
});

test('a numeric explanation without its count scope repairs without repeating action quantities', async () => {
  const question = {
    kind: 'sustained',
    seed: 1042,
    time: 98,
    question: 'Why did he shoot instead of slipping it to a teammate?',
  };
  let shot;
  const mock = sequenceTransport([
    {
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet) => {
      shot = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [shot.id],
          claim: {
            text: 'Reed took three shots, showing his role as the shooter.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (_packet, body) => {
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.ok(
        modes
          .filter((mode) => mode.properties.claim)
          .every((mode) =>
            (mode.properties.claim.anyOf || [mode.properties.claim]).every((claim) =>
              /Do not repeat them/.test(claim.properties.text.description),
            ),
          ),
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [shot.id],
          claim: {
            text: 'His passing options and reasoning are not recorded, so I cannot tell why he shot instead of passing.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    { decision: 'approve', reason: 'Actual action and unavailable reason are distinguished.' },
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.doesNotMatch(result.answer, /three shots/);
  assert.match(result.answer, /cannot tell why/);
});

test('unsupported shot motives repair to the actual action and a specific unknown reason', async () => {
  const question = {
    kind: 'sustained',
    seed: 1042,
    time: 98,
    question: 'Why did he shoot instead of slipping it to a teammate?',
  };
  let shot;
  const mock = sequenceTransport([
    {
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet) => {
      shot = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
      );
      assert.ok(shot);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [shot.id],
          claim: {
            text: 'He chose to shoot because he is the primary shooter.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (_packet, body) => {
      const schema = resolvedWireSchema(body);
      assert.ok(
        schema.properties.composition.anyOf
          .filter((mode) => mode.properties.claim)
          .every(
            (mode) =>
              mode.properties.claim.properties.kind.enum.length === 1 &&
              mode.properties.claim.properties.kind.enum[0] === 'limitation',
          ),
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [shot.id],
          claim: {
            text: 'A. Reed took a shot at 01:36 which was saved. I can tell you what happened, but not why he shot instead of passing: his passing options and reasoning are not recorded.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason:
        'The actual shot and specific unavailable reason answer the request without invented motives.',
    },
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.ok(result.claims.some((claim) => claim.text === shot.claim.text));
  assert.match(result.answer, /not why he shot/);
  assert.doesNotMatch(result.answer, /chose|primary shooter/);
  assert.equal(result.proseNormalizations[0].removedTextVerified, false);
});
const input = {
  kind: 'sustained',
  seed: 17,
  time: 96,
  question: 'How did he miss that?',
  anchorId: 'comparison-sustained-17-shot-96',
};
const config = { url: 'https://example.invalid/completions', deployment: 'test', key: 'test-only' };

test('a same-team predecessor follow-up cannot release the planner latest-event shortcut', async () => {
  const input = {
    kind: 'duel',
    seed: 1001,
    time: 120,
    language: 'fr',
    question: 'Et le tir précédent de cette même équipe, à quel moment ?',
    conversation: [
      {
        question: 'À quel moment l’équipe à domicile a-t-elle tenté son tir le plus récent ?',
        answer: 'Je regarde les tirs.',
        time: 120,
      },
    ],
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      requestedForm: 'fact',
      explanationTarget: 'none',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot', team: 'home' }, aggregate: 'list', order: 'desc', limit: 1 },
        ],
      },
    },
    (packet) => {
      assert.match(packet.answer.claims[0].text, /00:22/);
      assert.ok(
        packet.answer.claims[0].evidence.some((ref) => ref.id === 'comparison-duel-1001-shot-22'),
      );
      return {
        decision: 'approve',
        reason: 'The exact earlier event answers the time request.',
        requestCheck: {
          status: 'answered',
          reason: 'The requested earlier action time is present.',
          requestedInformation: input.question,
          responseIntent: {
            purpose: 'fact-retrieval',
            reason: 'A time lookup.',
            needsAssessment: false,
            needsExplicitCorrection: false,
            needsScoreline: false,
            needsMeasurementLimitation: false,
          },
          coverage: [
            {
              requestSpan: requestComponents(input.question)[0],
              claimIndices: [0],
              answerForm: 'fact',
              requestedAction: 'shot',
              temporalRelation: 'before-requested-event',
              relationAnchorClaimIndex: null,
              relationSourceLinkIndex: null,
              relationEntityBinding: 'same-team',
              requestedQuantity: null,
              explanationTarget: 'none',
            },
          ],
        },
        checks: [
          {
            claimIndex: 0,
            supported: true,
            inventedFacts: [],
            actors: [],
            counts: [],
            reason: 'Verified predecessor event and bounded query.',
            shotOutcomeAssertions: [],
          },
        ],
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 2);
  assert.equal(answer.claims.length, 1);
  assert.match(answer.answer, /00:22/);
  assert.ok(
    answer.lookups.some((item) => item.query.timeTo === 92 && item.query.timeToExclusive === true),
  );
});

const statisticDefinitionPlan = {
  answerFocus: 'other',
  explanationTarget: 'statistic-definition',
  requestedForm: 'explanation',
  mentionedPlayers: [],
  decision: { kind: 'queries', queries: [{ filters: { type: 'shot' }, aggregate: 'count' }] },
};
function definitionReview(
  packet,
  { purpose = 'explanation', form = 'explanation', decision = 'approve' } = {},
) {
  return {
    decision,
    requestCheck: {
      status: 'answered',
      requestedInformation: packet.evidence.question,
      responseIntent: {
        purpose,
        needsAssessment: purpose === 'assessment',
        needsExplicitCorrection: false,
        needsMeasurementLimitation: form === 'unavailable-measurement',
        reason: 'Classify the whole request independently of the selected definition.',
      },
      coverage: packet.requestComponents.map((requestSpan) => ({
        requestSpan,
        claimIndices: [0],
        answerForm: form,
        requestedAction: 'shot',
        temporalRelation: 'none',
        relationAnchorClaimIndex: null,
        relationSourceLinkIndex: null,
        relationEntityBinding: 'none',
      })),
      reason: 'The source definition explains category counting and its measurement boundary.',
    },
  };
}
test('a declared statistic definition repairs an incompatible general route or answer form with constrained application evidence', async () => {
  for (const rejected of [
    { ...statisticDefinitionPlan, decision: { kind: 'general', concepts: ['goal'] } },
    { ...statisticDefinitionPlan, requestedForm: 'fact' },
  ]) {
    const mock = sequenceTransport([
      rejected,
      (packet, body) => {
        assert.equal(packet.planningCorrection.kind, 'statistic-definition-evidence-required');
        assert.equal(decisionBranch(body, 'general'), undefined);
        assert.deepEqual(resolvedWireSchema(body).properties.explanationTarget.enum, [
          'statistic-definition',
        ]);
        assert.deepEqual(resolvedWireSchema(body).properties.requestedForm.enum, ['explanation']);
        return statisticDefinitionPlan;
      },
      (packet) => definitionReview(packet),
    ]);
    const result = await answerMatchQuestionAI(
      {
        kind: 'sustained',
        seed: 17,
        time: 118,
        question: 'Are blocked attempts added to saves in these statistics?',
      },
      { config, fetcher: mock.fetcher, canRepair: () => true },
    );
    assert.equal(result.execution.modelCalls, 3);
    assert.equal(result.execution.planningRepairs, 1);
    assert.equal(result.canonicalFactSelection.proofs[0].kind, 'shot-outcome-definition');
  }
});

test('statistic-definition planning repair cannot repeat a general route or silently discard the declared intent', async () => {
  const invalid = { ...statisticDefinitionPlan, decision: { kind: 'general', concepts: ['goal'] } };
  for (const repeat of [
    invalid,
    { ...statisticDefinitionPlan, explanationTarget: 'other' },
    { ...statisticDefinitionPlan, requestedForm: 'assessment' },
  ]) {
    const mock = sequenceTransport([invalid, repeat]);
    await assert.rejects(
      answerMatchQuestionAI(
        {
          kind: 'sustained',
          seed: 17,
          time: 118,
          question: 'What is the statistical difference between blocked attempts and saves?',
        },
        { config, fetcher: mock.fetcher, canRepair: () => true },
      ),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 2);
  }
});
test('semantic statistic definitions use the queried source contract without a prose writer or replay moment', async () => {
  for (const question of [
    'Do blocked attempts count as saves, and can that category tell us the keeper’s total work?',
    'How does the blocked category differ from a saved attempt in these statistics?',
  ]) {
    const mock = sequenceTransport(
      [
        statisticDefinitionPlan,
        (packet) => {
          assert.equal(packet.canonicalFactSelection.proofs[0].kind, 'shot-outcome-definition');
          assert.equal(packet.canonicalFactSelection.proofs[0].basis, 'trusted-event-schema');
          assert.equal(packet.answer.claims.length, 1);
          assert.deepEqual(Object.keys(packet.evidence.relevanceContext).sort(), [
            'citable',
            'limitation',
          ]);
          assert.equal(packet.evidence.queryResults.length, 1);
          assert.deepEqual(
            packet.evidence.queryResults[0].scopeReference,
            packet.canonicalFactSelection.proofs[0].scope,
          );
          assert.ok(packet.evidence.queryResults[0].scope.inventoryCount > 0);
          assert.equal(packet.evidence.queryResults[0].scopeReference.revision, 1);
          assert.equal(packet.evidence.question, question);
          assert.deepEqual(packet.requestComponents, requestComponents(question));
          assert.match(packet.evidence.sourceFingerprint, /^[a-f0-9]{64}$/);
          assert.ok(
            JSON.stringify(packet.evidence.relevanceContext).length < 400,
            'Definition review has a bounded context instead of multi-kilobyte unrelated metrics.',
          );
          return definitionReview(packet);
        },
      ],
      (_packet, call, body) => {
        if (call === 0) {
          assert.ok(
            resolvedWireSchema(body).properties.explanationTarget.enum.includes(
              'statistic-definition',
            ),
          );
          assert.match(
            decisionBranch(body, 'general').properties.kind.description,
            /outcome-counting definitions require match queries/,
          );
          assert.match(body.messages[0].content, /statistic-definition never uses general/);
          assert.doesNotMatch(
            body.messages[0].content,
            /general for football concepts, definitions and rules/,
          );
        }
      },
    );
    const result = await answerMatchQuestionAI(
      { kind: 'sustained', seed: 17, time: 118, question },
      { config, fetcher: mock.fetcher },
    );
    assert.equal(result.execution.modelCalls, 2);
    assert.equal(result.execution.explanationTarget, 'statistic-definition');
    assert.match(result.answer, /blocked/i);
    assert.equal(result.claims.length, 1);
    assert.equal(result.provenance.modelGenerated, false);
    assert.deepEqual(result.moments, []);
  }
});

test('a statistic definition can explain unknown workload but cannot substitute for an actual comparison', async () => {
  for (const form of ['unavailable-measurement', 'assessment']) {
    const mock = sequenceTransport([
      statisticDefinitionPlan,
      (packet) =>
        definitionReview(packet, {
          purpose: form === 'assessment' ? 'assessment' : 'explanation',
          form,
        }),
    ]);
    const task = answerMatchQuestionAI(
      {
        kind: 'sustained',
        seed: 17,
        time: 118,
        question:
          form === 'assessment'
            ? 'Which keeper has worked harder?'
            : 'Can these outcome categories establish total physical keeper workload?',
      },
      { config, fetcher: mock.fetcher },
    );
    if (form === 'assessment')
      await assert.rejects(task, (error) => error.code === 'question-withheld');
    else assert.equal((await task).execution.modelCalls, 2);
    assert.equal(mock.count(), 2);
  }
});

test('an unrelated definition misclassified by the planner remains subject to whole-question semantic review', async () => {
  const mock = sequenceTransport([
    statisticDefinitionPlan,
    (packet) => {
      assert.equal(packet.canonicalFactSelection.proofs[0].kind, 'shot-outcome-definition');
      return {
        ...definitionReview(packet, { decision: 'withhold' }),
        reason: 'A blocked-versus-saved definition does not explain pass completion rate.',
      };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(
      { kind: 'sustained', seed: 17, time: 118, question: 'How is pass completion rate defined?' },
      { config, fetcher: mock.fetcher },
    ),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(mock.count(), 2);
});

test('a mixed blocked-count and category explanation preserves its actual total rather than selecting the pure definition', async () => {
  const question = 'How many shots were blocked, and do those count as goalkeeper saves?';
  const mock = sequenceTransport([
    {
      ...statisticDefinitionPlan,
      explanationTarget: 'other',
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', outcome: 'blocked' }, aggregate: 'count' }],
      },
    },
    (packet) => {
      assert.ok(
        packet.matchFacts.facts.some((fact) => fact.selection.kind === 'shot-outcome-definition'),
        'validated source definition is available beside counts without replacing the requested total',
      );
      const fact = packet.matchFacts.facts.find(
        (fact) => fact.selection.kind === 'count' && fact.selection.metric === 'blockedShots',
      );
      assert.ok(fact);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [fact.id],
          claim: {
            text: 'Blocked attempts are counted separately from saved shots; those categories do not establish total goalkeeper workload.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (packet) => {
      assert.ok(packet.evidence.relevanceContext.playerContributions);
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: question,
          responseIntent: {
            purpose: 'mixed',
            needsAssessment: false,
            needsExplicitCorrection: false,
            needsMeasurementLimitation: false,
            reason: 'The request needs an actual count and a counting distinction.',
          },
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0, 1],
            answerForm: 'explanation',
            requestedAction: 'shot',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationSourceLinkIndex: null,
            relationEntityBinding: 'none',
          })),
          reason: 'Complete blocked count and qualified category distinction are both present.',
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 17, time: 118, question },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 2);
  assert.equal(result.canonicalFactSelection.proofs[0].value, 2);
});

test('explicit quantity components reject definition-only approval and unrelated numbers independently of reviewer labels', () => {
  for (const requestSpan of [
    'How many shots were blocked',
    'How many passes were completed',
    'And how many recoveries followed',
    'What is the total of blocked attempts',
  ]) {
    const answer = {
      scope: 'match',
      claims: [
        {
          kind: 'observation',
          text: 'The category is separate; an action happened at 02:00.',
          evidence: [],
        },
      ],
    };
    const review = {
      checks: [{ claimIndex: 0, supported: true, counts: [], shotOutcomeAssertions: [] }],
      requestCheck: {
        coverage: [
          { requestSpan, claimIndices: [0], answerForm: 'explanation', requestedAction: 'other' },
        ],
      },
    };
    for (const proof of [
      { kind: 'shot-outcome-definition', basis: 'trusted-event-schema' },
      { kind: 'event', time: 120 },
      { kind: 'ordered-event', value: 2 },
    ]) {
      const issues = reviewRequestAdequacy(
        review,
        answer,
        { question: requestSpan },
        { canonicalFactSelection: { proofs: [proof] } },
      );
      assert.ok(
        issues.some((issue) => /explicit quantity request/.test(issue.reason)),
        requestSpan,
      );
    }
    const factualReview = structuredClone(review);
    factualReview.requestCheck.coverage[0].answerForm = 'fact';
    assert.deepEqual(
      reviewRequestAdequacy(
        factualReview,
        answer,
        { question: requestSpan },
        { canonicalFactSelection: { proofs: [{ kind: 'count', value: 2 }] } },
      ),
      [],
    );
    const unrelatedLimitation = {
      ...answer,
      claims: [
        { kind: 'limitation', text: 'Overall goalkeeper workload is not recorded.', evidence: [] },
      ],
    };
    assert.ok(
      reviewRequestAdequacy(review, unrelatedLimitation, { question: requestSpan }).some((issue) =>
        /explicit quantity request/.test(issue.reason),
      ),
    );
  }
});

test('a mixed quantity request repairs a pure-definition plan and preserves both source count and category distinction', async () => {
  const question = 'Do blocked attempts count as saves, and how many shots were blocked?';
  const countPlan = {
    ...statisticDefinitionPlan,
    explanationTarget: 'other',
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'shot', outcome: 'blocked' }, aggregate: 'count' }],
    },
  };
  const mock = sequenceTransport([
    statisticDefinitionPlan,
    (packet, body) => {
      assert.equal(packet.planningCorrection.kind, 'quantity-and-definition-coverage');
      assert.equal(decisionBranch(body, 'general'), undefined);
      assert.ok(
        !resolvedWireSchema(body).properties.explanationTarget.enum.includes(
          'statistic-definition',
        ),
      );
      return countPlan;
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (fact) => fact.selection.kind === 'count' && fact.selection.metric === 'blockedShots',
      );
      assert.ok(fact);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [fact.id],
          claim: {
            text: 'Blocked attempts are counted separately from saved shots.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question,
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
          answerForm: 'explanation',
          requestedAction: 'shot',
        })),
        reason: 'Actual complete blocked count and category distinction.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 17, time: 118, question },
    { config, fetcher: mock.fetcher, canRepair: () => true },
  );
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.planningRepairs, 1);
  assert.equal(result.canonicalFactSelection.proofs[0].value, 2);
  assert.equal(result.claims.length, 2);
});

test('definition repair remains facts-only and rejects generated prose even when a mock ignores the wire schema', async () => {
  let definitionId;
  const mock = sequenceTransport([
    statisticDefinitionPlan,
    (packet) => {
      definitionId = packet.canonicalFactSelection.selectedFactIds[0];
      return definitionReview(packet, { decision: 'withhold' });
    },
    (_packet, body) => {
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.equal(modes.length, 1);
      assert.deepEqual(modes[0].properties.mode.enum, ['facts']);
      assert.ok(modes[0].properties.factIds.items.enum.includes(definitionId));
      assert.equal(modes[0].properties.claim, undefined);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [definitionId],
          claim: {
            text: 'Blocked attempts do not represent work done by the goalkeeper.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(
      {
        kind: 'sustained',
        seed: 17,
        time: 118,
        question: 'What does blocked mean for these shot statistics?',
      },
      { config, fetcher: mock.fetcher, canRepair: () => true },
    ),
    (error) => error.code === 'question-invalid-fact-selection',
  );
  assert.equal(mock.count(), 3);
});

test('a planner-identified scoreline uses both confirmed team counts in two calls, not a combined total', async () => {
  const mock = sequenceTransport([
    {
      answerFocus: 'score',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', result: true }, aggregate: 'count' }],
      },
    },
    (packet) => {
      assert.equal(packet.answer.claims.length, 2);
      assert.equal(packet.canonicalFactSelection.proofs[0].subjectId, 'home');
      assert.equal(packet.canonicalFactSelection.proofs[1].subjectId, 'away');
      return {
        decision: 'approve',
        reason: 'Both current confirmed team counts answer the scoreline.',
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 17, time: 118, question: 'What is the score right now?' },
    { config, fetcher: mock.fetcher },
  );
  assert.match(answer.answer, /Northbridge.*1/);
  assert.match(answer.answer, /Harbour Athletic.*0/);
  assert.equal(answer.execution.modelCalls, 2);
});

test('score adequacy finds a complete current proof alongside other relevant facts without relaxing its scope', () => {
  const comparison = { kind: 'team-comparison', metric: 'goals', timeFrom: 0, timeTo: 118 };
  const home = {
      kind: 'count',
      metric: 'goals',
      subjectId: 'home',
      value: 1,
      timeFrom: 0,
      timeTo: 118,
    },
    away = { ...home, subjectId: 'away', value: 0 };
  const orderedGoal = {
    kind: 'ordered-event',
    metric: 'goals',
    event: { eventId: 'goal', time: 116 },
  };
  const issues = (proofs) =>
    reviewRequestAdequacy(
      {},
      { scope: 'match', claims: [] },
      { answerFocus: 'score', observedAt: 118 },
      { canonicalFactSelection: { proofs } },
    );
  assert.deepEqual(issues([orderedGoal, comparison]), []);
  assert.deepEqual(issues([orderedGoal, home, away]), []);
  for (const proofs of [
    [orderedGoal],
    [orderedGoal, home],
    [home, { ...away, subjectId: 'home' }],
    [orderedGoal, { ...comparison, timeFrom: 30 }],
    [orderedGoal, { ...comparison, timeTo: 116 }],
    [orderedGoal, { ...comparison, timeFromExclusive: true }],
    [orderedGoal, { ...comparison, timeToExclusive: true }],
    [orderedGoal, { ...comparison, metric: 'attempts' }],
    [home, { ...away, metric: 'attempts' }],
    [home, { ...away, timeTo: 116 }],
    [home, { ...away, timeFrom: 30 }],
    [home, { ...away, value: -1 }],
    [home, { ...away, value: 0.5 }],
    [home, { ...away, subjectId: 'other' }],
  ])
    assert.ok(
      issues(proofs).some((issue) => /current scoreline/.test(issue.reason)),
      JSON.stringify(proofs),
    );
});

test('unpronounceable fragments clarify locally without a model or arbitrary event', async () => {
  let calls = 0;
  for (const question of ['hjkll', 'bcdfg?']) {
    const answer = await answerMatchQuestionAI(
      { kind: 'sustained', seed: 17, time: 72, question },
      {
        config,
        fetcher: () => {
          calls++;
          throw Error('No call expected');
        },
      },
    );
    assert.equal(answer.scope, 'clarify');
    assert.equal(answer.execution.modelCalls, 0);
    assert.equal(answer.evidence.length, 0);
  }
  assert.equal(calls, 0);
});

test('an explicit alternative to a referenced shot requests unavailable options rather than an observed buildup', async () => {
  for (const time of [96, 98]) {
    const input = {
      kind: 'sustained',
      seed: 17,
      time,
      question: 'Could Reed have squared it instead of taking that shot?',
    };
    const mock = sequenceTransport([
      (_packet, body) => {
        assert.deepEqual(resolvedWireSchema(body).properties.explanationTarget.enum, [
          'decision-rationale',
        ]);
        return {
          answerFocus: 'event-sequence',
          explanationTarget: 'decision-rationale',
          requestedForm: 'explanation',
          mentionedPlayers: ['A. Reed'],
          decision: {
            kind: 'queries',
            queries: [
              {
                filters: { type: 'shot', player: 'home-10' },
                aggregate: 'list',
                order: 'desc',
                limit: 1,
              },
            ],
          },
        };
      },
      (packet, body) => {
        assert.deepEqual(
          resolvedWireSchema(body).properties.composition.anyOf.map(
            (mode) => mode.properties.mode.enum[0],
          ),
          ['known-limitation'],
        );
        assert.ok(
          resolvedWireSchema(body).properties.premiseCheck.properties.conclusion.enum.includes(
            'unknown',
          ),
        );
        const limitation = packet.matchFacts.facts.find(
            (f) => f.selection.kind === 'capability-limitation',
          ),
          shot = packet.matchFacts.facts.find(
            (f) =>
              f.selection.kind === 'event' &&
              f.selection.eventType === 'shot' &&
              !f.selection.attributes &&
              f.selection.time === 96,
          );
        assert.ok(limitation && shot);
        return {
          scope: 'match',
          composition: {
            mode: 'known-limitation',
            contextFactIds: [shot.id],
            limitationFactId: limitation.id,
          },
          followUp: '',
        };
      },
      {
        decision: 'approve',
        reason:
          'The actual shot and unknown passing alternatives answer the question without a motive.',
      },
    ]);
    const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.match(answer.answer, /passing options/);
    assert.equal(answer.execution.modelCalls, 3);
  }
});

test('unanchored shot outcome questions query the requested action across a later recovery and received correction', async () => {
  for (const time of [96, 98])
    for (const question of [
      'Was that last effort saved or did it miss the target?',
      'Was that attempt blocked, or kept out by the goalkeeper?',
      'Did that shot go off target?',
    ]) {
      const source = matchState({ kind: 'sustained', seed: 17, time }),
        shot = source.events.find((event) => event.id === 'comparison-sustained-17-shot-96');
      if (time === 98)
        assert.equal(
          source.events.filter((event) => event.type !== 'flight').at(-1).type,
          'recovery',
        );
      const mock = sequenceTransport([
        (packet, body) => {
          assert.equal(packet.selectedMoment, undefined);
          assert.match(
            body.messages[0].content,
            /A later reception or recovery must not replace a requested shot or pass/,
          );
          return {
            answerFocus: 'other',
            requestedForm: 'fact',
            mentionedPlayers: [],
            decision: {
              kind: 'queries',
              queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
            },
          };
        },
        (packet) => {
          assert.deepEqual(packet.requestedMoment.reference, {
            type: 'event',
            id: shot.id,
            revision: shot.revision,
          });
          const fact = packet.matchFacts.facts.find(
            (fact) =>
              fact.selection.kind === 'ordered-event' &&
              fact.selection.metric === 'attempts' &&
              fact.selection.order === 'desc',
          );
          assert.ok(fact);
          assert.ok(fact.selection.time === shot.time);
          return {
            scope: 'match',
            composition: { mode: 'facts', factIds: [fact.id] },
            followUp: '',
          };
        },
        {
          decision: 'approve',
          reason: 'The requested latest shot has its current received outcome.',
        },
      ]);
      const answer = await answerMatchQuestionAI(
        { kind: 'sustained', seed: 17, time, question },
        { config, fetcher: mock.fetcher },
      );
      assert.match(answer.answer, time === 96 ? /off target/ : /saved/);
      assert.match(answer.answer, /Reed/);
      assert.doesNotMatch(answer.answer, /Carter/);
      assert.ok(
        answer.evidence.some((ref) => ref.id === shot.id && ref.revision === shot.revision),
      );
      assert.equal(answer.execution.modelCalls, 3);
    }
});

test('known-limitation context rejects an older action or attribute despite a correct current action lookup', async () => {
  for (const attribute of [false, true]) {
    const input = {
      kind: 'sustained',
      seed: 17,
      time: 98,
      question: 'Could Reed have squared it instead of taking that shot?',
    };
    const mock = sequenceTransport([
      {
        answerFocus: 'event-sequence',
        explanationTarget: 'decision-rationale',
        requestedForm: 'explanation',
        mentionedPlayers: ['A. Reed'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'shot', player: 'home-10' },
              aggregate: 'list',
              order: 'desc',
              limit: 1,
            },
          ],
        },
      },
      (packet, body) => {
        assert.deepEqual(packet.requestedMoment.reference, {
          type: 'event',
          id: 'comparison-sustained-17-shot-96',
          revision: 2,
        });
        const source = executeMatchQuery(
          { kind: input.kind, seed: input.seed, time: input.time },
          { filters: { type: 'shot' }, aggregate: 'list', limit: 20 },
        );
        const old = buildQuestionFacts({
          ...packet,
          queryResults: [source],
          requestedEvidence: [source],
        }).facts.find(
          (fact) =>
            fact.proof.kind === 'event' &&
            fact.proof.eventType === 'shot' &&
            fact.proof.time === 74 &&
            !!fact.proof.attributes === attribute,
        );
        assert.ok(old);
        assert.ok(
          !packet.matchFacts.facts.some((fact) => fact.id === old.id),
          'the old action is absent from the wire catalog, but an invented selection is still independently rejected',
        );
        const mode = resolvedWireSchema(body).properties.composition.anyOf.find((mode) =>
          mode.properties.mode.enum.includes('known-limitation'),
        );
        assert.ok(!mode.properties.contextFactIds.items.enum.includes(old.id));
        const limitation = packet.matchFacts.facts.find(
          (fact) => fact.selection.kind === 'capability-limitation',
        );
        return {
          scope: 'match',
          composition: {
            mode: 'known-limitation',
            contextFactIds: [old.id],
            limitationFactId: limitation.id,
          },
          followUp: '',
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-fact-selection',
    );
    assert.equal(mock.count(), 2);
  }
});

test('keeper writer can answer both measured components with canonical facts and no repeated prose', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: 'Which end has needed the goalkeeper more, and are blocks being counted as saves?',
  };
  let selected;
  const mock = sequenceTransport([
    (_packet, body) => {
      assert.match(body.messages[0].content, /a shared football word is not relevance/);
      assert.match(
        _packet.actionOntology.shot,
        /blocked outcome does not add to the saved-shot count/,
      );
      assert.match(
        _packet.actionOntology.shot,
        /neither blocker identity, ball path relative to the goalkeeper, nor physical keeper workload/,
      );
      assert.match(
        body.messages[0].content,
        /how the displayed match attempts are classified or counted.*require decision kind queries/,
      );
      assert.match(
        body.messages[0].content,
        /goal rule explains scoring conditions, not the statistical distinction/,
      );
      return {
        answerFocus: 'player-performance',
        explanationTarget: 'other',
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }],
        },
      };
    },
    (packet, body) => {
      assert.match(
        body.messages[0].content,
        /If those selected facts answer every requested component, choose facts mode/,
      );
      assert.match(
        body.messages[0].content,
        /Do not add an explanation claim paraphrasing either conclusion/,
      );
      selected = [
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'team-comparison' &&
            f.selection.metric === 'shotsOnTargetFaced' &&
            f.selection.timeFrom === 0,
        ),
        packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'shot-outcome-profile' && f.selection.subjectId === 'home',
        ),
      ];
      assert.ok(selected.every(Boolean));
      const factsMode = resolvedWireSchema(body).properties.composition.anyOf.find(
        (mode) =>
          mode.properties.mode.enum.includes('facts') &&
          selected.every((fact) => mode.properties.factIds.items.enum.includes(fact.id)),
      );
      assert.ok(factsMode);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: selected.map((fact) => fact.id) },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'The measured comparison and outcome distinction answer both components.',
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.execution.repairs, 0);
  assert.deepEqual(
    answer.claims.map((claim) => claim.text),
    selected.map((fact) => fact.claim.text),
  );
  assert.ok(answer.claims.every((claim) => claim.evidence.length > 0));
  assert.equal(answer.claims.filter((claim) => claim.kind === 'interpretation').length, 0);
});

test('match-bound general planning is repaired once before keeper evidence selection and cannot loop', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question:
      'Are those blocked attempts work for the keeper, or are you counting something different?',
  };
  const invalid = {
    answerFocus: 'player-performance',
    requestedForm: 'explanation',
    mentionedPlayers: [],
    decision: { kind: 'general', concepts: ['goal'] },
  };
  const mock = sequenceTransport([
    invalid,
    (packet) => {
      assert.match(
        packet.planningError,
        /match answerFocus.*conflicts with the general rules route/,
      );
      assert.deepEqual(packet.rejectedPlan, invalid);
      return {
        answerFocus: 'player-performance',
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }],
        },
      };
    },
    (packet) => {
      assert.equal(packet.footballKnowledge, undefined);
      const profile = packet.matchFacts.facts.find(
        (fact) =>
          fact.selection.kind === 'shot-outcome-profile' && fact.selection.subjectId === 'home',
      );
      assert.ok(profile);
      const facing = packet.matchFacts.facts.find(
        (fact) =>
          fact.selection.kind === 'team-comparison' &&
          fact.selection.metric === 'shotsOnTargetFaced' &&
          fact.selection.timeFrom === 0,
      );
      assert.ok(facing);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [facing.id, profile.id] },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'The outcome profile distinguishes blocked attempts from saves.',
    },
  ]);
  const answer = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.execution.repairs, 1);
  assert.deepEqual(
    answer.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'planning-repair', 'answer-after-query', 'review'],
  );
  assert.match(answer.answer, /Blocked attempts are counted separately from saves/);
  for (const answerFocus of [
    'score',
    'event-actor',
    'credited-assist',
    'player-assessment',
    'player-performance',
    'team-attacking-assessment',
    'team-assessment',
    'event-sequence',
  ]) {
    const rejected = { ...invalid, answerFocus },
      repeat = sequenceTransport([rejected, rejected]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: repeat.fetcher, canRepair: () => true }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(repeat.count(), 2);
  }
});

test('irrelevant rule selection replans once into match evidence in five calls without an answer repair', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question:
      'Are those blocked attempts work for the keeper, or are you counting something different?',
  };
  const wrong = {
      answerFocus: 'other',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: { kind: 'general', concepts: ['goal'] },
    },
    mismatch = { routeMismatch: true, matchEvidenceRequired: true, factIds: [] };
  const reservations = [];
  const mock = sequenceTransport([
    wrong,
    (packet, body) => {
      assert.equal(body.response_format.json_schema.name, 'rule_fact_selection');
      assert.ok(packet.footballKnowledge.concepts.some((concept) => concept.id === 'goal'));
      return mismatch;
    },
    (packet, body) => {
      assert.match(packet.planningError, /general-rule concepts cannot answer/);
      assert.equal(decisionBranch(body, 'general'), undefined);
      assert.ok(decisionBranch(body, 'queries'));
      assert.equal(packet.planningCorrection.kind, 'match-evidence-required');
      return {
        answerFocus: 'player-performance',
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }],
        },
      };
    },
    (packet) => {
      assert.equal(packet.footballKnowledge, undefined);
      const fact = packet.matchFacts.facts.find(
        (fact) =>
          fact.selection.kind === 'shot-outcome-profile' && fact.selection.subjectId === 'home',
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [fact.id],
          claim: {
            text: 'The outcome counts do not establish the keeper’s physical workload.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      reason: 'Recorded buckets and a supported limitation answer the request.',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Separate recorded categories from unmeasured physical workload.',
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
        })),
      },
      checks: packet.answer.claims.map((claim, claimIndex) => ({
        claimIndex,
        actors: [],
        inventedFacts: [],
        counts: [],
        shotOutcomeAssertions: claim.kind === 'observation' ? ['bucket-count'] : [],
        supported: true,
        reason: 'Outcome categories and unknown physical workload are distinct.',
      })),
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: (required) => {
      reservations.push(required);
      return true;
    },
  });
  assert.equal(answer.execution.modelCalls, 5);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.deepEqual(reservations, [3]);
  assert.deepEqual(
    answer.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'select-rule-facts', 'planning-repair', 'answer-after-query', 'review'],
  );
  assert.match(answer.answer, /Blocked attempts are counted separately from saves/);
  assert.match(answer.answer, /do not establish/);
  assert.equal(answer.knowledgeReference, undefined);
  const repeated = sequenceTransport([wrong, mismatch, wrong, mismatch]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: repeated.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(repeated.count(), 3);
  const noBudget = sequenceTransport([wrong, mismatch]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: noBudget.fetcher, canRepair: () => false }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(noBudget.count(), 2);
  const disconnected = sequenceTransport([
    wrong,
    () => {
      throw new Error('Simulated disconnected rule selection.');
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, {
      config,
      fetcher: disconnected.fetcher,
      canRepair: () => {
        assert.fail('A transport failure must not reserve a planning retry.');
      },
    }),
    (error) => error.code === 'azure-network',
  );
  assert.equal(disconnected.count(), 2);
});

test('rule mismatch without a match-evidence requirement can repair to another general concept', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: 'Is an offside position alone an offence?',
  };
  const wrong = {
      answerFocus: 'other',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: { kind: 'general', concepts: ['goal'] },
    },
    mismatch = { routeMismatch: true, matchEvidenceRequired: false, factIds: [] };
  const mock = sequenceTransport([
    wrong,
    mismatch,
    (packet, body) => {
      assert.ok(decisionBranch(body, 'general'));
      assert.equal(packet.planningCorrection, undefined);
      return { ...wrong, decision: { kind: 'general', concepts: ['offside'] } };
    },
    { routeMismatch: false, matchEvidenceRequired: false, factIds: ['offside.involvement'] },
    {
      decision: 'approve',
      reason: 'The selected involvement rule answers the actual general question.',
    },
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 5);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.equal(answer.scope, 'general');
  assert.deepEqual(answer.knowledgeReference.conceptIds, ['offside']);
  assert.deepEqual(answer.evidence, []);
  const repeated = sequenceTransport([wrong, mismatch, wrong, mismatch]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: repeated.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(repeated.count(), 4);
  const inconsistent = sequenceTransport([
    wrong,
    {
      routeMismatch: false,
      matchEvidenceRequired: true,
      factIds: [retrieveFootballKnowledge(['goal']).concepts[0].facts[0].id],
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: inconsistent.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-invalid-rule-selection',
  );
  assert.equal(inconsistent.count(), 2);
});

test('approved shot-outcome inferences cannot establish physical workload, blocker identity or a pre-keeper path', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question:
      'Are those blocked attempts work for the keeper, or are you counting something different?',
  };
  const cases = [
    ['physical-keeper-workload', 'The keeper expended no energy on those blocked attempts.'],
    ['blocker-identity', 'The blocker of those efforts was a defender.'],
    ['pre-keeper-path', 'The ball never got as far as the keeper in those blocked attempts.'],
  ];
  for (const [attribute, text] of cases) {
    const mock = sequenceTransport([
      {
        answerFocus: 'player-performance',
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }],
        },
      },
      (packet) => {
        const fact = packet.matchFacts.facts.find(
          (fact) =>
            fact.selection.kind === 'shot-outcome-profile' && fact.selection.subjectId === 'home',
        );
        return {
          scope: 'match',
          composition: {
            mode: 'explanation',
            factIds: [fact.id],
            claim: { text, kind: 'interpretation', evidence: [], dependsOn: [0] },
          },
          followUp: '',
        };
      },
      (packet, body) => {
        assert.match(body.messages[0].content, /not physical mechanisms/);
        const checks = resolvedWireSchema(body).properties.checks.items.anyOf;
        assert.ok(checks.every((check) => check.required.includes('shotOutcomeAssertions')));
        return {
          decision: 'approve',
          checks: packet.answer.claims.map((claim, claimIndex) => ({
            claimIndex,
            actors: [],
            inventedFacts: [],
            counts: [],
            shotOutcomeAssertions: [claim.kind === 'interpretation' ? attribute : 'bucket-count'],
            supported: true,
            reason: 'Simulated approval despite an extracted unrecorded inference.',
          })),
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
      (error) =>
        error.code === 'question-withheld' &&
        error.feedback.requestAdequacy.some((issue) => issue.attribute === attribute),
    );
    assert.equal(mock.count(), 3);
  }
  const answer = { scope: 'match', claims: [] },
    packet = {};
  for (const shotOutcomeAssertions of [['bucket-count'], ['measured-shots-faced'], []])
    assert.deepEqual(
      reviewRequestAdequacy({ checks: [{ claimIndex: 0, shotOutcomeAssertions }] }, answer, packet),
      [],
    );
  assert.ok(reviewRequestAdequacy({ checks: [{ claimIndex: 0 }] }, answer, packet).length);
});

test('the saved unsupported keeper-work clause repairs before review and cannot exceed the shared call budget', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question:
      'Are those blocked attempts work for the keeper, or are you counting something different?',
  };
  const planner = {
    answerFocus: 'player-performance',
    requestedForm: 'explanation',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }],
    },
  };
  const failed =
    'Blocked shot attempts are counted separately from saved shots and do not represent work done by the goalkeeper.';
  const candidate = (packet) => {
    const fact = packet.matchFacts.facts.find(
      (fact) =>
        fact.selection.kind === 'shot-outcome-profile' && fact.selection.subjectId === 'home',
    );
    return {
      scope: 'match',
      composition: {
        mode: 'explanation',
        factIds: [fact.id],
        claim: { text: failed, kind: 'interpretation', evidence: [], dependsOn: [0] },
      },
      followUp: '',
    };
  };
  const repair = (packet) => {
    assert.equal(packet.feedback.issues[0].attribute, 'physical-keeper-workload');
    assert.equal(packet.feedback.issues[0].assertion, failed);
    const fact = packet.evidence.matchFacts.facts.find(
      (fact) =>
        fact.selection.kind === 'shot-outcome-profile' && fact.selection.subjectId === 'home',
    );
    return {
      scope: 'match',
      composition: {
        mode: 'explanation',
        factIds: [fact.id],
        claim: {
          text: 'The outcome counts do not measure physical keeper workload.',
          kind: 'limitation',
          evidence: [],
          dependsOn: [],
        },
      },
      followUp: '',
    };
  };
  const approval = {
    decision: 'approve',
    reason: 'The recorded outcome partition and its physical-workload limit are supported.',
  };
  const mock = sequenceTransport([planner, candidate, repair, approval]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.execution.repairs, 1);
  assert.match(answer.answer, /counted separately from saves/);
  assert.doesNotMatch(answer.answer, /work done/);
  const wrong = {
    answerFocus: 'other',
    requestedForm: 'explanation',
    mentionedPlayers: [],
    decision: { kind: 'general', concepts: ['goal'] },
  };
  const prefix = [
      wrong,
      { routeMismatch: true, matchEvidenceRequired: true, factIds: [] },
      planner,
      candidate,
    ],
    budgetChecks = [];
  const recovered = sequenceTransport([...prefix, repair, approval]);
  const repaired = await answerMatchQuestionAI(input, {
    config,
    fetcher: recovered.fetcher,
    canRepair: (required) => {
      budgetChecks.push(required);
      return true;
    },
  });
  assert.equal(repaired.execution.modelCalls, 6);
  assert.equal(repaired.execution.planningRepairs, 1);
  assert.equal(repaired.execution.repairs, 2);
  assert.deepEqual(budgetChecks, [3, 2]);
  assert.deepEqual(
    repaired.execution.stages.map((stage) => stage.stage),
    [
      'answer-or-query',
      'select-rule-facts',
      'planning-repair',
      'answer-after-query',
      'repair',
      'review',
    ],
  );
  assert.doesNotMatch(repaired.answer, /work done/);
  assert.match(repaired.answer, /do not measure/);
  const comparisonMock = sequenceTransport([...prefix, repair, approval]);
  const comparison = await compareWatchWorkflow(input, {
    config,
    fetcher: async (url, options) =>
      new Response(JSON.stringify(await (await comparisonMock.fetcher(url, options)).json())),
    canRepair: () => true,
  });
  assert.equal(comparison.full.status, 'generated');
  assert.equal(comparison.full.measurements.modelCalls, maximumQuestionModelCalls);
  assert.equal(comparisonMock.count(), 6);
  assert.equal(comparison.baseline.measurements.modelCalls, 5);
  assert.equal(comparison.delta.modelCalls, 1);
  assert.equal(comparison.delta.answerChanged, false);
  assert.equal(comparison.baseline.answer, repaired.answer);
  assert.doesNotMatch(comparison.baseline.answer, /work done/);
  const denied = sequenceTransport(prefix);
  await assert.rejects(
    answerMatchQuestionAI(input, {
      config,
      fetcher: denied.fetcher,
      canRepair: (required) => required === 3,
    }),
    (error) =>
      error.code === 'question-withheld' &&
      error.feedback.issues.some((issue) => issue.attribute === 'physical-keeper-workload'),
  );
  assert.equal(
    denied.count(),
    4,
    'A planning repair does not authorize bypassing the later daily-budget check.',
  );
  const stillRejected = sequenceTransport([
    ...prefix,
    repair,
    { decision: 'withhold', reason: 'Simulated reviewer rejection of the single repaired answer.' },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: stillRejected.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(
    stillRejected.count(),
    6,
    'The reviewed replacement cannot start another repair or seventh call.',
  );
});

test('a saved legacy keeper comparison survives an omitted reviewer group without another model round', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: 'Which end has needed the goalkeeper more, and are blocks being counted as saves?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'player-performance',
      explanationTarget: 'other',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', limit: 20 }],
      },
    },
    (packet) => {
      const faced = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'team-comparison' &&
            f.selection.metric === 'shotsOnTargetFaced' &&
            f.selection.timeFrom === 0,
        ),
        outcomes = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'shot-outcome-profile' && f.selection.subjectId === 'home',
        );
      assert.ok(faced && outcomes);
      return {
        scope: 'match',
        selectedFactIds: [faced.id, outcomes.id],
        claims: [
          {
            text: "Harbour Athletic's goalkeeper has been needed more, facing 2 shots on target, while Northbridge's goalkeeper has faced none. Blocks are counted separately from saves.",
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        ],
        followUp: '',
      };
    },
    (packet) => {
      const scope = packet.evidence.queryResults.find(
        (q) =>
          q.query.aggregate === 'by-team' &&
          q.query.filters.outcome === 'on-target' &&
          q.query.timeFrom === 0,
      ).scopeReference;
      return {
        decision: 'approve',
        reason: 'Both requested components are supported.',
        numericBindingMode: 'assertion-index-v1',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          responseIntent: {
            purpose: 'mixed',
            needsAssessment: true,
            needsExplicitCorrection: false,
            needsMeasurementLimitation: false,
            reason: 'Compare measured facing work and explain outcome categories.',
          },
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: index ? 'explanation' : 'assessment',
            requestedAction: 'other',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            relationSourceLinkIndex: null,
          })),
          reason: 'The selected canonical text provides both requested distinctions.',
        },
        checks: packet.answer.claims.map((_claim, claimIndex) => ({
          claimIndex,
          actors: [],
          inventedFacts: [],
          counts:
            claimIndex === 2 ? [{ assertionIndex: 0, scopeReference: scope, groupKey: null }] : [],
          supported: true,
          reason: 'Source-supported.',
        })),
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.execution.repairs, 0);
  assert.equal(answer.reviewAugmentations[0].reason, 'verified-omitted-group-binding');
  assert.match(answer.answer, /Blocked attempts are counted separately/);
});

test('canonical numeric prose retains normal source review and repairs an actual keeper-side error', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: 'Have the goalkeepers been tested or have attempts gone wide?',
  };
  let faced;
  const mock = sequenceTransport([
    {
      answerFocus: 'player-performance',
      requestedForm: 'assessment',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', outcome: 'on-target' }, aggregate: 'by-team' }],
      },
    },
    (packet) => {
      faced = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'opponent-count' &&
          f.selection.subjectId === 'away' &&
          f.selection.timeFrom === 0,
      );
      assert.ok(faced);
      assert.equal(faced.selection.attackingTeam, 'home');
      assert.ok(faced.selection.doesNotProve.includes('save-credit'));
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [faced.id],
          claim: {
            text: "Northbridge's keeper has faced 2 shots on target.",
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'An incorrect initial reviewer verdict cannot bypass numeric source checks.',
    },
    (packet, body) => {
      assert.ok(packet.feedback.issues.length);
      assert.match(packet.feedback.rejectedClaims[0].text, /Northbridge/);
      const claims = resolvedWireSchema(body).properties.composition.anyOf.flatMap(
        (mode) => mode.properties.claim?.anyOf || [mode.properties.claim].filter(Boolean),
      );
      assert.ok(
        claims.every((claim) => /Do not repeat them/.test(claim.properties.text.description)),
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [faced.id],
          claim: {
            text: 'The on-target attempts have tested Harbour Athletic; this measure alone does not describe all goalkeeper work.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'The repaired qualitative conclusion preserves the defending side.',
    },
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.repairs, 1);
  assert.doesNotMatch(result.answer, /Northbridge's keeper/);
  assert.equal(result.execution.modelCalls, 5);
  assert.deepEqual(
    result.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'answer-after-query', 'review', 'repair', 'review'],
  );
});
const ref = { type: 'event', id: input.anchorId, revision: 1 };

test('player passing accuracy selects a verified confirmed-outcome profile without a repeated opinion', async () => {
  const mock = sequenceTransport([
    {
      answerFocus: 'player-performance',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass', player: 'home-7', result: true }, aggregate: 'count' },
          { filters: { type: 'pass', player: 'home-7', result: false }, aggregate: 'count' },
        ],
      },
    },

    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: packet.evidence.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsMeasurementLimitation: false,
          reason: 'The measured completion rate directly answers accuracy.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'assessment',
          requestedAction: 'pass',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationSourceLinkIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'Correct complete confirmed-outcome ratio.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 1048, time: 118, question: 'How accurate has Cole’s passing been?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(result.execution.modelCalls, 2);
  assert.equal(result.claims.length, 1);
  assert.match(result.answer, /100%.*5 of 5.*confirmed/);
});

test('false-action repair selects one zero-action proof and cannot add unasked chronology', async () => {
  let zero;
  const mock = sequenceTransport([
    {
      answerFocus: 'event-sequence',
      explanationTarget: 'decision-rationale',
      requestedForm: 'explanation',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', player: 'home-7' }, aggregate: 'count' }],
      },
    },
    (packet) => {
      zero = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'attempts' &&
          f.selection.subjectId === 'home-7',
      );
      assert.ok(zero);
      return {
        premiseCheck: {
          questionAssumption: 'Cole missed a penalty',
          recordedAction: 'Cole has no shots',
          conclusion: 'contradicted',
        },
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [zero.id],
          claim: {
            text: 'Cole has 0 shots on target, so there is no penalty miss to explain.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (_packet, body) => {
      assert.deepEqual(
        resolvedWireSchema(body).properties.composition.anyOf.map((m) => m.properties.mode.enum[0]),
        ['no-action-correction'],
      );
      return {
        premiseCheck: {
          questionAssumption: 'Cole missed a penalty',
          recordedAction: 'Cole has no shots',
          conclusion: 'contradicted',
        },
        scope: 'match',
        composition: { mode: 'no-action-correction', factIds: [zero.id] },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'Complete zero-shot scope and direct correction.',
      checks: [
        {
          claimIndex: 0,
          actors: [],
          inventedFacts: [],
          counts: [],
          supported: true,
          reason: 'Canonical zero-shot scope.',
        },
        {
          claimIndex: 1,
          actors: [{ name: 'J. Cole', action: 'shot', individualAction: true }],
          inventedFacts: [],
          counts: [],
          supported: true,
          reason:
            'Simulate the real reviewer misclassifying an application-proved negation as a positive action.',
        },
      ],
    },
  ]);
  const result = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 1048, time: 118, question: 'Why did Cole miss that penalty?' },
    { config, fetcher: mock.fetcher, canRepair: () => true },
  );
  assert.equal(result.execution.modelCalls, 4);
  assert.match(result.answer, /J\. Cole did not take that shot/);
  assert.doesNotMatch(result.answer, /last|Reed|target/);
  assert.equal(result.claimProvenance.at(-1).modelGenerated, false);
});

test('a provisional player pick is concise and must use that player’s own contribution', async () => {
  for (const wrong of [false, true]) {
    const question = {
      kind: 'counter',
      seed: 1041,
      time: 118,
      question: 'Who has been the best player so far?',
    };
    const mock = sequenceTransport([
      {
        answerFocus: 'player-assessment',
        explanationTarget: 'none',
        requestedForm: 'assessment',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'by-player' }],
        },
      },
      (packet, body) => {
        assert.deepEqual(
          [
            ...new Set(
              resolvedWireSchema(body).properties.composition.anyOf.map(
                (mode) => mode.properties.mode.enum[0],
              ),
            ),
          ],
          ['player-pick'],
        );
        const goal = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'shot' &&
            f.claim.text.includes('scores'),
        );
        return {
          scope: 'match',
          composition: {
            mode: 'player-pick',
            playerId: wrong ? 'away-10' : 'home-10',
            factIds: [goal.id],
          },
          followUp: '',
        };
      },
      { decision: 'approve', reason: 'A provisional pick with received contribution evidence.' },
    ]);
    if (wrong)
      await assert.rejects(
        answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
        (error) => error.code === 'question-invalid-fact-selection',
      );
    else {
      const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
      assert.equal(result.claims.length, 2);
      assert.equal(result.execution.modelCalls, 3);
      assert.match(result.answer, /My pick so far is A\. Reed/);
      assert.equal(result.aiSelectedJudgment.playerId, 'home-10');
      assert.equal(result.claimProvenance.at(-1).modelGenerated, false);
    }
  }
});

test('an attacking assessment uses shooting evidence rather than a reception proxy', async () => {
  for (const wrong of [false, true]) {
    const mock = sequenceTransport([
      {
        answerFocus: 'team-attacking-assessment',
        explanationTarget: 'none',
        requestedForm: 'assessment',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [
            { filters: { type: 'receive' }, aggregate: 'by-team', timeFrom: 85, timeTo: 115 },
          ],
        },
      },
      (packet, body) => {
        assert.equal(resolvedWireSchema(body).properties.composition.anyOf.length, 1);
        const source = executeMatchQuery(
          { kind: input.kind, seed: input.seed, time: input.time },
          { filters: { type: 'receive' }, aggregate: 'by-team', timeFrom: 85, timeTo: 115 },
        );
        const facts = wrong
          ? buildQuestionFacts({
              ...packet,
              queryResults: [source],
              requestedEvidence: [source],
            }).facts.filter(
              (f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'receptions',
            )
          : packet.matchFacts.facts.filter(
              (f) =>
                f.selection.kind === 'team-comparison' &&
                ['attempts', 'shotsOnTarget'].includes(f.selection.metric) &&
                f.selection.timeFrom === 85,
            );
        assert.ok(facts.length);
        return {
          scope: 'match',
          composition: { mode: 'facts', factIds: facts.map((fact) => fact.id) },
          followUp: '',
        };
      },
      { decision: 'approve', reason: 'The recent measured attacking activity is level.' },
    ]);
    const input = {
      kind: 'duel',
      seed: 1011,
      time: 115,
      question: 'Who is pushing more in the last 30 seconds?',
    };
    if (wrong)
      await assert.rejects(
        answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
        (error) => error.code === 'question-invalid-fact-selection',
      );
    else {
      const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
      assert.equal(result.execution.modelCalls, 3);
      assert.equal(result.claims.length, 2);
      assert.match(result.answer, /level/);
    }
  }
});

test('complete requested shot lists support a qualified multipart attacking comparison without invented chance quality', async () => {
  const question = {
    kind: 'interrupted',
    seed: 41,
    time: 118,
    question:
      'From 01:20 to now, which side has offered the greater shooting threat, and what backs that up?',
  };
  const plan = {
    answerFocus: 'team-attacking-assessment',
    explanationTarget: 'observed-sequence',
    requestedForm: 'assessment',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'shot' },
          aggregate: 'list',
          order: 'asc',
          limit: 1,
          timeFrom: 80,
          timeTo: 118,
        },
        {
          filters: { type: 'shot', team: 'home' },
          aggregate: 'list',
          order: 'asc',
          limit: 10,
          timeFrom: 80,
          timeTo: 118,
        },
        {
          filters: { type: 'shot', team: 'away' },
          aggregate: 'list',
          order: 'asc',
          limit: 10,
          timeFrom: 80,
          timeTo: 118,
        },
      ],
    },
  };
  for (const listLimit of [10, 1])
    for (const repair of [false, true]) {
      const selectedPlan = structuredClone(plan);
      selectedPlan.decision.queries.slice(1).forEach((query) => {
        query.limit = listLimit;
        query.timeFromExclusive = true;
        query.timeToExclusive = true;
      });
      selectedPlan.decision.queries[0].timeFromExclusive = true;
      selectedPlan.decision.queries[0].timeToExclusive = true;
      let facts;
      const safe = (packet, body) => {
        const modes = resolvedWireSchema(body).properties.composition.anyOf;
        assert.equal(modes.length, 1);
        assert.deepEqual(modes[0].properties.mode.enum, ['facts']);
        assert.equal(modes[0].properties.factIds.minItems, 2);
        facts = (packet.matchFacts || packet.evidence.matchFacts).facts.filter((f) =>
          modes[0].properties.factIds.items.enum.includes(f.id),
        );
        assert.equal(facts.length, 2);
        assert.equal(
          (packet.matchFacts || packet.evidence.matchFacts).facts.length,
          2,
          'the actual writer and repair payload only contain selectable facts',
        );
        return {
          scope: 'match',
          composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
          followUp: '',
        };
      };
      const mock = sequenceTransport([
        selectedPlan,
        ...(repair
          ? [
              (packet, body) => {
                const chosen = safe(packet, body);
                return {
                  ...chosen,
                  composition: {
                    mode: 'explanation',
                    factIds: chosen.composition.factIds,
                    claim: {
                      text: 'Kingsport United offered the greater threat because its shot was closer to scoring potential.',
                      kind: 'interpretation',
                      evidence: [],
                      dependsOn: [0, 1],
                    },
                  },
                };
              },
            ]
          : []),
        safe,
        (packet) => {
          assert.ok(packet.answer.claims.every((claim) => claim.kind === 'observation'));
          assert.ok(
            packet.canonicalFactSelection.proofs.every(
              (proof) =>
                proof.timeFrom === 80 &&
                proof.timeTo === 118 &&
                proof.timeFromExclusive &&
                proof.timeToExclusive &&
                proof.operands.every((operand) => operand.modelGenerated === false),
            ),
          );
          return {
            decision: 'approve',
            requestCheck: {
              status: 'answered',
              requestedInformation: question.question,
              responseIntent: {
                purpose: 'assessment',
                needsAssessment: true,
                needsExplicitCorrection: false,
                needsMeasurementLimitation: false,
                reason: 'Only qualified measured comparisons, not a shot-quality ranking.',
              },
              coverage: packet.requestComponents.map((requestSpan) => ({
                requestSpan,
                claimIndices: [0, 1],
                answerForm: requestSpan.startsWith('what') ? 'explanation' : 'assessment',
                requestedAction: 'shot',
              })),
              reason:
                'Both requested measures in the exact window support the qualified comparison.',
            },
          };
        },
      ]);
      const answer = await answerMatchQuestionAI(question, {
        config,
        fetcher: mock.fetcher,
        canRepair: () => repair,
      });
      const measures = answer.lookups.filter(
        (source) =>
          source.query.aggregate === 'by-team' &&
          source.query.filters.type === 'shot' &&
          source.query.timeFrom === 80 &&
          source.query.timeTo === 118,
      );
      assert.equal(measures.length, 2);
      assert.ok(
        measures.every((source) => source.query.timeFromExclusive && source.query.timeToExclusive),
      );
      assert.equal(answer.execution.modelCalls, repair ? 4 : 3);
      assert.equal(answer.execution.repairs, repair ? 1 : 0);
      assert.match(answer.answer, /Riverside City.*2/);
      assert.match(answer.answer, /Kingsport United.*1/);
      assert.match(answer.answer, /shots on target.*level/i);
      assert.doesNotMatch(answer.answer, /closer to scoring|greater threat|chance quality/i);
      assert.equal(answer.claims.length, 2);
    }
});

test('single actor, credited assist and linked sequence lookups keep independent review in two calls', async () => {
  for (const [focus, form, target, question] of [
    ['event-actor', 'fact', 'none', 'Who scored first?'],
    ['credited-assist', 'fact', 'none', 'Who supplied the assist?'],
    ['event-sequence', 'explanation', 'observed-sequence', 'How did that goal develop?'],
  ]) {
    const mock = sequenceTransport([
      {
        answerFocus: focus,
        explanationTarget: target,
        requestedForm: form,
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [
            { filters: { type: 'shot', result: true }, aggregate: 'list', order: 'asc', limit: 1 },
          ],
        },
      },
      { decision: 'approve', reason: 'The unique received goal and requested role are supported.' },
    ]);
    const result = await answerMatchQuestionAI(
      { kind: 'counter', seed: 1041, time: 118, question },
      { config, fetcher: mock.fetcher },
    );
    assert.equal(result.execution.modelCalls, 2);
    assert.equal(result.execution.repairs, 0);
    assert.equal(result.claims.length, 1);
    assert.match(
      result.answer,
      focus === 'credited-assist'
        ? /Mensah.*assist/
        : focus === 'event-sequence'
          ? /Cole recovered.*Mensah.*Reed/
          : /Reed.*01:56/,
    );
    if (focus === 'event-sequence') {
      assert.equal(result.moments.length, 1);
      assert.equal(result.evidence.length, 5);
    }
  }
});

test('a best-player request cannot be satisfied by an approved team comparison alone', () => {
  const review = {
    requestCheck: {
      responseIntent: {
        purpose: 'assessment',
        needsAssessment: true,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
      },
      coverage: [{ claimIndices: [0], answerForm: 'assessment', requestedAction: 'other' }],
    },
  };
  const answer = {
      claims: [
        { kind: 'observation', text: 'Northbridge leads on shots on target.', evidence: [] },
      ],
    },
    selection = { proofs: [{ kind: 'team-comparison', assessmentBounds: 'this-measure-only' }] };
  assert.ok(
    reviewRequestAdequacy(
      review,
      answer,
      { answerFocus: 'player-assessment', roster: [], queryResults: [] },
      { canonicalFactSelection: selection },
    ).some((issue) => /assessment/.test(issue.reason)),
  );
  assert.deepEqual(
    reviewRequestAdequacy(
      review,
      answer,
      { answerFocus: 'team-assessment', roster: [], queryResults: [] },
      { canonicalFactSelection: selection },
    ),
    [],
  );
});

test('schema-grounded unknown intent is selected in three calls with the actual shot and no invented prose', async () => {
  const question = {
    kind: 'sustained',
    seed: 1042,
    time: 98,
    question: 'Why did he shoot instead of slipping it to a teammate?',
  };
  const mock = sequenceTransport([
    {
      explanationTarget: 'decision-rationale',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet, body) => {
      assert.deepEqual(
        resolvedWireSchema(body).properties.composition.anyOf.map(
          (mode) => mode.properties.mode.enum[0],
        ),
        ['known-limitation'],
      );
      assert.equal(resolvedWireSchema(body).$defs, undefined);
      const shot = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
        ),
        limitation = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'capability-limitation',
        );
      assert.ok(shot && limitation);
      return {
        scope: 'match',
        composition: {
          mode: 'known-limitation',
          contextFactIds: [shot.id],
          limitationFactId: limitation.id,
        },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'The saved shot and specific unavailable reasoning answer the question.',
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.execution.repairs, 0);
  assert.match(result.answer, /saved/);
  assert.match(result.answer, /can't tell what the player intended/);
  assert.equal(result.claims.at(-1).kind, 'limitation');
  assert.equal(result.provenance.modelGenerated, false);
});

test('known limitations cannot use a statistic as action context or an event as the limitation proof', async () => {
  const question = { kind: 'sustained', seed: 1042, time: 98, question: 'Why did he shoot?' };
  for (const invalidContext of [true, false]) {
    const mock = sequenceTransport([
      {
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
        },
      },
      (packet) => {
        const limitation = packet.matchFacts.facts.find(
            (f) => f.selection.kind === 'capability-limitation',
          ),
          count = packet.matchFacts.facts.find((f) => f.selection.kind === 'count'),
          event = packet.matchFacts.facts.find((f) => f.selection.kind === 'ordered-event');
        assert.ok(limitation && count && event);
        return {
          scope: 'match',
          composition: {
            mode: 'known-limitation',
            contextFactIds: [invalidContext ? count.id : event.id],
            limitationFactId: invalidContext ? limitation.id : event.id,
          },
          followUp: '',
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-fact-selection',
    );
    assert.equal(mock.count(), 2);
  }
});

test('a reviewed false premise can leave the fast rationale format for one grounded correction', async () => {
  const question = {
    kind: 'sustained',
    seed: 1042,
    time: 98,
    question: 'Why did Cole shoot instead of passing?',
  };
  let shot;
  const mock = sequenceTransport([
    {
      explanationTarget: 'decision-rationale',
      requestedForm: 'explanation',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet) => {
      shot = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
      );
      const limitation = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'capability-limitation',
      );
      return {
        scope: 'match',
        composition: {
          mode: 'known-limitation',
          contextFactIds: [shot.id],
          limitationFactId: limitation.id,
        },
        followUp: '',
      };
    },
    {
      decision: 'withhold',
      reason: 'The question assumes Cole shot; the actual actor needs an explicit correction.',
    },
    (_packet, body) => {
      assert.ok(
        resolvedWireSchema(body).properties.composition.anyOf.some((mode) =>
          mode.properties.mode.enum.includes('explanation'),
        ),
      );
      return {
        scope: 'match',
        premiseCheck: {
          questionAssumption: 'Cole took this shot.',
          recordedAction: 'Reed took this shot.',
          conclusion: 'contradicted',
        },
        composition: {
          mode: 'explanation',
          factIds: [shot.id],
          claim: {
            text: 'It was Reed who shot, not Cole; his reason for shooting rather than passing is unknown.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'The actual actor is corrected with a supported specific uncertainty.',
    },
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.equal(result.execution.repairs, 1);
  assert.match(result.answer, /not Cole/);
});
const wireQueries = (packet) => [
  ...(packet.requestedEvidence || []),
  ...(packet.queryResults || []),
];

test('review coverage must quote actual request and final answer, not a removed limitation', () => {
  const question = 'Explain the buildup and what we cannot tell.';
  const answer = { claims: [{ text: 'Cole passed to Reed, who shot.' }] };
  const review = (coverage) => ({ requestCheck: { coverage } });
  assert.equal(
    reviewCoverageMatches(
      review([
        { requestSpan: 'Explain the buildup', answerSpan: 'Cole passed to Reed' },
        { requestSpan: 'what we cannot tell', answerSpan: 'His intentions are unknown.' },
      ]),
      answer,
      question,
    ),
    false,
  );
  assert.equal(
    reviewCoverageMatches(
      review([{ requestSpan: 'Explain the buildup', answerSpan: 'Cole passed to Reed' }]),
      answer,
      question,
    ),
    false,
    'An explicit second request component cannot be silently omitted',
  );
  assert.equal(
    reviewCoverageMatches(
      review([{ requestSpan: 'invented question', answerSpan: 'Cole passed to Reed' }]),
      answer,
      question,
    ),
    false,
  );
  assert.equal(reviewCoverageMatches(review([]), answer, question), false);
  assert.deepEqual(requestComponents('J. Cole is playing well. How many shots has he had?'), [
    'How many shots has he had',
  ]);
  assert.deepEqual(
    requestComponents('For an analyst, reconstruct the move. Distinguish facts from unknowns.'),
    ['reconstruct the move', 'Distinguish facts from unknowns'],
  );
});

test('coverage requires each exact server component once, without whole-question or partial-span substitutes', () => {
  const question = 'Which team leads, and how large is the gap?';
  const components = requestComponents(question);
  assert.equal(components.length, 2);
  const answer = { claims: [{ text: 'Northbridge leads by one completed pass.' }] };
  const coverage = components.map((requestSpan) => ({
    requestSpan,
    answerSpan: answer.claims[0].text,
  }));
  const review = (coverage) => ({ requestCheck: { coverage } });
  assert.equal(reviewCoverageMatches(review(coverage), answer, question), true);
  assert.equal(
    reviewCoverageMatches(
      review([{ requestSpan: question, answerSpan: answer.claims[0].text }]),
      answer,
      question,
    ),
    false,
  );
  assert.equal(reviewCoverageMatches(review([coverage[0], coverage[0]]), answer, question), false);
  assert.equal(
    reviewCoverageMatches(
      review([{ ...coverage[0], requestSpan: 'Which team' }, coverage[1]]),
      answer,
      question,
    ),
    false,
  );
  assert.equal(reviewCoverageMatches(review([...coverage, coverage[0]]), answer, question), false);
  assert.equal(
    reviewCoverageMatches(
      review([coverage[0], { ...coverage[1], answerSpan: 'An answer not actually published.' }]),
      answer,
      question,
    ),
    false,
  );
});

test('embedded questions after contextual punctuation retain every requested attribute', () => {
  for (const punctuation of ['—', '–', ':', ' - '])
    assert.deepEqual(
      requestComponents(
        `About that delivery ${punctuation} which foot contacted it, and is its velocity measured?`,
      ),
      ['which foot contacted it', 'is its velocity measured'],
    );
  assert.deepEqual(
    requestComponents(
      'The player is over there. Which foot contacted it, and is its velocity measured?',
    ),
    ['Which foot contacted it', 'is its velocity measured'],
  );
});

test('whole-request assessment intent cannot be erased by per-component fact classifications', () => {
  const answer = {
      scope: 'match',
      claims: [{ kind: 'observation', text: 'Two recorded actions.', evidence: [] }],
    },
    packet = { queryResults: [], roster: [] };
  const review = {
    requestCheck: {
      responseIntent: {
        purpose: 'assessment',
        needsAssessment: true,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
      },
      coverage: [{ answerForm: 'fact', requestedAction: 'other', claimIndices: [0] }],
    },
  };
  assert.match(reviewRequestAdequacy(review, answer, packet)[0].reason, /qualified assessment/);
  const withJudgment = {
    ...answer,
    claims: [
      ...answer.claims,
      {
        kind: 'interpretation',
        text: 'A qualified contribution, with broader impact unknown.',
        evidence: [],
      },
    ],
  };
  assert.ok(
    reviewRequestAdequacy(review, withJudgment, packet).length,
    'An uncovered paragraph cannot supply the declared intent',
  );
  const covered = structuredClone(review);
  covered.requestCheck.coverage[0].claimIndices = [0, 1];
  assert.deepEqual(reviewRequestAdequacy(covered, withJudgment, packet), []);
  for (const [flag, expected] of [
    ['needsExplicitCorrection', 'premise correction'],
    ['needsMeasurementLimitation', 'measurement limitation'],
  ]) {
    const check = structuredClone(review);
    check.requestCheck.responseIntent = {
      purpose: 'mixed',
      needsAssessment: false,
      needsExplicitCorrection: false,
      needsMeasurementLimitation: false,
      [flag]: true,
    };
    assert.match(reviewRequestAdequacy(check, answer, packet)[0].reason, new RegExp(expected));
  }
});

test('one covered interpretation can supply a qualified assessment and reviewed measurement limitation without a second paragraph', () => {
  const answer = {
    scope: 'match',
    claims: [
      { kind: 'observation', text: 'The shot was saved.', evidence: [] },
      {
        kind: 'interpretation',
        text: 'The move produced a threat, although its chance quality is not measured.',
        evidence: [],
      },
    ],
  };
  const review = {
    requestCheck: {
      responseIntent: {
        purpose: 'mixed',
        needsAssessment: true,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: true,
      },
      coverage: [
        { answerForm: 'assessment', requestedAction: 'other', claimIndices: [0, 1] },
        { answerForm: 'unavailable-measurement', requestedAction: 'other', claimIndices: [1] },
      ],
    },
  };
  assert.deepEqual(reviewRequestAdequacy(review, answer, { queryResults: [], roster: [] }), []);
  const missing = structuredClone(review);
  missing.requestCheck.coverage.forEach((part) => (part.claimIndices = [0]));
  assert.ok(
    reviewRequestAdequacy(missing, answer, { queryResults: [], roster: [] }).length,
    'The qualification must be a covered model-authored paragraph, not adjacent facts',
  );
});

test('indexed coverage references existing final claims once per component and rejects malformed attribution', () => {
  const question = 'Which team leads, and how large is the gap?',
    components = requestComponents(question);
  const answer = {
    claims: [{ text: 'Northbridge leads.' }, { text: 'The margin is one completed pass.' }],
  };
  const coverage = components.map((requestSpan, index) => ({ requestSpan, claimIndices: [index] }));
  const review = (value) => ({ requestCheck: { coverage: value } });
  assert.equal(reviewCoverageMatches(review(coverage), answer, question), true);
  assert.equal(
    reviewCoverageMatches(
      review(components.map((requestSpan) => ({ requestSpan, claimIndices: [0, 1] }))),
      answer,
      question,
    ),
    true,
  );
  for (const claimIndices of [[], [0, 0], [-1], [2], [0.5], ['0'], null])
    assert.equal(
      reviewCoverageMatches(
        review([{ ...coverage[0], claimIndices }, coverage[1]]),
        answer,
        question,
      ),
      false,
      JSON.stringify(claimIndices),
    );
  for (const value of [
    [coverage[0]],
    [coverage[0], coverage[0]],
    [{ ...coverage[0], requestSpan: 'Which team' }, coverage[1]],
    [{ ...coverage[0], answerSpan: 'Northbridge leads.' }, coverage[1]],
  ])
    assert.equal(reviewCoverageMatches(review(value), answer, question), false);
  assert.equal(
    reviewCoverageMatches(review(coverage), { claims: [{ text: '' }, answer.claims[1]] }, question),
    false,
  );
});

test('internal evidence IDs cannot leak into a released fan answer', async () => {
  const bad = {
    scope: 'match',
    claims: [
      { text: `Reed missed according to ${input.anchorId}.`, kind: 'observation', evidence: [ref] },
    ],
    followUp: '',
  };
  const mock = directTransport({ draft: bad, queries: [] }, { decision: 'approve' });
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld' && /internal evidence/.test(error.message),
  );
  assert.equal(mock.count(), 1);
});

test('a general numerical football definition needs no match count proof', async () => {
  const definition = {
    scope: 'general',
    claims: [
      { text: 'A brace means a player scores two goals in a game.', kind: 'general', evidence: [] },
    ],
    followUp: '',
  };
  const mock = directTransport({ draft: definition, queries: [] }, { decision: 'approve' });
  const result = await answerMatchQuestionAI(
    { ...input, question: 'What is a brace?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(result.scope, 'general');
  assert.match(result.answer, /two goals/);
  assert.deepEqual(result.evidence, []);
});

function operationEnvelope(
  question,
  {
    operator = 'difference',
    metric = 'completedPasses',
    subjects = ['home', 'away'],
    timeFrom = 0,
    timeTo = question.time,
  } = {},
) {
  return {
    mentionedPlayers: [],
    operationPlan: {
      version: 1,
      obligations: [
        {
          id: 'requested-operation',
          requestSpan: question.question,
          operator,
          metric,
          subjects,
          timeFrom,
          timeTo,
        },
      ],
    },
    draft: null,
    queries: [],
  };
}
const resolvedWireSchema = (body) => {
  const root = body.response_format.json_schema.schema;
  const resolve = (value) =>
    Array.isArray(value)
      ? value.map(resolve)
      : value && typeof value === 'object'
        ? value.$ref
          ? resolve(root.$defs[value.$ref.replace('#/$defs/', '')])
          : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]))
        : value;
  return resolve(root);
};
const decisionBranch = (body, kind) =>
  resolvedWireSchema(body).properties.decision.anyOf.find((branch) =>
    branch.properties.kind.enum.includes(kind),
  );
const operationProperties = (body, operator) =>
  decisionBranch(body, 'operation')?.properties.plan.properties.obligations.items.anyOf.find(
    (branch) => branch.properties.operator.enum.includes(operator),
  )?.properties;
test('a model-mistyped club receives a complete team count in two calls with independent review', async () => {
  let reviewed = false;
  const mock = sequenceTransport([
    {
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['Northbridge'],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'pass', player: 'Northbridge' }, aggregate: 'count' }],
      },
    },
    (packet) => {
      assert.deepEqual(packet.evidence.mentionedPlayerResolution, []);
      assert.ok(
        [
          ...(packet.evidence.requestedEvidence || []),
          ...(packet.evidence.queryResults || []),
        ].some(
          (result) =>
            result.query?.filters?.team === 'home' &&
            result.query.aggregate === 'count' &&
            !result.query.filters.player,
        ),
      );
      reviewed = true;
      return {
        decision: 'approve',
        reason: 'The exact source club has a complete team-scoped pass count.',
      };
    },
  ]);
  const result = await answerMatchQuestionAI(
    {
      kind: 'sustained',
      seed: 17,
      time: 38,
      question: 'How many passes has Northbridge attempted?',
    },
    { config, fetcher: mock.fetcher },
  );
  assert.ok(reviewed);
  assert.equal(result.answer, 'Northbridge has 1 pass attempt.');
  assert.doesNotMatch(result.answer, /lineup|not in this/);
  assert.notEqual(result.provenance.source, 'verified-lineup-resolution');
  assert.equal(result.execution.modelCalls, 2);
  assert.equal(result.claimProvenance[0].modelGenerated, false);
});

function sequenceTransport(values, inspect = () => {}) {
  let calls = 0;
  return {
    count: () => calls,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body),
        packet = JSON.parse(body.messages.at(-1).content);
      inspect(packet, calls, body);
      assert.ok(calls < values.length, 'No unexpected extra model call');
      const source = values[calls++],
        value = typeof source === 'function' ? source(packet, body) : source;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(reviewFixture(value, body)) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    },
  };
}

test('a repaired plan can withdraw a rejected model-invented goalkeeper role without losing answer review', async () => {
  const input = {
      kind: 'sustained',
      seed: 17,
      time: 70,
      question: 'Did Cole force the mistake, or do we only know he won the ball?',
    },
    span = requestComponents(input.question)[0];
  const role = {
    requestSpan: span,
    source: 'event',
    sourceField: 'playerId',
    actorRole: 'goalkeeper',
    linkage: 'saved-shot-hold',
  };
  const query = (filters) => ({ filters, aggregate: 'list', order: 'desc', limit: 1 });
  let reviewed = false;
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: [role],
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [query({ type: 'recovery', player: 'home-7', recoveryKind: 'goalkeeper-hold' })],
      },
    },
    (packet) => {
      assert.equal(packet.planningCorrection.kind, 'missing-source-role-evidence');
      return {
        requestedSourceAttributes: null,
        answerFocus: 'other',
        explanationTarget: 'causal-attribution',
        requestedForm: 'explanation',
        mentionedPlayers: ['J. Cole'],
        decision: { kind: 'queries', queries: [query({ type: 'recovery', player: 'home-7' })] },
      };
    },
    (packet) => {
      assert.equal(packet.requestedSourceAttributes, undefined);
      const event = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.playerId === 'home-7' &&
          !f.selection.attributes,
      );
      const boundary = packet.matchFacts.facts.find(
        (f) => f.claim.kind === 'limitation' && f.claim.text.includes('forced the mistake'),
      );
      assert.ok(event);
      assert.ok(boundary);
      return {
        premiseCheck: {
          questionAssumption: 'Cole caused the mistake',
          recordedAction: 'Cole recovered the ball',
          conclusion: 'unknown',
        },
        scope: 'match',
        composition: {
          mode: 'known-limitation',
          contextFactIds: [event.id],
          limitationFactId: boundary.id,
        },
        followUp: '',
      };
    },
    (packet) => {
      reviewed = true;
      assert.equal(packet.evidence.requestedSourceAttributes, undefined);
      return {
        decision: 'approve',
        requestCheck: {
          requestedInformation: input.question,
          status: 'useful-limitation',
          reason: 'Known recovery and unavailable causal attribution both answered.',
          coverage: requestComponents(input.question).map((requestSpan) => ({
            requestSpan,
            claimIndices: [0, 1],
            answerForm: 'explanation',
            requestedAction: 'ball-win',
          })),
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => mock.count() < 4,
  });
  assert.equal(reviewed, true);
  assert.equal(result.execution.planningRepairs, 1);
  assert.equal(result.execution.modelCalls, 4);
  assert.match(result.answer, /Cole/);
  assert.match(result.answer, /doesn't establish who forced the mistake/);
  assert.ok(!/0 ball wins/.test(result.answer));
});

test('a success filter on receptions is corrected before it can invent a zero-reception answer', async () => {
  const query = (result) => ({
    filters: { type: 'receive', team: 'home', ...(result === null ? {} : { result }) },
    aggregate: 'by-player',
  });
  let repaired = false;
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: { kind: 'queries', queries: [query(true)] },
    },
    (packet) => {
      assert.equal(packet.planningCorrection.kind, 'invalid-control-outcome');
      repaired = true;
      return {
        answerFocus: 'event-actor',
        requestedForm: 'fact',
        mentionedPlayers: [],
        decision: { kind: 'queries', queries: [query(null)] },
      };
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'receptions' &&
          f.selection.subjectId === 'home-10',
      );
      assert.ok(fact);
      assert.match(fact.claim.text, /2/);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    {
      decision: 'approve',
      reason: 'The complete home reception inventory identifies Reed with two receptions.',
    },
  ]);
  const answer = await answerMatchQuestionAI(
    {
      kind: 'sustained',
      seed: 17,
      time: 79,
      question: 'Who has received Northbridge’s passes most often?',
    },
    { config, fetcher: mock.fetcher, canRepair: () => true },
  );
  assert.ok(repaired);
  assert.match(answer.answer, /A\. Reed.*2/);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.equal(answer.execution.modelCalls, 4);
});

test('the actual first wire chooses one plan and never asks for authored prose', async () => {
  const question = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'Compare the first and latest shots.',
  };
  const plan = operationEnvelope(question, {
    operator: 'orderedEndpoints',
    metric: 'attempts',
    subjects: [],
  }).operationPlan;
  const mock = directTransport(
    { mentionedPlayers: [], decision: { kind: 'operation', plan } },
    { decision: 'approve' },
    (packet, call, body) => {
      if (call) return;
      const schema = body.response_format.json_schema.schema;
      assert.deepEqual(schema.required, [
        'eventPresentation',
        'requestedSourceAttributes',
        'answerFocus',
        'explanationTarget',
        'requestedForm',
        'mentionedPlayers',
        'decision',
      ]);
      assert.equal(schema.properties.draft, undefined);
      assert.equal(schema.properties.queries, undefined);
      const [operation, queries] = schema.properties.decision.anyOf;
      assert.deepEqual(operation.required, ['kind', 'plan']);
      assert.equal(operation.properties.queries, undefined);
      assert.equal(operation.additionalProperties, false);
      assert.deepEqual(queries.required, ['kind', 'queries']);
      assert.equal(queries.properties.plan, undefined);
      assert.equal(queries.additionalProperties, false);
      assert.equal(queries.properties.queries.maxItems, 3);
      assert.match(body.messages[0].content, /Plan evidence only/);
      assert.doesNotMatch(
        body.messages[0].content,
        /Fill this INTERNAL field|Choose the shortest useful answer shape|Return ONLY JSON|Answer the actual free-form question/,
      );
      assert.equal(
        operationProperties(body, 'orderedEndpoints').metric.enum.includes('shotsOnTarget'),
        false,
      );
      assert.equal(packet.allowedOperationMetrics.includes('attempts'), true);
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.proofs[0].values.latest.actor.label, 'D. Silva');
  assert.equal(mock.count(), 2);
});

test('conflicting old or new operation/query routes are rejected rather than prioritized', async () => {
  const question = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'Compare the first and latest shots.',
  };
  const legacy = operationEnvelope(question, {
    operator: 'orderedEndpoints',
    metric: 'attempts',
    subjects: [],
  });
  const queries = [{ filters: { type: 'shot' }, aggregate: 'list' }];
  for (const first of [
    { ...legacy, queries },
    { mentionedPlayers: [], decision: { kind: 'operation', plan: legacy.operationPlan, queries } },
    {
      mentionedPlayers: [],
      decision: { kind: 'queries', queries },
      operationPlan: legacy.operationPlan,
    },
    {
      mentionedPlayers: [],
      decision: { kind: 'operation', plan: { version: 1, obligations: [] } },
    },
  ]) {
    const mock = directTransport(first);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 1);
  }
});

test('restrictive operation metrics require a supported request qualifier before execution', async () => {
  for (const questionText of [
    'Compare the first and latest shots.',
    'Compare all shots, not just shots on target.',
    'Was the first shot on target?',
  ]) {
    const question = { kind: 'interrupted', seed: 8341, time: 100, question: questionText };
    const plan = operationEnvelope(question, {
      operator: 'orderedEndpoints',
      metric: 'shotsOnTarget',
      subjects: [],
    }).operationPlan;
    const mock = directTransport({ mentionedPlayers: [], decision: { kind: 'operation', plan } });
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 1);
  }
  const question = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'Compare the first and latest shots on target.',
  };
  const plan = operationEnvelope(question, {
    operator: 'orderedEndpoints',
    metric: 'shotsOnTarget',
    subjects: [],
  }).operationPlan;
  const mock = directTransport(
    { mentionedPlayers: [], decision: { kind: 'operation', plan } },
    { decision: 'approve' },
    (_packet, call, body) => {
      if (!call)
        assert.ok(
          operationProperties(body, 'orderedEndpoints').metric.enum.includes('shotsOnTarget'),
        );
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.proofs[0].metric, 'shotsOnTarget');
  assert.equal(result.proofs[0].values.count, 1);
  assert.equal(mock.count(), 2);
});

test('exclusive queries route writes general and roster answers only after planning', async () => {
  for (const rosterFact of [false, true]) {
    const question = {
      kind: 'sustained',
      seed: 17,
      time: 20,
      question: rosterFact ? 'What team does J. Cole play for?' : 'What is a low block?',
    };
    let calls = 0;
    const fetcher = async (_url, options) => {
      const body = JSON.parse(options.body),
        packet = JSON.parse(body.messages.at(-1).content);
      let value;
      if (calls === 0)
        value = {
          mentionedPlayers: rosterFact ? ['J. Cole'] : [],
          decision: { kind: 'queries', queries: [] },
        };
      else if (calls === 1) {
        assert.equal(body.response_format.json_schema.name, 'match_answer');
        const text = rosterFact
          ? 'J. Cole plays for Northbridge.'
          : 'A low block is a compact defensive shape near the team’s own goal.';
        const evidence = rosterFact
          ? [packet.queryResults.find((q) => q.query.filters.player === 'J. Cole').scopeReference]
          : [];
        value = {
          scope: rosterFact ? 'match' : 'general',
          claims: [{ text, kind: rosterFact ? 'observation' : 'general', evidence }],
          followUp: '',
        };
      } else {
        assert.equal(calls, 2);
        value = { decision: 'approve' };
      }
      calls++;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(reviewFixture(value, body)) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    };
    const result = await answerMatchQuestionAI(question, { config, fetcher });
    assert.equal(calls, 3);
    assert.equal(result.provenance.modelGenerated, true);
    assert.deepEqual(
      result.execution.stages.map((s) => s.stage),
      ['answer-or-query', 'answer-after-query', 'review'],
    );
    assert.deepEqual(result.execution.usage, { promptTokens: 300, completionTokens: 60 });
    assert.deepEqual(result.moments, []);
  }
});

test('general knowledge has an exclusive wire route and no hidden match or player-lookup context', async () => {
  const question = {
    ...input,
    question: 'Explain offside simply.',
    language: 'en',
    conversation: [
      {
        question: 'What is an attacking phase?',
        answer: 'A period when a team attacks.',
        time: 90,
      },
    ],
  };
  let calls = 0;
  const answer = {
    scope: 'general',
    claims: [
      {
        text: 'An offside position alone is not an offense; active involvement is also required.',
        kind: 'general',
        evidence: [],
      },
    ],
    followUp: '',
  };
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (!calls) {
      assert.deepEqual(decisionBranch(body, 'general').required, ['kind', 'concepts']);
      assert.equal(decisionBranch(body, 'general').additionalProperties, false);
      value = { answerFocus: 'other', mentionedPlayers: ['Messi'], decision: { kind: 'general' } };
    } else if (calls === 1) {
      assert.deepEqual(
        Object.keys(packet).sort(),
        [
          'question',
          'viewerProfile',
          'requestComponents',
          'responseLanguage',
          'previousQuestion',
          'conversation',
        ].sort(),
      );
      assert.deepEqual(packet.conversation, question.conversation);
      assert.match(body.messages[0].content, /This is a general football explanation/);
      value = answer;
    } else {
      for (const field of [
        'roster',
        'teams',
        'score',
        'limits',
        'pendingOutcomeContext',
        'mentionedPlayerResolution',
      ])
        assert.equal(packet.evidence[field], undefined, field);
      assert.deepEqual(packet.evidence.queryResults, []);
      assert.deepEqual(packet.evidence.linkedContext.rows, []);
      value = { decision: 'approve' };
    }
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, body)) },
          },
        ],
      }),
    };
  };
  const result = await answerMatchQuestionAI(question, { config, fetcher });
  assert.equal(calls, 3);
  assert.equal(result.scope, 'general');
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.moments, []);
  assert.equal(result.provenance.modelGenerated, true);
  for (const decision of [
    { kind: 'general', queries: [] },
    { kind: 'general', plan: { version: 1, obligations: [] } },
  ]) {
    const bad = directTransport({ mentionedPlayers: [], decision });
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: bad.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(bad.count(), 1);
  }
});

test('selected rule knowledge is identical for selection and review with honest separate source metadata', async () => {
  const question = { ...input, question: 'What makes an offside position an offense?' };
  const facts = retrieveFootballKnowledge(['offside']);
  let writerKnowledge;
  const answer = {
    scope: 'general',
    claims: [
      {
        text: 'An offside position alone is not an offense; active involvement is also required.',
        kind: 'general',
        evidence: [],
        dependsOn: [],
      },
    ],
    followUp: '',
  };
  const mock = sequenceTransport(
    [
      { mentionedPlayers: [], decision: { kind: 'general', concepts: ['offside'] } },
      { factIds: ['offside.involvement'] },
      { decision: 'approve' },
    ],
    (packet, call, body) => {
      if (!call) {
        assert.deepEqual(packet.footballKnowledgeCatalog, footballKnowledgeCatalog);
        assert.equal(decisionBranch(body, 'general').properties.concepts.maxItems, 3);
        assert.equal(
          body.response_format.json_schema.schema.properties.mentionedPlayers.items.maxLength,
          100,
        );
      } else if (call === 1) {
        writerKnowledge = packet.footballKnowledge;
        assert.deepEqual(writerKnowledge, facts);
        assert.equal(packet.queryResults, undefined);
        assert.equal(packet.roster, undefined);
      } else {
        assert.deepEqual(packet.footballKnowledge, writerKnowledge);
        assert.deepEqual(packet.evidence.queryResults, []);
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(mock.count(), 3);
  assert.deepEqual(result.knowledgeSources, facts.sources);
  assert.equal(result.knowledgeReference.contentHash, facts.contentHash);
  assert.deepEqual(result.knowledgeReference.conceptIds, ['offside']);
  assert.match(result.knowledgeReference.attribution, /selection alone does not verify/i);
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.provenance.source, 'verified-rule-facts');
  assert.equal(
    result.answer,
    facts.concepts[0].facts.find((fact) => fact.id === 'offside.involvement').text,
  );
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.moments, []);
  for (const concepts of [
    ['unknown-law'],
    ['offside', 'offside'],
    ['offside', 'goal', 'var', 'fouls'],
    [42],
    null,
  ]) {
    const invalid = directTransport({
      mentionedPlayers: [],
      decision: { kind: 'general', concepts },
    });
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: invalid.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(invalid.count(), 1);
  }
});

test('interpretations can lead or follow their directly grounded observations without invented citations', async () => {
  for (const leads of [false, true]) {
    const observation = {
      text: 'Reed shot off target.',
      kind: 'observation',
      evidence: [ref],
      dependsOn: [],
    };
    const interpretation = {
      text: 'Reed’s attempt was unsuccessful.',
      kind: 'interpretation',
      evidence: [],
      dependsOn: [leads ? 1 : 0],
    };
    const candidate = {
      scope: 'match',
      claims: leads ? [interpretation, observation] : [observation, interpretation],
      followUp: '',
    };
    const trace = [{ claimIndex: leads ? 0 : 1, observationIndices: [leads ? 1 : 0] }];
    const mock = directTransport(
      { draft: candidate, queries: [] },
      { decision: 'approve' },
      (packet, call) => {
        if (call) {
          assert.deepEqual(packet.claimDependencies, trace);
          assert.deepEqual(packet.answer.claims[leads ? 0 : 1].evidence, [ref]);
        }
      },
    );
    const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.deepEqual(answer.claimDependencies, trace);
    assert.deepEqual(answer.claims[leads ? 0 : 1].evidence, [ref]);
    assert.equal(answer.provenance.modelGenerated, true);
    assert.equal(mock.count(), 2);
    assert.deepEqual(interpretation.evidence, [], 'Do not mutate the received model answer');
  }
});

test('dependency references cannot form cycles, target unsupported claim kinds or rescue missing direct evidence', async () => {
  const observation = { text: 'Reed shot off target.', kind: 'observation', evidence: [ref] };
  const interpretation = {
    text: 'Reed’s attempt was unsuccessful.',
    kind: 'interpretation',
    evidence: [],
    dependsOn: [1],
  };
  const invalidClaims = [
    [{ ...interpretation, dependsOn: [0] }, observation],
    [{ ...interpretation, dependsOn: [1, 1] }, observation],
    [{ ...interpretation, dependsOn: [2] }, observation],
    [{ ...interpretation, dependsOn: ['1'] }, observation],
    [{ ...interpretation, dependsOn: null }, observation],
    [interpretation, { ...observation, evidence: [] }],
    [interpretation, { ...observation, kind: 'general' }],
    [interpretation, { ...observation, kind: 'limitation' }],
    [interpretation, { ...interpretation, dependsOn: [0] }],
    [{ ...observation, dependsOn: [1] }, observation],
    [interpretation, { ...observation, evidence: [{ ...ref, revision: 99 }] }],
  ];
  for (const claims of invalidClaims) {
    const mock = directTransport({ draft: { scope: 'match', claims, followUp: '' }, queries: [] });
    await assert.rejects(answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }));
    assert.equal(mock.count(), 1);
  }
  const unsupported = directTransport({
    draft: {
      scope: 'match',
      claims: [{ ...interpretation, text: 'Reed had a 90% chance of scoring.' }, observation],
      followUp: '',
    },
    queries: [],
  });
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: unsupported.fetcher }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(unsupported.count(), 1);
});

test('one structural planning correction uses three-call headroom and preserves canonical results', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes?',
  };
  const invalid = operationEnvelope(question, { subjects: ['home', 'all'] }),
    valid = operationEnvelope(question);
  let budgetRequirement;
  const mock = sequenceTransport(
    [invalid, valid, { decision: 'approve' }],
    (packet, call, body) => {
      if (call === 1) {
        assert.equal(body.response_format.json_schema.name, 'match_answer_or_query');
        assert.deepEqual(packet.rejectedPlan, invalid);
        assert.match(packet.planningError, /restriction/);
        assert.doesNotMatch(
          body.messages[0].content,
          /A useful rules definition|An absent recorded action/,
        );
      }
    },
  );
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: (required) => {
      budgetRequirement = required;
      return true;
    },
  });
  assert.equal(budgetRequirement, 3);
  assert.equal(result.proofs[0].values.absoluteMargin, 1);
  assert.equal(result.execution.planningRepairs, 1);
  assert.equal(result.execution.repairs, 1);
  assert.equal(result.execution.modelCalls, 3);
  assert.deepEqual(
    result.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'planning-repair', 'review'],
  );
  assert.deepEqual(result.execution.usage, { promptTokens: 300, completionTokens: 60 });
  const repeat = sequenceTransport([invalid, invalid]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: repeat.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(repeat.count(), 2);
});

test('one planning repair permits one answer repair with a six-call ceiling', async () => {
  const question = { ...input, question: 'What is a low block?' };
  const invalid = {
      mentionedPlayers: ['X'.repeat(101)],
      decision: { kind: 'general', concepts: [] },
    },
    valid = { mentionedPlayers: [], decision: { kind: 'general', concepts: [] } };
  const good = {
    scope: 'general',
    claims: [
      {
        text: 'A low block is a compact defensive shape close to the team’s own goal.',
        kind: 'general',
        evidence: [],
      },
    ],
    followUp: '',
  };
  const bad = {
    scope: 'match',
    claims: [{ text: 'Reed scored.', kind: 'observation', evidence: [] }],
    followUp: '',
  };
  const limits = [];
  const mock = sequenceTransport([invalid, valid, bad, good, { decision: 'approve' }]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: (required) => {
      limits.push(required);
      return true;
    },
  });
  assert.deepEqual(limits, [3, 2]);
  assert.equal(mock.count(), 5);
  assert.equal(result.execution.modelCalls, 5);
  assert.equal(result.execution.planningRepairs, 1);
  assert.equal(result.execution.repairs, 2);
  const withheld = sequenceTransport([
    invalid,
    valid,
    good,
    { decision: 'withhold', reason: 'The answer does not fulfill the request.' },
    good,
    { decision: 'withhold', reason: 'The one replacement is still rejected.' },
  ]);
  let checks = 0;
  await assert.rejects(
    answerMatchQuestionAI(question, {
      config,
      fetcher: withheld.fetcher,
      canRepair: () => {
        checks++;
        return true;
      },
    }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(withheld.count(), 6);
  assert.equal(checks, 2, 'One planning repair and one answer repair, without a third repair.');
  let calls = 0;
  await assert.rejects(
    answerMatchQuestionAI(question, {
      config,
      fetcher: async () => {
        calls++;
        throw Error('network stopped');
      },
      canRepair: () => {
        throw Error('Transport failures cannot request repair');
      },
    }),
    (error) => error.code === 'azure-network',
  );
  assert.equal(calls, 1);
});

test('zero-query match misplanning cannot cite a hidden preload and can ask a grounded clarification', async () => {
  for (const fabricate of [false, true]) {
    let calls = 0;
    const fetcher = async (_url, options) => {
      const body = JSON.parse(options.body),
        packet = JSON.parse(body.messages.at(-1).content);
      let value;
      if (!calls) value = { mentionedPlayers: [], decision: { kind: 'queries', queries: [] } };
      else if (calls === 1) {
        assert.equal(packet.queryResults, undefined);
        assert.equal(packet.limits, undefined);
        assert.equal(packet.score, undefined);
        value = fabricate
          ? draft
          : {
              scope: 'clarify',
              claims: [{ text: 'Which moment do you mean?', kind: 'limitation', evidence: [] }],
              followUp: '',
            };
      } else
        value = {
          decision: 'approve',
          requestCheck: {
            requestedInformation: input.question,
            status: 'clarification',
            reason: 'The planner did not retrieve the requested moment.',
          },
        };
      calls++;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(reviewFixture(value, body)) },
            },
          ],
        }),
      };
    };
    if (fabricate) {
      await assert.rejects(
        answerMatchQuestionAI(input, { config, fetcher }),
        /unavailable or outdated/,
      );
      assert.equal(calls, 2);
    } else {
      const result = await answerMatchQuestionAI(input, { config, fetcher });
      assert.equal(result.scope, 'clarify');
      assert.equal(result.status, 'limited');
      assert.equal(calls, 3);
    }
  }
});

test('exclusive queries route retains the five-call ceiling with one reviewed repair', async () => {
  const question = { kind: 'quiet', seed: 17, time: 20, question: 'What is a low block?' };
  const bad = {
    scope: 'general',
    claims: [{ text: 'A low block is always perfect.', kind: 'general', evidence: [] }],
    followUp: '',
  };
  const good = {
    scope: 'general',
    claims: [
      {
        text: 'A low block is a compact defensive shape near the team’s own goal.',
        kind: 'general',
        evidence: [],
      },
    ],
    followUp: '',
  };
  let calls = 0,
    repairChecks = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      values = [
        { mentionedPlayers: [], decision: { kind: 'queries', queries: [] } },
        bad,
        { decision: 'withhold', reason: 'Unsupported universal assessment.' },
        good,
        { decision: 'approve' },
      ];
    assert.ok(calls < 5);
    const value = reviewFixture(values[calls++], body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    };
  };
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher,
    canRepair: () => {
      repairChecks++;
      return true;
    },
  });
  assert.equal(calls, 5);
  assert.equal(repairChecks, 1);
  assert.equal(result.execution.repairs, 1);
  assert.equal(result.answer, good.claims[0].text);
  assert.deepEqual(
    result.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'answer-after-query', 'review', 'repair', 'review'],
  );
  assert.deepEqual(result.execution.usage, { promptTokens: 500, completionTokens: 100 });
});

test('planner schema binds canonical subject IDs and distinguishes all attempts from on-target filtering', async () => {
  const question = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'Compare the first and latest shots.',
  };
  const mock = directTransport(
    operationEnvelope(question, { operator: 'orderedEndpoints', metric: 'attempts', subjects: [] }),
    { decision: 'approve' },
    (packet, call, body) => {
      if (call) return;
      const properties = operationProperties(body, 'orderedEndpoints');
      assert.deepEqual(properties.subjects.anyOf, [
        { type: 'array', minItems: 0, maxItems: 0, items: { type: 'string' } },
      ]);
      assert.match(properties.subjects.description, /\[\] for the whole match/);
      assert.match(properties.metric.description, /attempts means ALL shots/);
      assert.match(properties.metric.description, /blocked, off-target/);
      assert.match(
        properties.metric.description,
        /shotsOnTarget means ONLY confirmed goals and saved shots/,
      );
      assert.match(body.messages[0].content, /Global orderedEndpoints use subjects:\[\]/);
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.proofs[0].metric, 'attempts');
  assert.equal(result.proofs[0].values.latest.actor.label, 'D. Silva');
  assert.equal(mock.count(), 2);
});

test('qualitative, roster and unary requests cannot select an unrelated typed operation', async () => {
  for (const questionText of [
    'Why did Cole not pass there?',
    'Who has been the standout so far, and why?',
    'Is Messi playing for either side?',
    'Who last played a pass with the left foot?',
    'What is the passing accuracy for each side?',
  ]) {
    const question = { kind: 'sustained', seed: 8341, time: 110, question: questionText };
    let body;
    const mock = directTransport(
      operationEnvelope(question, { metric: 'attempts' }),
      { decision: 'approve' },
      (_packet, call, request) => {
        if (!call) body = request;
      },
    );
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 1);
    if (questionText.includes('passing accuracy'))
      assert.deepEqual(
        decisionBranch(body, 'operation').properties.plan.properties.obligations.items.anyOf.map(
          (branch) => branch.properties.operator.enum,
        ),
        [['ratio']],
      );
    else assert.equal(decisionBranch(body, 'operation'), undefined);
    assert.ok(decisionBranch(body, 'queries'));
  }
});

test('operation subjects and topical metrics are constrained before execution, including duplicate subjects', async () => {
  const global = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'Compare the first and latest shots.',
  };
  const comparison = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes, and by how many?',
  };
  const named = { ...global, question: 'Compare Silva’s first and latest shots.' };
  for (const [question, options] of [
    [global, { operator: 'orderedEndpoints', metric: 'attempts', subjects: ['away-10'] }],
    [comparison, { subjects: ['home-7', 'home-8'] }],
    [comparison, { subjects: ['home', 'home'] }],
    [comparison, { metric: 'attempts' }],
    [named, { operator: 'orderedEndpoints', metric: 'attempts', subjects: ['home-10'] }],
  ]) {
    const mock = directTransport(operationEnvelope(question, options));
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 1);
  }
  const approved = directTransport(
    operationEnvelope(named, {
      operator: 'orderedEndpoints',
      metric: 'attempts',
      subjects: ['away-10'],
    }),
    { decision: 'approve' },
    (_packet, call, body) => {
      if (call) return;
      const properties = operationProperties(body, 'orderedEndpoints');
      assert.deepEqual(
        properties.subjects.anyOf.map((scope) => scope.items.enum || []),
        [[], ['away-10']],
      );
      assert.deepEqual(properties.timeFrom.enum, [0]);
      assert.deepEqual(properties.timeTo.enum, [100]);
    },
  );
  const result = await answerMatchQuestionAI(named, { config, fetcher: approved.fetcher });
  assert.ok(result.proofs[0].subjects.every((subject) => subject.id === 'away-10'));
  assert.equal(approved.count(), 2);
});

test('explicit operation windows remain available while ambiguous temporal scope uses query planning', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'In the last 30 seconds, which side has had more shots?',
  };
  const mock = directTransport(
    operationEnvelope(question, { metric: 'attempts', timeFrom: 80 }),
    { decision: 'approve' },
    (_packet, call, body) => {
      if (!call) assert.equal(operationProperties(body, 'difference').timeFrom.enum, undefined);
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.deepEqual(result.proofs[0].window, { from: 80, to: 110 });
  const ambiguous = { ...question, question: 'Which side has had more shots recently?' };
  let schema;
  const invalid = directTransport(
    operationEnvelope(ambiguous, { metric: 'attempts', timeFrom: 80 }),
    {},
    (_packet, call, body) => {
      if (!call) schema = body;
    },
  );
  await assert.rejects(
    answerMatchQuestionAI(ambiguous, { config, fetcher: invalid.fetcher }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(decisionBranch(schema, 'operation'), undefined);
});

test('plain count and list queries cannot carry grouped sorting or bounds in the wire or runtime', async () => {
  for (const aggregate of ['count', 'list']) {
    const question = {
      kind: 'sustained',
      seed: 8341,
      time: 110,
      question: 'What is the passing accuracy for each side?',
    };
    let request;
    const mock = directTransport(
      {
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'pass' },
              aggregate,
              groupCount: { min: 0 },
              groupOrder: 'count-desc',
            },
          ],
        },
      },
      {},
      (_packet, call, body) => {
        if (!call) request = body;
      },
    );
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      /lookup/,
    );
    assert.equal(mock.count(), 1);
    const [plain, grouped] = decisionBranch(request, 'queries').properties.queries.items.anyOf;
    assert.deepEqual(plain.properties.groupCount, { type: 'null' });
    assert.deepEqual(plain.properties.groupOrder, { type: 'null' });
    assert.deepEqual(plain.properties.aggregate.anyOf[0].enum, ['list', 'count']);
    assert.deepEqual(grouped.properties.aggregate.enum, ['by-player', 'by-team', 'by-assister']);
    assert.deepEqual(grouped.properties.groupCount, { type: 'null' });
  }
});

test('query event IDs require actual moment deixis and cannot narrow a broad request', async () => {
  const broad = {
    kind: 'sustained',
    seed: 17,
    time: 96,
    anchorId: input.anchorId,
    question: 'What is the passing accuracy for each side?',
  };
  let firstBody;
  const invalid = directTransport(
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { id: input.anchorId, type: 'pass' }, aggregate: 'count' }],
      },
    },
    {},
    (_packet, call, body) => {
      if (!call) firstBody = body;
    },
  );
  await assert.rejects(
    answerMatchQuestionAI(broad, { config, fetcher: invalid.fetcher }),
    /lookup/,
  );
  assert.equal(invalid.count(), 1);
  for (const schema of decisionBranch(firstBody, 'queries').properties.queries.items.anyOf)
    assert.deepEqual(schema.properties.filters.anyOf[0].properties.id, { type: 'null' });
  let calls = 0,
    writerPacket;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (!calls) {
      assert.equal(body.max_completion_tokens, 900);
      const variants = decisionBranch(body, 'queries').properties.queries.items.anyOf;
      for (const schema of variants.slice(0, -1))
        assert.deepEqual(schema.properties.filters.anyOf[0].properties.id, { type: 'null' });
      const inspection = variants.at(-1);
      assert.deepEqual(inspection.properties.filters.properties.id.enum, [input.anchorId]);
      for (const [field, schema] of Object.entries(inspection.properties.filters.properties))
        if (field !== 'id') assert.deepEqual(schema, { type: 'null' });
      value = {
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { id: input.anchorId }, aggregate: 'list' }],
        },
      };
    } else if (calls === 1) {
      writerPacket = packet;
      value = draft;
    } else value = { decision: 'approve' };
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, body)) },
          },
        ],
      }),
    };
  };
  const result = await answerMatchQuestionAI(input, { config, fetcher });
  assert.equal(calls, 3);
  assert.equal(result.status, 'answered');
  assert.equal(writerPacket.requestedEvidence[0].query.filters.id, input.anchorId);
});

test('both typed and prose review schemas require exactly the server-defined request spans', async () => {
  const comparison = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes, and how large is the difference?',
  };
  const general = { ...comparison, question: 'What is a low block, and why is it used?' };
  const definition = {
    scope: 'general',
    claims: [
      {
        text: 'A low block is a compact defensive shape near the team’s own goal, used to restrict space behind defenders.',
        kind: 'general',
        evidence: [],
      },
    ],
    followUp: '',
  };
  for (const [question, envelope] of [
    [comparison, operationEnvelope(comparison)],
    [general, { operationPlan: null, mentionedPlayers: [], draft: definition, queries: [] }],
  ]) {
    const components = requestComponents(question.question);
    assert.equal(components.length, 2);
    const mock = directTransport(envelope, { decision: 'approve' }, (_packet, call, body) => {
      if (!call) return;
      const coverage =
        body.response_format.json_schema.schema.properties.requestCheck.properties.coverage;
      assert.equal(coverage.minItems, 2);
      assert.equal(coverage.maxItems, 2);
      assert.deepEqual(coverage.items.properties.requestSpan.enum, components);
      assert.deepEqual(
        coverage.items.required.toSorted(),
        [
          'requestSpan',
          'claimIndices',
          'answerForm',
          'requestedAction',
          'temporalRelation',
          'relationAnchorClaimIndex',
          'relationEntityBinding',
          'relationSourceLinkIndex',
          'explanationTarget',
          'requestedQuantity',
          'sourceInventoryDependency',
          'requestedSourceAttributes',
        ].sort(),
      );
      assert.deepEqual(coverage.items.properties.explanationTarget.enum, [
        'none',
        'observed-sequence',
        'decision-rationale',
        'other',
      ]);
      assert.equal(coverage.items.properties.sourceInventoryDependency.type, 'null');
      assert.equal(coverage.items.properties.answerSpan, undefined);
      assert.deepEqual(coverage.items.properties.claimIndices.items.enum, [0]);
      assert.equal(coverage.items.properties.claimIndices.maxItems, 1);
    });
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(mock.count(), 2);
    assert.equal(result.provenance.modelGenerated, question === general);
  }
});

test('typed reviewer whole-question and duplicate spans fail even when canonical facts are correct', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes, and how large is the difference?',
  };
  for (const duplicate of [false, true]) {
    const mock = directTransport(operationEnvelope(question), (packet) => {
      const requestSpan = duplicate ? packet.requestComponents[0] : question.question;
      const part = { requestSpan, answerSpan: packet.answer.claims[0].text };
      return {
        decision: 'approve',
        reason: 'Incorrect coverage shape.',
        requestCheck: {
          requestedInformation: question.question,
          status: 'answered',
          coverage: duplicate ? [part, part] : [part],
          reason: 'All counts correct.',
        },
      };
    });
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-withheld',
    );
    assert.equal(mock.count(), 2);
  }
});

test('typed difference returns explicit verified margin and truthful provenance in two actual calls', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes so far, and by how many?',
  };
  const envelope = operationEnvelope(question);
  envelope.draft = {
    scope: 'match',
    claims: [{ text: 'Northbridge completed 99 passes.', kind: 'observation', evidence: [] }],
    followUp: '',
  };
  const mock = directTransport(
    envelope,
    {
      decision: 'approve',
      reason: 'The operation answers both the comparison and requested margin.',
      checks: [
        {
          claimIndex: 0,
          actors: [{ name: 'Fictional actor', action: 'pass', individualAction: true }],
          counts: [
            {
              text: '99 passes',
              value: 99,
              scopeReference: { type: 'scope', id: 'model-invented-count', revision: 1 },
              groupKey: 'home',
            },
          ],
          inventedFacts: [],
          supported: true,
          reason: 'Canonical facts answer the operation.',
        },
      ],
    },
    (packet, call) => {
      if (!call) return;
      assert.equal(packet.canonicalFacts, true);
      assert.equal(packet.operationPlan.obligations[0].operator, 'difference');
      assert.equal(packet.operationProofs[0].values.absoluteMargin, 1);
      assert.equal(packet.operationProofs[0].values.left.count, 5);
      assert.equal(packet.operationProofs[0].values.right.count, 4);
      assert.equal(
        packet.answer.claims.some((claim) => claim.text.includes('99')),
        false,
        'Premature prose must be discarded',
      );
      for (const ref of packet.answer.claims.flatMap((claim) => claim.evidence))
        assert.ok(
          packet.evidence.queryResults.some((query) => query.scopeReference.id === ref.id),
          'Reviewer references must resolve in its projected evidence',
        );
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(mock.count(), 2);
  assert.equal(result.execution.modelCalls, 2);
  assert.equal(result.execution.repairs, 0);
  assert.equal(result.proofs[0].values.absoluteMargin, 1);
  assert.equal(result.proofs[0].values.leader, 'home');
  assert.match(result.answer, /5/);
  assert.match(result.answer, /4/);
  assert.match(result.answer, /1/);
  assert.doesNotMatch(result.answer, /99|Fictional/);
  assert.equal(result.provenance.source, 'verified-operation-facts');
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.provenance.aiInterpreted, true);
  assert.equal(result.observedAt, 110);
  assert.equal(result.matchId, 'spatial-match-sustained-8341');
  assert.match(result.key, /^question:/);
  assert.deepEqual(
    result.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'review'],
  );
  assert.deepEqual(result.execution.usage, { promptTokens: 200, completionTokens: 40 });
  assert.ok(
    result.evidence.every((ref) => ref.id.startsWith('match-query-')),
    'Final evidence must retain canonical scope IDs',
  );
  assert.deepEqual(result.moments, []);
});

test('passing accuracy is computed from resolved pass outcomes with pending passes disclosed and canonical provenance', async () => {
  const question = {
    kind: 'sustained',
    seed: 84621,
    time: 110,
    question: 'What is the passing accuracy for each side?',
  };
  const snapshot = matchState(question),
    expected = ['home', 'away'].map((id) => {
      const passes = snapshot.events.filter((event) => event.type === 'pass' && event.team === id);
      const completed = passes.filter((event) => event.result === true).length,
        failed = passes.filter((event) => event.result === false).length,
        pending = passes.filter((event) => event.result === null).length;
      return {
        id,
        completed,
        failed,
        pending,
        numerator: completed,
        denominator: completed + failed,
        ratio: completed / (completed + failed),
      };
    });
  assert.deepEqual(
    expected.map(({ completed, failed, pending }) => [completed, failed, pending]),
    [
      [5, 0, 1],
      [4, 2, 0],
    ],
  );
  let reviewed;
  const mock = directTransport(
    operationEnvelope(question, { operator: 'ratio', metric: 'passCompletionRate' }),
    { decision: 'approve' },
    (packet, call, body) => {
      if (!call) {
        assert.deepEqual(operationProperties(body, 'ratio').metric.enum, ['passCompletionRate']);
        assert.equal(operationProperties(body, 'difference'), undefined);
        assert.equal(operationProperties(body, 'orderedEndpoints'), undefined);
        assert.match(body.messages[0].content, /completed\/\(completed\+failed\)/);
        assert.match(body.messages[0].content, /passing accuracy ratio3/);
      } else {
        reviewed = packet;
        assert.equal(packet.canonicalFacts, true);
        assert.equal(packet.operationProofs[0].operator, 'ratio');
        assert.equal(packet.evidence.queryResults.length, 3);
        assert.ok(
          packet.answer.claims
            .flatMap((claim) => claim.evidence)
            .every((ref) =>
              packet.evidence.queryResults.some((query) => query.scopeReference.id === ref.id),
            ),
        );
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    proof = result.proofs[0];
  assert.equal(mock.count(), 2);
  assert.equal(result.execution.modelCalls, 2);
  assert.equal(result.execution.repairs, 0);
  assert.deepEqual(
    proof.values.teams.map(({ id, completed, failed, pending, numerator, denominator, ratio }) => ({
      id,
      completed,
      failed,
      pending,
      numerator,
      denominator,
      ratio,
    })),
    expected,
  );
  assert.equal(proof.values.definition, 'completed/(completed+failed)');
  assert.equal(proof.values.pendingExcluded, true);
  assert.deepEqual(
    proof.values.teams.map((team) => team.displayPercent),
    ['100', '66.7'],
  );
  assert.equal(proof.evidence.length, 3);
  assert.ok(result.evidence.every((ref) => ref.id.startsWith('match-query-')));
  assert.match(result.answer, /100%/);
  assert.match(result.answer, /66\.7%/);
  assert.match(result.answer, /1 awaiting an outcome/);
  assert.equal(result.provenance.source, 'verified-operation-facts');
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.provenance.aiInterpreted, true);
  assert.deepEqual(result.execution.usage, { promptTokens: 200, completionTokens: 40 });
  assert.deepEqual(result.moments, []);
  assert.deepEqual(reviewed.operationProofs[0].values, proof.values);
});

test('ratio coverage uses claim identity without copying or corrupting canonical numbers', async () => {
  const question = {
    kind: 'sustained',
    seed: 84621,
    time: 110,
    question: 'What is the passing accuracy for each side?',
  };
  for (const indexed of [false, true]) {
    const mock = directTransport(
      operationEnvelope(question, { operator: 'ratio', metric: 'passCompletionRate' }),
      (packet) => ({
        decision: 'approve',
        requestCheck: {
          requestedInformation: question.question,
          status: 'answered',
          reason: 'The canonical ratio answers both teams.',
          coverage: [
            {
              requestSpan: packet.requestComponents[0],
              ...(indexed
                ? { claimIndices: [0] }
                : {
                    answerSpan: packet.answer.claims[0].text.replace(
                      '5 completed of 5',
                      '\t6 completed of 5',
                    ),
                  }),
            },
          ],
        },
      }),
    );
    if (indexed) {
      const answer = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
      assert.match(answer.answer, /5 completed of 5/);
      assert.doesNotMatch(answer.answer, /6 completed of 5/);
      assert.equal(answer.provenance.modelGenerated, false);
    } else
      await assert.rejects(
        answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
        (error) => error.code === 'question-withheld',
      );
    assert.equal(mock.count(), 2);
  }
});

test('valid claim indices never override a semantic relevance rejection', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which team has completed more passes?',
  };
  const mock = directTransport(operationEnvelope(question), (packet) => ({
    decision: 'approve',
    requestCheck: {
      requestedInformation: question.question,
      status: 'not-answered',
      reason: 'These claims do not fulfill the requested context.',
      coverage: packet.requestComponents.map((requestSpan) => ({ requestSpan, claimIndices: [0] })),
    },
  }));
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(mock.count(), 2);
});

test('zero resolved passes produce no percentage and ratio cannot switch metric or player scope', async () => {
  const question = {
    kind: 'quiet',
    seed: 84621,
    time: 0,
    question: 'What is the passing accuracy for each side?',
  };
  const mock = directTransport(
    operationEnvelope(question, { operator: 'ratio', metric: 'passCompletionRate' }),
    { decision: 'approve' },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  for (const team of result.proofs[0].values.teams) {
    assert.equal(team.denominator, 0);
    assert.equal(team.ratio, null);
    assert.equal(team.percentage, null);
    assert.equal(team.displayPercent, null);
  }
  assert.doesNotMatch(result.answer, /\d\s*%/);
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(mock.count(), 2);
  for (const options of [
    { operator: 'ratio', metric: 'completedPasses' },
    { operator: 'difference', metric: 'passCompletionRate' },
    { operator: 'ratio', metric: 'passCompletionRate', subjects: ['home-7'] },
  ]) {
    const invalid = directTransport(operationEnvelope(question, options));
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: invalid.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(invalid.count(), 1);
  }
  const single = { ...question, time: 110, question: 'What is Northbridge’s passing accuracy?' };
  const selected = directTransport(
    operationEnvelope(single, {
      operator: 'ratio',
      metric: 'passCompletionRate',
      subjects: ['home'],
    }),
    { decision: 'approve' },
  );
  const answer = await answerMatchQuestionAI(single, { config, fetcher: selected.fetcher });
  assert.deepEqual(
    answer.proofs[0].values.teams.map((team) => team.id),
    ['home'],
  );
  assert.equal(selected.count(), 2);
});

test('writer and reviewer receive applicability and epistemic policies without adding them to the planner', async () => {
  for (const questionText of ['What is offside?', 'Why did Cole not pass there?']) {
    const question = { kind: 'sustained', seed: 17, time: 90, question: questionText };
    let calls = 0;
    const definition = {
      scope: 'general',
      claims: [
        {
          text: 'An offside position alone is not an offense; active involvement is also required.',
          kind: 'general',
          evidence: [],
        },
      ],
      followUp: '',
    };
    const limitation = {
      scope: 'match',
      claims: [
        {
          text: 'I cannot tell why Cole did not pass from the recorded actions.',
          kind: 'limitation',
          evidence: [],
        },
      ],
      followUp: '',
    };
    const fetcher = async (_url, options) => {
      const body = JSON.parse(options.body);
      let value;
      if (calls === 0) {
        assert.doesNotMatch(
          body.messages[0].content,
          /A useful rules definition|An absent recorded action/,
        );
        value = { mentionedPlayers: [], decision: { kind: 'queries', queries: [] } };
      } else {
        assert.match(body.messages[0].content, /additional action or involvement/);
        assert.match(
          body.messages[0].content,
          /An absent recorded action does not prove absence of possession, control, time, options or opportunity/,
        );
        assert.match(body.messages[0].content, /45 words or fewer/);
        value =
          calls === 1
            ? questionText.startsWith('What')
              ? definition
              : limitation
            : { decision: 'approve' };
      }
      calls++;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(reviewFixture(value, body)) },
            },
          ],
        }),
      };
    };
    const result = await answerMatchQuestionAI(question, { config, fetcher });
    assert.equal(calls, 3);
    assert.equal(result.provenance.modelGenerated, true);
  }
});

test('typed comparisons preserve reversed operands, ties and explicitly requested player subjects', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Compare the teams’ completed pass totals and their difference.',
  };
  for (const [subjects, time, counts, leader] of [
    [['away', 'home'], 110, [4, 5], 'home'],
    [['home', 'away'], 0, [0, 0], null],
    [['home-7', 'home-8'], 110, [4, 1], 'home-7'],
  ]) {
    const request = {
        ...question,
        time,
        ...(subjects[0] === 'home-7'
          ? { question: 'Compare Cole and Mensah in completed pass totals and their difference.' }
          : {}),
      },
      mock = directTransport(operationEnvelope(request, { subjects }), { decision: 'approve' });
    const result = await answerMatchQuestionAI(request, { config, fetcher: mock.fetcher }),
      values = result.proofs[0].values;
    assert.deepEqual([values.left.count, values.right.count], counts);
    assert.equal(values.signedDelta, counts[0] - counts[1]);
    assert.equal(values.leader, leader);
    assert.equal(values.tie, counts[0] === counts[1]);
    assert.equal(mock.count(), 2);
  }
});

test('a single operation binds a bad model source span to the full question with an audit trace', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes so far, and by how many?',
  };
  const envelope = operationEnvelope(question);
  envelope.operationPlan.obligations[0].requestSpan = '0..110';
  const mock = directTransport(envelope, { decision: 'approve' }, (packet, call) => {
    if (!call) return;
    assert.equal(packet.operationPlan.obligations[0].requestSpan, question.question);
    assert.equal(packet.operationProofs[0].requestSpan, question.question);
    assert.equal(packet.operationPlanNormalization[0].original, '0..110');
    assert.equal(packet.evidence.question, question.question);
  });
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.proofs[0].values.absoluteMargin, 1);
  assert.equal(result.proofs[0].requestSpan, question.question);
  assert.equal(result.operationPlanNormalization[0].original, '0..110');
  assert.equal(result.operationPlanNormalization[0].applied, question.question);
  assert.equal(
    envelope.operationPlan.obligations[0].requestSpan,
    '0..110',
    'Keep the received model object unchanged',
  );
  assert.equal(mock.count(), 2);
});

test('normalizing a single source span cannot license an omitted qualitative request', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Compare the completed pass counts and explain why the teams differ.',
  };
  const envelope = operationEnvelope(question);
  envelope.operationPlan.obligations[0].requestSpan = '0..110';
  const mock = directTransport(
    envelope,
    {
      decision: 'withhold',
      reason: 'The whole question additionally requires an explanation.',
      requestCheck: {
        requestedInformation: 'Difference and explanation',
        status: 'not-answered',
        coverage: [],
        reason: 'The why component is not answered.',
      },
    },
    (packet, call) => {
      if (call) assert.equal(packet.operationPlan.obligations[0].requestSpan, question.question);
    },
  );
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(mock.count(), 1);
});

test('multiple operation spans stay strict and single-span normalization never repairs invalid metrics', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Compare the teams’ completed passes and attempts.',
  };
  for (const multiple of [true, false]) {
    const envelope = operationEnvelope(question);
    envelope.operationPlan.obligations[0].requestSpan = '0..110';
    if (multiple)
      envelope.operationPlan.obligations.push({
        ...envelope.operationPlan.obligations[0],
        id: 'second',
        metric: 'attempts',
      });
    else envelope.operationPlan.obligations[0].metric = 'invented-pressure';
    const mock = directTransport(envelope);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 1);
  }
});

test('typed endpoints render both actual global outcomes and preserve a pending latest revision', async () => {
  for (const [question, firstName, lastName, pending] of [
    [
      {
        kind: 'interrupted',
        seed: 8341,
        time: 100,
        question: 'Compare the first attempt with the latest one.',
      },
      'A. Reed',
      'D. Silva',
      false,
    ],
    [
      {
        kind: 'counter',
        seed: 9193,
        time: 116,
        question: 'How did the earliest and latest attempts end?',
      },
      'D. Silva',
      'A. Reed',
      true,
    ],
  ]) {
    const mock = directTransport(
      operationEnvelope(question, {
        operator: 'orderedEndpoints',
        metric: 'attempts',
        subjects: [],
      }),
      { decision: 'approve' },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.ok(result.answer.includes(firstName));
    assert.ok(result.answer.includes(lastName));
    assert.equal(result.proofs[0].values.first.actor.label, firstName);
    assert.equal(result.proofs[0].values.latest.actor.label, lastName);
    assert.equal(result.moments.length, 2);
    assert.equal(mock.count(), 2);
    if (pending) {
      assert.match(result.answer, /pending|await|unknown|unconfirmed/i);
      assert.equal(result.proofs[0].values.latest.event.revision, 1);
    } else {
      assert.match(result.answer, /saved/i);
      assert.match(result.answer, /blocked/i);
    }
  }
});

test('malformed supplied operation plans fail before review rather than falling back to prose', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Compare the teams’ completed pass counts.',
  };
  for (const mutate of [
    (plan) => ({ ...plan, version: 99 }),
    (plan) => ({ ...plan, obligations: [{ ...plan.obligations[0], operator: 'run-code' }] }),
    (plan) => ({ ...plan, obligations: [{ ...plan.obligations[0], subjects: ['home', 'Messi'] }] }),
    (plan) => ({ ...plan, obligations: [{ ...plan.obligations[0], timeTo: 999 }] }),
    () => ({}),
  ]) {
    const envelope = operationEnvelope(question);
    envelope.operationPlan = mutate(envelope.operationPlan);
    const mock = directTransport(envelope);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-operation',
    );
    assert.equal(mock.count(), 1);
  }
});

test('a relevant proof is insufficient when operation selection omits a qualitative request', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Compare the completed pass counts and explain why the teams differ.',
  };
  const mock = directTransport(operationEnvelope(question), {
    decision: 'withhold',
    reason: 'The computed difference does not explain why.',
    requestCheck: {
      requestedInformation: 'Comparison and causal explanation',
      status: 'not-answered',
      coverage: [],
      reason: 'The causal component is missing.',
    },
  });
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher, canRepair: () => false }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(mock.count(), 1);
});

test('an unrequested narrowed operation window is rejected before execution and review', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes and what is the margin?',
  };
  const mock = directTransport(operationEnvelope(question, { timeTo: 20 }), {
    decision: 'withhold',
    reason: 'The request concerns the whole observed passage.',
    requestCheck: {
      requestedInformation: 'Completed pass difference',
      status: 'not-answered',
      coverage: [],
      reason: 'Wrong window selected.',
    },
  });
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-invalid-operation',
  );
  assert.equal(mock.count(), 1);
});

test('typed facts cannot bypass an explicit semantic warning inside a contradictory approval', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes and what is the margin?',
  };
  const mock = directTransport(operationEnvelope(question), {
    decision: 'approve',
    reason: 'Contradictory approval.',
    checks: [
      {
        claimIndex: 0,
        actors: [],
        counts: [],
        inventedFacts: ['The operation does not represent the intended comparison.'],
        supported: true,
        reason: 'A semantic warning still requires withholding.',
      },
    ],
  });
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(mock.count(), 2);
});

test('empty complete endpoint scope produces verified absence rather than an invented action', async () => {
  const question = {
    kind: 'quiet',
    seed: 2969,
    time: 120,
    question: 'Compare the first and last attempts.',
  };
  const mock = directTransport(
    operationEnvelope(question, { operator: 'orderedEndpoints', metric: 'attempts', subjects: [] }),
    { decision: 'approve' },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.proofs[0].values.count, 0);
  assert.equal(result.proofs[0].values.first, null);
  assert.equal(result.proofs[0].values.latest, null);
  assert.match(result.answer, /No attempts/i);
  assert.deepEqual(result.moments, []);
  assert.equal(mock.count(), 2);
});

test('null and empty operation plans preserve the ordinary general-prose path', async () => {
  const question = { ...input, question: 'What is a low block?' },
    answer = {
      scope: 'general',
      claims: [
        {
          text: 'A low block is a defensive shape close to the team’s own goal.',
          kind: 'general',
          evidence: [],
        },
      ],
      followUp: '',
    };
  for (const operationPlan of [null, { version: 1, obligations: [] }]) {
    const mock = directTransport(
      { mentionedPlayers: [], operationPlan, draft: answer, queries: [] },
      { decision: 'approve' },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.scope, 'general');
    assert.equal(result.provenance.modelGenerated, true);
    assert.equal(result.proofs, undefined);
    assert.equal(mock.count(), 2);
  }
});

test('roster facts retain evidence without offering an irrelevant replay button', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 3,
    question: 'What team does J. Cole play for?',
  };
  const event = executeMatchQuery(
    { kind: question.kind, seed: question.seed, time: question.time },
    { filters: { type: 'recovery' }, aggregate: 'list' },
  ).rows[0];
  const rosterAnswer = {
    scope: 'match',
    claims: [
      { text: 'J. Cole plays for Northbridge.', kind: 'observation', evidence: event.evidence },
    ],
    followUp: '',
  };
  const mock = directTransport(
    { mentionedPlayers: ['J. Cole'], draft: rosterAnswer, queries: [] },
    {
      decision: 'approve',
      reason: 'The lineup supports this roster fact.',
      checks: [
        {
          claimIndex: 0,
          actors: [{ name: 'J. Cole', action: 'other', individualAction: false }],
          counts: [],
          inventedFacts: [],
          supported: true,
          reason: 'The roster identifies his team.',
        },
      ],
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.moments, []);
  assert.equal(result.totalMoments, 0);
  assert.equal(result.truncated, false);
});

test('a standalone roster assertion suppresses replay despite incorrect reviewer action classification', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 20,
    question: 'What team does J. Cole play for?',
  };
  const event = executeMatchQuery(
    { kind: question.kind, seed: question.seed, time: question.time },
    { filters: { type: 'pass', result: true }, aggregate: 'list' },
  ).rows[0];
  for (const text of [
    'J. Cole plays for the home team, Northbridge.',
    'J. Cole plays for Northbridge and completed the pass.',
  ]) {
    const answer = {
      scope: 'match',
      claims: [{ text, kind: 'observation', evidence: event.evidence }],
      followUp: '',
    };
    const mock = directTransport(
      { mentionedPlayers: ['J. Cole'], draft: answer, queries: [] },
      {
        decision: 'approve',
        reason: 'The supplied roster and event support the answer.',
        checks: [
          {
            claimIndex: 0,
            actors: [{ name: 'J. Cole', action: 'pass', individualAction: true }],
            counts: [],
            supported: true,
            reason: 'Cole is identified in the roster and cited pass.',
          },
        ],
      },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.evidence.length, 1);
    assert.equal(
      result.moments.length,
      text.includes('completed') ? 1 : 0,
      'Only a standalone membership assertion is excluded',
    );
  }
});
test('accidental fragments ask for clarification without guessing a player or spending model calls', async () => {
  for (const question of ['j', 'J?', 'x', '???', '...']) {
    const result = await answerMatchQuestionAI(
      { ...input, question },
      {
        config,
        fetcher: async () => {
          throw new Error('Unexpected model call');
        },
      },
    );
    assert.equal(result.scope, 'clarify');
    assert.equal(result.execution.modelCalls, 0);
    assert.match(result.answer, /clarify/);
    assert.deepEqual(result.evidence, []);
    assert.deepEqual(result.moments, []);
    assert.equal(result.provenance.modelGenerated, false);
    assert.doesNotMatch(result.answer, /Cole|recovery|shots/);
  }
  const translated = await answerMatchQuestionAI(
    { ...input, question: 'j', language: 'es' },
    { config },
  );
  assert.match(translated.answer, /aclarar/);
});
test('short meaningful questions and contextual fragments remain model interpreted', async () => {
  for (const [question, conversation] of [
    ['Score?', []],
    ['VAR?', []],
    ['Why?', []],
    ['Cole', []],
    ['asdfgh', []],
  ]) {
    let reached = false;
    await assert.rejects(
      answerMatchQuestionAI(
        { ...input, question, conversation },
        {
          config,
          fetcher: async (_url, options) => {
            reached = true;
            const policy = JSON.parse(options.body).messages[0].content;
            assert.match(policy, /Do not invent a question/);
            throw new Error('Intent model reached');
          },
        },
      ),
    );
    assert.equal(reached, true, question);
  }
});
const draft = {
  scope: 'match',
  claims: [
    { text: 'Reed put this attempt off target.', kind: 'observation', evidence: [ref] },
    {
      text: 'The feed does not show his contact with the ball, so it cannot establish the technical reason for the miss.',
      kind: 'limitation',
      evidence: [],
    },
  ],
  followUp: '',
};
test('unsupported causal assertion is withheld even when the reviewer would approve it', async () => {
  const bad = structuredClone(draft);
  bad.claims[0].text = 'Cole forced the turnover by recovering the ball.';
  const mock = transport([bad, { decision: 'approve' }]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-unsupported-cause',
  );
  assert.equal(mock.count(), 2);
});
test('analyst receives capability limits and reviewer sees the exact cited record', async () => {
  const mock = transport([draft, { decision: 'approve' }], (body, call) => {
    const packet = JSON.parse(body.messages.at(-1).content);
    if (!call)
      assert.ok(
        packet.evidenceCapabilities.unavailable.includes('who forced a mistake or turnover'),
      );
    else {
      const cited = packet.claimChecks[0].cited[0];
      assert.deepEqual(cited.reference, ref);
      assert.equal(cited.record, undefined);
      const record = [
        ...packet.evidence.queryResults.flatMap((q) => q.rows),
        ...packet.evidence.linkedContext.rows,
      ].find((r) => r.id === ref.id);
      assert.equal(record.outcome, 'off-target');
      assert.match(packet.reviewConstraints.forcedErrorAttribution, /unavailable/);
    }
  });
  await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
});
function transport(
  values,
  inspect = () => {},
  queries = [{ filters: { type: 'shot' }, aggregate: 'list' }],
) {
  values = [{ queries }, ...values];
  let calls = 0;
  return {
    count: () => calls,
    fetcher: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (calls) inspect(request, calls - 1);
      const source = values[calls++],
        value = typeof source === 'function' ? source(request) : source;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    },
  };
}
test('open fan question produces grounded prose followed by independent editorial review', async () => {
  const mock = transport([draft, { decision: 'approve' }], (body, call) => {
    const packet = JSON.parse(body.messages.at(-1).content);
    if (!call) {
      assert.equal(packet.question, input.question);
      assert.ok(
        packet.queryResults.flatMap((q) => q.rows).every((e) => e.arrivedAt <= 96 && e.time <= 96),
      );
      assert.ok(packet.queryResults.every((q) => q.scopeReference.type === 'scope'));
    } else assert.equal(packet.answer.claims[0].text, draft.claims[0].text);
  });
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(mock.count(), 3);
  assert.equal(answer.provenance.modelGenerated, true);
  assert.equal(answer.scope, 'match');
  assert.equal(answer.moments[0].anchorId, input.anchorId);
  assert.match(answer.answer, /technical reason/);
  assert.deepEqual(answer.execution.usage, { promptTokens: 300, completionTokens: 60 });
});
test('why Cole did not pass reaches the model rather than a predetermined refusal', async () => {
  const mock = transport([
    {
      scope: 'match',
      claims: [
        {
          kind: 'limitation',
          text: 'The feed cannot tell us what Cole intended; it records his actions rather than his decisions.',
          evidence: [],
        },
      ],
      followUp: 'Do you mean his recovery before the shot?',
    },
    { decision: 'approve' },
  ]);
  const answer = await answerMatchQuestionAI(
    { ...input, question: 'Why did Cole not pass?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(mock.count(), 3);
  assert.equal(answer.followUp, '');
});
test('unavailable and stale citations fail before review', async () => {
  for (const evidence of [[{ ...ref, revision: 2 }], [{ ...ref, id: 'future' }], []]) {
    const bad = structuredClone(draft);
    bad.claims[0].evidence = evidence;
    const mock = transport([bad]);
    await assert.rejects(answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }));
    assert.equal(mock.count(), 2);
  }
});
test('reviewer withholding prevents supported IDs from laundering unsupported causal prose', async () => {
  const bad = structuredClone(draft);
  bad.claims[0].text = 'Reed missed because he lost concentration.';
  const mock = transport([bad, { decision: 'withhold' }]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    /could not support/,
  );
  assert.equal(mock.count(), 3);
});
test('general concepts remain separate from match observations', async () => {
  const general = {
    scope: 'general',
    claims: [
      {
        kind: 'general',
        text: 'A high press aims to win the ball close to the opposing goal.',
        evidence: [],
      },
    ],
    followUp: '',
  };
  const mock = transport([general, { decision: 'approve' }]);
  const answer = await answerMatchQuestionAI(
    { ...input, question: 'What is a high press?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(answer.scope, 'general');
  assert.deepEqual(answer.evidence, []);
  assert.deepEqual(answer.moments, []);
  const bad = { ...draft, scope: 'general' };
  const normalized = await answerMatchQuestionAI(input, {
    config,
    fetcher: transport([bad, { decision: 'approve' }]).fetcher,
  });
  assert.equal(normalized.scope, 'match');
});
test('follow-up context stays bounded and withdrawals do not generate new explanations', async () => {
  const mock = transport([draft, { decision: 'approve' }], (body, call) => {
    if (!call)
      assert.equal(
        JSON.parse(body.messages.at(-1).content).previousQuestion,
        'Who is pushing more?',
      );
  });
  await answerMatchQuestionAI(
    { ...input, question: 'And why?', previousQuestion: 'Who is pushing more?' },
    { config, fetcher: mock.fetcher },
  );
  const never = async () => {
    throw new Error('Must not call');
  };
  await assert.rejects(
    answerMatchQuestionAI(
      { ...input, previousQuestion: 'x'.repeat(401) },
      { config, fetcher: never },
    ),
  );
  const missing = await answerMatchQuestionAI({ ...input, time: 95 }, { config, fetcher: never });
  assert.equal(missing.status, 'no-results');
});

test('match prose cannot turn source seconds into impossible match minutes', async () => {
  const bad = structuredClone(draft);
  bad.claims[0].text = 'Reed missed in the 96th minute.';
  const mock = transport([bad]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    /incorrect match time/,
  );
  assert.equal(mock.count(), 2);
});

test('zero-goal answer cites an executed inventory query rather than inventing an event', async () => {
  const mock = transport([
    (request) => {
      const packet = JSON.parse(request.messages.at(-1).content),
        goals = packet.queryResults.find((q) => q.query.filters.result === true);
      assert.equal(goals.count, 0);
      return {
        scope: 'match',
        claims: [
          {
            text: 'Nobody has scored yet; it is 0-0.',
            kind: 'observation',
            evidence: [goals.scopeReference],
          },
        ],
        followUp: '',
      };
    },
    { decision: 'approve' },
  ]);
  const answer = await answerMatchQuestionAI(
    { ...input, question: 'Who scored?' },
    { config, fetcher: mock.fetcher },
  );
  assert.match(answer.answer, /Nobody/);
  assert.equal(answer.evidence[0].type, 'scope');
  assert.deepEqual(answer.moments, []);
});

test('conversation memory is bounded and cannot carry answers from a future replay time', async () => {
  const never = async () => {
    throw new Error('must not call');
  };
  for (const conversation of [
    [{ question: 'Who scored?', answer: 'A goal later', time: 118 }],
    [{ question: 'q', answer: 'x'.repeat(501), time: 10 }],
    Array.from({ length: 3 }, () => ({ question: 'q', answer: 'a', time: 1 })),
  ])
    await assert.rejects(
      answerMatchQuestionAI({ ...input, conversation }, { config, fetcher: never }),
    );
});

test('selected response language reaches analyst and reviewer and labels the answer', async () => {
  const spanish = {
    scope: 'match',
    claims: [{ text: 'Reed dispara fuera.', kind: 'observation', evidence: [ref] }],
    followUp: '',
  };
  const mock = transport([spanish, { decision: 'approve' }], (body, call) => {
    const packet = JSON.parse(body.messages.at(-1).content);
    assert.equal(call ? packet.evidence.responseLanguage : packet.responseLanguage, 'es');
    assert.match(body.messages[0].content, call ? /withhold final-score/ : /never call it final/);
  });
  const answer = await answerMatchQuestionAI(
    { ...input, language: 'es', question: 'Que paso?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(answer.language, 'es');
  assert.equal(answer.answer, 'Reed dispara fuera.');
  assert.equal(mock.count(), 3);
});

test('Spanish and Portuguese minute claims cannot hide a seconds-to-minutes error', async () => {
  const bad = structuredClone(draft);
  bad.claims[0].text = 'Reed fallo a los 96 minutos.';
  await assert.rejects(
    answerMatchQuestionAI(
      { ...input, language: 'es' },
      { config, fetcher: transport([bad]).fetcher },
    ),
    /incorrect match time/,
  );
});

test('explicit current-moment deixis supplies an anchor and the writer receives its actual evidence', async () => {
  const requestInput = {
    kind: 'sustained',
    seed: 17,
    time: 90,
    anchorId: 'comparison-sustained-17-pass-90',
    question: 'What is happening now?',
  };
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0) {
      assert.equal(packet.players.length, 22);
      assert.ok(packet.players.some((p) => p.id === 'home-5'));
      assert.deepEqual(packet.selectedMoment, {
        id: 'comparison-sustained-17-pass-90',
        type: 'pass',
        time: 90,
      });
      assert.equal(packet.queryResults, undefined);
      value = { queries: [] };
    } else if (calls === 1) {
      const latest = packet.queryResults
        .find((q) => q.rows.some((r) => r.id === packet.selectedAnchor))
        .rows.find((r) => r.id === packet.selectedAnchor);
      assert.equal(latest.type, 'pass');
      assert.ok(packet.queryResults.some((q) => q.query.timeFrom === 70 && q.query.limit === 8));
      assert.ok(
        packet.queryResults.flatMap((q) => q.rows).every((e) => e.time <= 90 && e.arrivedAt <= 90),
      );
      value = {
        scope: 'match',
        claims: [
          {
            text: 'Mensah has played the ball towards Reed.',
            kind: 'observation',
            evidence: latest.evidence,
          },
        ],
        followUp: '',
      };
    } else value = { decision: 'approve' };
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
          },
        ],
      }),
    };
  };
  const answer = await answerMatchQuestionAI(requestInput, { config, fetcher });
  assert.equal(calls, 3);
  assert.match(answer.answer, /Mensah/);
});

test('aggregate evidence stays compact while complete counts retain a citable scope', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0)
      value = { queries: [{ filters: { type: 'pass', result: true }, aggregate: 'by-player' }] };
    else if (calls === 1) {
      const totals = wireQueries(packet).find(
        (q) => q.query.aggregate === 'by-player' && q.query.filters.type === 'pass',
      );
      assert.deepEqual(totals.rows, []);
      assert.ok(totals.count > 0);
      assert.equal(totals.scopeReference.type, 'scope');
      assert.ok(totals.groups.every((g) => g.evidence === undefined));
      value = {
        scope: 'match',
        claims: [
          {
            text: `There have been ${totals.count} completed passes.`,
            kind: 'observation',
            evidence: [totals.scopeReference],
          },
        ],
        followUp: '',
      };
    } else {
      const totals = packet.evidence.queryResults.find(
        (q) => q.scopeReference.id === packet.answer.claims[0].evidence[0].id,
      );
      value = {
        decision: 'approve',
        reason: 'Mock complete pass inventory',
        checks: [
          {
            claimIndex: 0,
            actors: [],
            counts: [
              {
                text: totals.count + ' completed passes',
                value: totals.count,
                scopeReference: totals.scopeReference,
                groupKey: null,
              },
            ],
            inventedFacts: [],
            supported: true,
            reason: 'Complete pass count',
          },
        ],
      };
    }
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
          },
        ],
      }),
    };
  };
  const answer = await answerMatchQuestionAI(
    { ...input, question: 'How many completed passes?' },
    { config, fetcher },
  );
  assert.equal(calls, 3);
  assert.equal(answer.evidence[0].type, 'scope');
});

test('a historical question follows its retrieved shot and actual buildup rather than the current highlight', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0) {
      assert.equal(packet.recentActions, undefined);
      assert.equal(packet.selectedMoment, undefined);
      assert.equal(packet.queryResults, undefined);
      value = { queries: [{ filters: { type: 'shot' }, order: 'asc', limit: 1 }] };
    } else if (calls === 1) {
      assert.equal(packet.focusAnchor, 'comparison-sustained-17-shot-16');
      const pass = packet.linkedContext.rows.find(
        (e) => e.id === 'comparison-sustained-17-pass-10',
      );
      assert.ok(pass);
      value = {
        scope: 'match',
        claims: [
          {
            text: 'Cole supplied Reed before the first shot.',
            kind: 'observation',
            evidence: pass.evidence,
          },
        ],
        followUp: '',
      };
    } else value = { decision: 'approve' };
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
          },
        ],
      }),
    };
  };
  const result = await answerMatchQuestionAI(
    { kind: 'sustained', seed: 17, time: 118, question: 'Who set up the first shot?' },
    { config, fetcher },
  );
  assert.equal(calls, 3);
  assert.equal(result.moments[0].anchorId, 'comparison-sustained-17-pass-10');
});
test('short scope handles restore canonical query references after review', async () => {
  let canonical;
  const mock = transport([
    (request) => {
      const packet = JSON.parse(request.messages.at(-1).content);
      const goals = packet.queryResults.find((q) => q.query.filters.result === true);
      assert.match(goals.scopeReference.id, /^scope-[a-z0-9-]+-\d+$/);
      assert.equal(goals.scope.reference, undefined, 'The scope identity is supplied once.');
      assert.ok(Object.hasOwn(goals.scope, 'inventoryCount'));
      assert.ok(Object.hasOwn(goals.scope, 'missingFields'));
      return {
        scope: 'match',
        claims: [
          { text: 'Nobody has scored yet.', kind: 'observation', evidence: [goals.scopeReference] },
        ],
        followUp: '',
      };
    },
    (request) => {
      const packet = JSON.parse(request.messages.at(-1).content);
      assert.match(packet.answer.claims[0].evidence[0].id, /^scope-[a-z0-9-]+-\d+$/);
      return { decision: 'approve' };
    },
  ]);
  const answer = await answerMatchQuestionAI(
    { ...input, time: 0, anchorId: undefined, question: 'Who scored?' },
    { config, fetcher: mock.fetcher },
  );
  canonical = answer.evidence[0];
  assert.match(canonical.id, /^match-query-[a-f0-9]{64}$/);
  assert.deepEqual(answer.claims[0].evidence[0], canonical);
  assert.ok(answer.lookups.some((q) => q.scope.reference.id === canonical.id));
});
test('invented short scope handles still fail evidence validation', async () => {
  const mock = transport([
    {
      scope: 'match',
      claims: [
        {
          text: 'Nobody has scored.',
          kind: 'observation',
          evidence: [{ type: 'scope', id: 'scope-999', revision: 1 }],
        },
      ],
      followUp: '',
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    /unavailable or outdated/,
  );
  assert.equal(mock.count(), 2);
});
test('planner filter placement is normalized without changing query meaning', async () => {
  let call = 0;
  const fetcher = async (_url, options) => {
    const packet = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
    const values = [
      {
        queries: [
          {
            type: 'shot',
            filters: { timeFrom: 0, timeTo: 118 },
            aggregate: 'by-player',
            groupOrder: 'count-desc',
            limit: 1,
          },
        ],
      },
      null,
      { decision: 'approve' },
    ];
    let value = values[call++];
    if (call === 2) {
      const result = packet.queryResults.find(
        (q) => q.query.aggregate === 'by-player' && q.query.filters.result === undefined,
      );
      assert.equal(result.query.filters.type, 'shot');
      assert.equal(result.query.timeTo, 118);
      assert.equal(result.query.filters.timeTo, undefined);
      value = {
        scope: 'match',
        claims: [
          {
            text: 'Reed has the most recorded shots.',
            kind: 'observation',
            evidence: [result.scopeReference],
          },
        ],
        followUp: '',
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
          },
        ],
      }),
    };
  };
  const answer = await answerMatchQuestionAI(
    { ...input, time: 118, question: 'Who has the most shots?' },
    { config, fetcher },
  );
  assert.equal(answer.status, 'answered');
});
test('conflicting planner filters fail closed before answer generation', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ queries: [{ type: 'shot', filters: { type: 'pass' } }] }),
            },
          },
        ],
      }),
    };
  };
  await assert.rejects(answerMatchQuestionAI(input, { config, fetcher }), /could not complete/);
  assert.equal(calls, 1);
});
test('planner windows are clipped to the question timestamp without exposing future events', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    const packet = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
    let value;
    if (calls === 0)
      value = { queries: [{ filters: { type: 'pass' }, timeFrom: 0, timeTo: 10, limit: 1 }] };
    else if (calls === 1) {
      const passes = packet.queryResults.find((q) => q.query.filters.type === 'pass');
      assert.equal(passes.query.timeTo, 0);
      assert.equal(passes.count, 0);
      assert.deepEqual(passes.rows, []);
      value = {
        scope: 'match',
        claims: [
          {
            text: 'No pass has been recorded yet.',
            kind: 'observation',
            evidence: [passes.scopeReference],
          },
        ],
        followUp: '',
      };
    } else
      value = {
        decision: 'approve',
        reason: 'Empty clipped pass scope',
        checks: [
          {
            claimIndex: 0,
            actors: [],
            counts: [
              {
                text: 'No pass',
                value: 0,
                groupKey: null,
                scopeReference: packet.answer.claims[0].evidence[0],
              },
            ],
            inventedFacts: [],
            supported: true,
            reason: 'No received pass',
          },
        ],
      };
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
          },
        ],
      }),
    };
  };
  const result = await answerMatchQuestionAI(
    { kind: 'duel', seed: 1001, time: 0, question: 'Who made the first pass?' },
    { config, fetcher },
  );
  assert.equal(result.observedAt, 0);
  assert.match(result.answer, /No pass/);
});

test('every answer receives complete recent team counts even if planner omits comparison', async () => {
  const mock = transport([draft, { decision: 'approve' }], (body, call) => {
    if (call) return;
    const packet = JSON.parse(body.messages.at(-1).content);
    assert.equal(packet.recentComparison.from, '01:06');
    assert.equal(packet.recentComparison.to, '01:36');
    for (const metric of packet.recentComparison.metrics) {
      const expected = executeMatchQuery(
        { kind: input.kind, seed: input.seed, time: input.time },
        { filters: metric.filters, aggregate: 'by-team', timeFrom: 66, timeTo: 96 },
      );
      assert.deepEqual(
        metric.teams,
        expected.groups.map((g) => ({ team: g.key, count: g.count })),
      );
      assert.ok(packet.queryResults.some((q) => q.scopeReference.id === metric.evidence[0].id));
    }
  });
  await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
});

test('omitted revision resolves only an exact available reference while explicit stale revisions still fail', async () => {
  const value = structuredClone(draft);
  delete value.claims[0].evidence[0].revision;
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: transport([value, { decision: 'approve' }]).fetcher,
  });
  assert.equal(result.claims[0].evidence[0].revision, 1);
  value.claims[0].evidence[0].id = 'not-a-received-event';
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: transport([value]).fetcher }),
    /unavailable/,
  );
});

function directTransport(first, review = { decision: 'approve' }, inspect = () => {}) {
  let calls = 0;
  return {
    count: () => calls,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body),
        packet = JSON.parse(body.messages.at(-1).content),
        call = calls++;
      assert.equal(body.temperature, 0);
      inspect(packet, call, body);
      assert.ok(call < 2, 'A directly supported answer must not make a third model call.');
      const source = call === 0 ? first : review,
        value = typeof source === 'function' ? source(packet) : source;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    },
  };
}

test('retrieved player assessment keeps complete contributions grounded through answer and review', async () => {
  let chosen, scopeId;
  const mock = transport(
    [
      (request) => {
        const packet = JSON.parse(request.messages.at(-1).content);
        assert.equal(packet.roster.length, 22);
        assert.equal(packet.requestedEvidence[0].query.aggregate, 'by-player');
        assert.equal(packet.playerContributions.from, '00:00');
        assert.equal(packet.playerContributions.to, '01:36');
        assert.deepEqual(
          packet.playerContributions.metrics.map((m) => m.name),
          [
            'goals',
            'shots',
            'shotsOnTarget',
            'creditedAssists',
            'completedPasses',
            'recoveries',
            'savedAttemptCollections',
          ],
        );
        for (const metric of packet.playerContributions.metrics)
          for (const evidence of metric.evidence) {
            const query = wireQueries(packet).find((q) => q.scopeReference.id === evidence.id);
            assert.ok(query);
            assert.equal(query.truncated, false);
            const actual = executeMatchQuery(
              { kind: input.kind, seed: input.seed, time: input.time },
              query.query,
            );
            assert.deepEqual(
              query.groups.map(({ key, count }) => ({ key, count })),
              actual.groups.map(({ key, count }) => ({ key, count })),
            );
            assert.equal(query.count, actual.count);
          }
        const metric = packet.playerContributions.metrics.find((m) => m.name === 'shots');
        const shots = wireQueries(packet).find(
          (q) => q.scopeReference.id === metric.evidence[0].id,
        );
        chosen = shots.groups[0];
        scopeId = shots.scopeReference.id;
        const rows = [...packet.queryResults.flatMap((q) => q.rows), ...packet.linkedContext.rows];
        assert.equal(rows.length, new Set(rows.map((r) => `${r.id}@${r.revision}`)).size);
        assert.ok(rows.every((r) => r.time <= input.time && r.arrivedAt <= input.time));
        return {
          scope: 'match',
          claims: [
            {
              kind: 'interpretation',
              text: `My provisional pick so far is ${chosen.label}, with ${chosen.count} recorded shots.`,
              evidence: [shots.scopeReference],
            },
          ],
          followUp: '',
        };
      },
      (request) => {
        const packet = JSON.parse(request.messages.at(-1).content);
        assert.equal(packet.answer.claims[0].evidence[0].id, scopeId);
        assert.equal(packet.claimChecks[0].cited[0].reference.id, scopeId);
        assert.equal(
          packet.evidence.queryResults
            .find((q) => q.scopeReference.id === scopeId)
            .groups.find((g) => g.key === chosen.key).count,
          chosen.count,
        );
        return {
          decision: 'approve',
          reason: 'Verified complete shot total',
          checks: [
            {
              claimIndex: 0,
              actors: [],
              counts: [
                {
                  text: chosen.count + ' recorded shots',
                  value: chosen.count,
                  scopeReference: packet.answer.claims[0].evidence[0],
                  groupKey: chosen.key,
                },
              ],
              inventedFacts: [],
              supported: true,
              reason: 'Verified complete shot total',
            },
          ],
        };
      },
    ],
    undefined,
    [{ filters: { type: 'shot' }, aggregate: 'by-player' }],
  );
  const result = await answerMatchQuestionAI(
    { ...input, question: 'Who is your man of the match so far?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(mock.count(), 3);
  assert.equal(result.execution.modelCalls, 3);
  assert.deepEqual(result.execution.usage, { promptTokens: 300, completionTokens: 60 });
  assert.deepEqual(
    result.execution.stages.map((s) => s.stage),
    ['answer-or-query', 'answer-after-query', 'review'],
  );
  assert.match(result.evidence[0].id, /^match-query-[a-f0-9]{64}$/);
  assert.ok(result.lookups.some((q) => q.scope.reference.id === result.evidence[0].id));
});

test('answer profile keeps zero outcomes, explicit assist coverage and corrected shot outcomes grounded', async () => {
  const targetCounts = [];
  for (const time of [96, 98]) {
    const mock = transport(
      [
        (request) => {
          const packet = JSON.parse(request.messages.at(-1).content);
          const metric = (name) =>
            wireQueries(packet).find(
              (q) =>
                q.scopeReference.id ===
                packet.playerContributions.metrics.find((m) => m.name === name).evidence[0].id,
            );
          const goals = metric('goals'),
            assists = metric('creditedAssists');
          assert.equal(goals.count, 0);
          assert.equal(assists.query.aggregate, 'by-assister');
          assert.ok(Object.hasOwn(assists.scope.missingFields, 'assistPlayer'));
          targetCounts.push(metric('shotsOnTarget').count);
          return {
            scope: 'match',
            claims: [
              {
                text: 'Nobody has scored yet.',
                kind: 'observation',
                evidence: [goals.scopeReference],
              },
            ],
            followUp: '',
          };
        },
        { decision: 'approve' },
      ],
      undefined,
      [{ filters: { type: 'shot', result: true }, aggregate: 'by-player' }],
    );
    const result = await answerMatchQuestionAI(
      { ...input, time, anchorId: undefined, question: 'Who has scored?' },
      { config, fetcher: mock.fetcher },
    );
    assert.equal(result.execution.modelCalls, 3);
  }
  assert.equal(
    targetCounts[1],
    targetCounts[0] + 1,
    'The received correction changes the on-target profile.',
  );
});

test('direct answer retains language and bounded conversation while general knowledge needs no lookup', async () => {
  const mock = directTransport(
    (packet) => {
      assert.equal(packet.responseLanguage, 'es');
      assert.deepEqual(packet.conversation, [
        { question: 'What is a press?', answer: 'A way to challenge possession.', time: 90 },
      ]);
      return {
        draft: {
          scope: 'general',
          claims: [
            { kind: 'general', text: 'Presionar es intentar recuperar el balon.', evidence: [] },
          ],
          followUp: '',
        },
      };
    },
    { decision: 'approve' },
    (packet, call) => {
      if (call) assert.equal(packet.evidence.responseLanguage, 'es');
    },
  );
  const result = await answerMatchQuestionAI(
    {
      ...input,
      language: 'es',
      question: 'Explain that simply in Spanish.',
      conversation: [
        { question: 'What is a press?', answer: 'A way to challenge possession.', time: 90 },
      ],
    },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(result.scope, 'general');
  assert.deepEqual(result.evidence, []);
  assert.equal(mock.count(), 2);
});

test('initial planning view contains intent context but no match event or aggregate evidence', async () => {
  const definition = {
    scope: 'general',
    claims: [
      { text: 'A low block defends deep in a compact shape.', kind: 'general', evidence: [] },
    ],
    followUp: '',
  };
  let planning;
  const mock = directTransport(
    (packet) => {
      planning = packet;
      for (const field of [
        'playerContributions',
        'recentComparison',
        'assessmentDimensions',
        'namedPlayerActions',
        'linkedContext',
        'shotTimeline',
        'requestedEvidence',
        'queryResults',
        'score',
        'pendingOutcomeContext',
        'recentActions',
        'selectedMoment',
        'selectedAnchor',
        'evidenceCapabilities',
      ])
        assert.equal(Object.hasOwn(packet, field), false, field);
      assert.equal(packet.players.length, 22);
      assert.equal(packet.currentTime, 116);
      return { mentionedPlayers: [], draft: definition, queries: [] };
    },
    { decision: 'approve' },
    (_packet, call, body) => {
      if (call === 0) {
        assert.match(body.messages[0].content, /chronology require complete typed-query evidence/);
        assert.match(body.messages[0].content, /zero to three queries/);
      }
    },
  );
  const answer = await answerMatchQuestionAI(
    { kind: 'counter', seed: 8341, time: 116, question: 'What is a low block?' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(answer.execution.modelCalls, 2);
  assert.equal(answer.scope, 'general');
  assert.deepEqual(planning.allowedOperations, {});
});

test('a carried UI anchor cannot contaminate unrelated team, assessment or historical planning', async () => {
  for (const questionText of [
    'What is the passing accuracy for each side?',
    'Who has been the standout so far, and why?',
    'Compare the first and latest shots.',
  ]) {
    const question = {
      kind: 'counter',
      seed: 8341,
      time: 118,
      anchorId: 'comparison-counter-8341-shot-116',
      question: questionText,
    };
    let packet;
    const mock = directTransport({ unexpected: 'invalid-planning-envelope' }, {}, (data, call) => {
      if (!call) packet = data;
    });
    await assert.rejects(answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }));
    assert.equal(mock.count(), 1);
    for (const field of [
      'selectedMoment',
      'selectedAnchor',
      'recentActions',
      'queryResults',
      'score',
      'pendingOutcomeContext',
    ])
      assert.equal(Object.hasOwn(packet, field), false, field);
    assert.equal(JSON.stringify(packet).includes(question.anchorId), false);
  }
  const question = {
    kind: 'counter',
    seed: 8341,
    time: 118,
    anchorId: 'comparison-counter-8341-shot-116',
    question: 'Did that shot count? What is the score now?',
  };
  let packet;
  const mock = directTransport({ unexpected: 'invalid-planning-envelope' }, {}, (data, call) => {
    if (!call) packet = data;
  });
  await assert.rejects(answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }));
  assert.deepEqual(packet.selectedMoment, { id: question.anchorId, type: 'shot', time: 116 });
  assert.equal(packet.queryResults, undefined);
  assert.equal(packet.score, undefined);
  assert.equal(packet.selectedMoment.player, undefined);
  assert.equal(packet.selectedMoment.outcome, undefined);
});

test('requested team comparison separates whole count from grouped totals through review', async () => {
  const comparisonInput = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes so far, and by how many?',
  };
  const query = {
    filters: { type: 'pass', result: true },
    aggregate: 'by-team',
    timeFrom: 0,
    timeTo: 110,
  };
  let actualEvidence;
  const mock = transport(
    [
      (request) => {
        const packet = JSON.parse(request.messages.at(-1).content),
          selected = packet.requestedEvidence[0];
        actualEvidence = selected;
        assert.equal(packet.requestedEvidence.length, 1);
        assert.equal(selected.count, 9);
        assert.deepEqual(Object.fromEntries(selected.groups.map((g) => [g.key, g.count])), {
          home: 5,
          away: 4,
        });
        assert.deepEqual(
          selected.groups,
          executeMatchQuery(
            { kind: comparisonInput.kind, seed: comparisonInput.seed, time: comparisonInput.time },
            query,
          ).groups.map(({ key, label, count }) => ({ key, label, count })),
        );
        assert.ok(
          !packet.queryResults.some((q) => q.scopeReference.id === selected.scopeReference.id),
          'Requested scope is supplied intact once, not duplicated',
        );
        assert.match(
          request.messages[0].content,
          /NEVER attribute that whole count to one team or player/,
        );
        return {
          scope: 'match',
          claims: [
            {
              text: 'Northbridge completed five passes and Harbour Athletic completed four passes, so Northbridge has one more.',
              kind: 'observation',
              evidence: [selected.scopeReference],
            },
          ],
          followUp: '',
        };
      },
      (request) => {
        const packet = JSON.parse(request.messages.at(-1).content),
          evidence = packet.answer.claims[0].evidence[0];
        assert.deepEqual(
          packet.evidence.queryResults.find((q) => q.scopeReference.id === evidence.id).groups,
          actualEvidence.groups,
        );
        return {
          decision: 'approve',
          reason: 'The group counts support the comparison and margin.',
          checks: [
            {
              claimIndex: 0,
              actors: [],
              inventedFacts: [],
              supported: true,
              reason: 'Both team totals match the complete query.',
              counts: [
                { text: 'five passes', value: 5, scopeReference: evidence, groupKey: 'home' },
                { text: 'four passes', value: 4, scopeReference: evidence, groupKey: 'away' },
              ],
            },
          ],
        };
      },
    ],
    undefined,
    [query],
  );
  const answer = await answerMatchQuestionAI(comparisonInput, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /one more/);
});

test('requested first and latest shots keep separate ordered rows and a complete validation timeline', async () => {
  const chronologicalInput = {
    kind: 'interrupted',
    seed: 8341,
    time: 100,
    question: 'How did the first shot turn out compared with the most recent one?',
  };
  const queries = ['asc', 'desc'].map((order) => ({
    filters: { type: 'shot' },
    aggregate: 'list',
    order,
    limit: 1,
    timeFrom: 0,
    timeTo: 100,
  }));
  const mock = transport(
    [
      (request) => {
        const packet = JSON.parse(request.messages.at(-1).content),
          [first, last] = packet.requestedEvidence;
        assert.equal(packet.requestedEvidence.length, 2);
        for (const [i, result] of packet.requestedEvidence.entries()) {
          const actual = executeMatchQuery(
            {
              kind: chronologicalInput.kind,
              seed: chronologicalInput.seed,
              time: chronologicalInput.time,
            },
            queries[i],
          );
          assert.deepEqual(
            result.rows.map((r) => [r.id, r.revision, r.playerId, r.outcome]),
            actual.rows.map((r) => [r.id, r.revision, r.playerId, r.outcome]),
          );
          assert.equal(result.count, 4);
          assert.equal(result.query.limit, 1);
        }
        assert.equal(first.rows[0].playerId, 'home-10');
        assert.equal(first.rows[0].outcome, 'saved');
        assert.equal(last.rows[0].playerId, 'away-10');
        assert.equal(last.rows[0].outcome, 'blocked');
        const timeline = packet.shotTimeline;
        assert.equal(timeline.count, 4);
        assert.equal(timeline.rows.length, 4);
        assert.equal(timeline.truncated, false);
        assert.equal(timeline.query.timeFrom, 0);
        assert.equal(timeline.query.timeTo, 100);
        assert.deepEqual(
          timeline.rows.map((r) => r.time),
          [64, 74, 84, 98],
        );
        const claims = [
          {
            text: 'The first shot was A. Reed’s saved attempt.',
            kind: 'observation',
            evidence: [first.scopeReference, ...first.rows[0].evidence],
          },
          {
            text: 'The latest shot was D. Silva’s blocked attempt.',
            kind: 'observation',
            evidence: [last.scopeReference, ...last.rows[0].evidence],
          },
        ];
        return { scope: 'match', claims, followUp: '' };
      },
      { decision: 'approve' },
    ],
    undefined,
    queries,
  );
  const answer = await answerMatchQuestionAI(chronologicalInput, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /Reed.*saved/);
  assert.match(answer.answer, /Silva.*blocked/);
});

test('direct drafts cannot bypass citation, causality, clock or reviewer checks', async () => {
  const invalid = [
    {
      change: (d) => {
        d.claims[0].evidence = [{ ...ref, revision: 2 }];
      },
      message: /unavailable or outdated/,
    },
    {
      change: (d) => {
        d.claims[0].evidence = [{ type: 'scope', id: 'scope-999', revision: 1 }];
      },
      message: /unavailable or outdated/,
    },
    {
      change: (d) => {
        d.claims[0].evidence = [];
      },
      message: /could not verify/,
    },
    {
      change: (d) => {
        d.claims[0].text = 'Cole forced the turnover.';
      },
      message: /does not establish/,
    },
    {
      change: (d) => {
        d.claims[0].text = 'Reed missed in the 96th minute.';
      },
      message: /incorrect match time/,
    },
  ];
  for (const { change, message } of invalid) {
    const bad = structuredClone(draft);
    change(bad);
    const mock = directTransport({ draft: bad });
    await assert.rejects(answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }), message);
    assert.equal(mock.count(), 1);
  }
  const mock = directTransport({ draft }, { decision: 'withhold' });
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    /could not support/,
  );
  assert.equal(mock.count(), 2);
});

test('malformed first-turn protocols and excessive lookups fail even beside a provisional draft', async () => {
  for (const first of [
    { draft, queries: Array.from({ length: 4 }, () => ({ aggregate: 'count' })) },
    { draft, queries: [{ filters: { unknown: 'field' } }] },
    { queries: Array.from({ length: 4 }, () => ({ aggregate: 'count' })) },
    { draft: null },
    { queries: 'all' },
  ]) {
    const mock = directTransport(first);
    await assert.rejects(answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }));
    assert.equal(mock.count(), 1);
  }
});

test('mixed provisional pass draft is discarded and paired team queries ground a complete comparison', async () => {
  const comparisonInput = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes so far, and by how many?',
  };
  const provisional = {
    scope: 'match',
    claims: [
      {
        text: 'The home team has completed 1 pass so far.',
        kind: 'observation',
        evidence: [{ type: 'event', id: 'comparison-sustained-8341-pass-102', revision: 2 }],
      },
      { text: 'The away team has completed 0 passes so far.', kind: 'observation', evidence: [] },
    ],
    followUp: '',
  };
  const queries = ['home', 'away'].map((team) => ({
    filters: { type: 'pass', team, result: true, outcome: null },
    aggregate: 'count',
    timeFrom: 0,
    timeTo: 110,
    order: null,
    limit: null,
  }));
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0) value = { mentionedPlayers: [], draft: provisional, queries };
    else if (calls === 1) {
      assert.equal(body.response_format.json_schema.name, 'match_answer');
      assert.equal(packet.rejectedAnswer, undefined);
      assert.equal(packet.feedback, undefined);
      assert.ok(
        !JSON.stringify(packet).includes(provisional.claims[0].text),
        'Provisional prose must not become grounding evidence',
      );
      const combined = packet.requestedEvidence.find(
          (q) => q.query.aggregate === 'by-team' && q.query.filters.result === true,
        ),
        home = packet.requestedEvidence.find(
          (q) => q.query.filters.team === 'home' && q.query.filters.result === true,
        ),
        away = packet.requestedEvidence.find(
          (q) => q.query.filters.team === 'away' && q.query.filters.result === true,
        );
      assert.ok(packet.requestedEvidence.length >= 3);
      assert.equal(combined.query.aggregate, 'by-team');
      assert.equal(combined.count, 9);
      assert.deepEqual(
        combined.groups.map((g) => [g.key, g.count]),
        [
          ['home', 5],
          ['away', 4],
        ],
      );
      assert.equal(home.query.filters.team, 'home');
      assert.equal(home.count, 5);
      assert.equal(away.query.filters.team, 'away');
      assert.equal(away.count, 4);
      assert.equal(home.query.aggregate, 'count');
      assert.equal(away.query.aggregate, 'count');
      assert.equal(combined.query.timeFrom, 0);
      assert.equal(combined.query.timeTo, 110);
      assert.equal(combined.truncated, false);
      assert.ok(
        !packet.queryResults.some((q) => q.scopeReference.id === combined.scopeReference.id),
        'Combined proof is retained in requestedEvidence',
      );
      const actual = executeMatchQuery(
        { kind: 'sustained', seed: 8341, time: 110 },
        { filters: { type: 'pass', result: true }, aggregate: 'by-team' },
      );
      assert.deepEqual(
        combined.groups,
        actual.groups.map(({ key, label, count }) => ({ key, label, count })),
      );
      value = {
        scope: 'match',
        claims: [
          {
            text: 'Northbridge has 5 completed passes, Harbour Athletic has 4 completed passes, so Northbridge leads by 1 completed pass.',
            kind: 'observation',
            evidence: [combined.scopeReference],
          },
        ],
        followUp: '',
      };
    } else {
      assert.equal(calls, 2);
      assert.notDeepEqual(packet.answer, provisional);
      const scopeReference = packet.answer.claims[0].evidence[0];
      value = {
        decision: 'approve',
        reason: 'Complete team groups establish both totals and the margin.',
        checks: [
          {
            claimIndex: 0,
            actors: [],
            inventedFacts: [],
            supported: true,
            reason: 'Five minus four is one.',
            counts: [
              { text: '5 completed passes', value: 5, groupKey: 'home', scopeReference },
              { text: '4 completed passes', value: 4, groupKey: 'away', scopeReference },
              { text: '1 completed pass', value: 1, groupKey: 'home', scopeReference },
            ],
          },
        ],
      };
    }
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, body)) },
          },
        ],
      }),
    };
  };
  const answer = await answerMatchQuestionAI(comparisonInput, { config, fetcher });
  assert.equal(calls, 3);
  assert.equal(answer.execution.repairs, 0);
  assert.match(answer.answer, /leads by 1 completed pass/);
  assert.deepEqual(
    answer.execution.stages.map((s) => s.stage),
    ['answer-or-query', 'answer-after-query', 'review'],
  );
  assert.ok(
    answer.lookups.some(
      (q) =>
        q.query.aggregate === 'by-team' &&
        q.query.timeFrom === 0 &&
        q.query.filters.type === 'pass' &&
        q.query.filters.result === true,
    ),
  );
});

test('team comparison derivation never joins mismatched metric windows or duplicate teams', async () => {
  const base = ['home', 'away'].map((team) => ({
    filters: { type: 'pass', team, result: true },
    aggregate: 'count',
    timeFrom: 0,
    timeTo: 110,
  }));
  for (const change of [
    (queries) => (queries[1].timeFrom = 90),
    (queries) => (queries[1].filters.result = false),
    (queries) => (queries[1].filters.team = 'home'),
    (queries) => (queries[1].aggregate = 'by-player'),
    (queries) => (queries[1].filters.player = 'away-7'),
  ]) {
    const queries = structuredClone(base);
    change(queries);
    const mock = transport(
      [
        (request) => {
          const packet = JSON.parse(request.messages.at(-1).content);
          assert.equal(
            packet.requestedEvidence.length,
            new Set(queries.map((q) => JSON.stringify(q))).size,
          );
          assert.ok(packet.requestedEvidence.every((q) => q.query.aggregate !== 'by-team'));
          return {
            scope: 'match',
            claims: [
              {
                text: 'These selected queries do not establish a complete comparison between both teams.',
                kind: 'limitation',
                evidence: [],
              },
            ],
            followUp: '',
          };
        },
        { decision: 'approve' },
      ],
      undefined,
      queries,
    );
    const answer = await answerMatchQuestionAI(
      {
        kind: 'sustained',
        seed: 8341,
        time: 110,
        question: 'Can these counts establish a comparison between both teams?',
      },
      { config, fetcher: mock.fetcher },
    );
    assert.equal(answer.execution.modelCalls, 3);
  }
});

test('provider schema prevents plain-text drafts and preserves independent cited-answer review', async () => {
  const mock = directTransport(
    { draft, queries: [] },
    { decision: 'approve' },
    (_packet, call, body) => {
      const format = body.response_format;
      assert.equal(format.type, 'json_schema');
      assert.equal(format.json_schema.strict, true);
      const schema = format.json_schema.schema;
      if (!call) {
        assert.deepEqual(schema.required, [
          'eventPresentation',
          'requestedSourceAttributes',
          'answerFocus',
          'explanationTarget',
          'requestedForm',
          'mentionedPlayers',
          'decision',
        ]);
        assert.equal(schema.properties.mentionedPlayers.maxItems, 3);
        assert.equal(schema.properties.draft, undefined);
        assert.equal(schema.properties.decision.anyOf.length, 4);
        assert.deepEqual(decisionBranch(body, 'roster-inventory').required, [
          'kind',
          'scope',
          'fields',
        ]);
        assert.deepEqual(decisionBranch(body, 'future-result-limitation').required, ['kind']);
        assert.deepEqual(decisionBranch(body, 'repeat-question').required, [
          'kind',
          'conversationIndex',
        ]);
        assert.equal(decisionBranch(body, 'operation'), undefined);
        assert.deepEqual(decisionBranch(body, 'queries').required, ['kind', 'queries']);
        assert.equal(decisionBranch(body, 'queries').properties.queries.maxItems, 3);
        assert.equal(decisionBranch(body, 'general'), undefined);
        assert.equal(schema.additionalProperties, false);
      } else
        assert.deepEqual(schema.required, [
          'requestCheck',
          'checks',
          'reason',
          'decision',
          'numericBindingMode',
        ]);
    },
  );
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 2);
  assert.deepEqual(result.claims, draft.claims);
  for (const invalid of [
    { draft: 'An uncited plain-text answer', queries: [] },
    { draft: [draft.claims[0]], queries: [] },
  ]) {
    const bad = directTransport(invalid);
    await assert.rejects(answerMatchQuestionAI(input, { config, fetcher: bad.fetcher }));
    assert.equal(bad.count(), 1);
  }
});

test('pending attempts stay explicit and do not become categorical no-goal verdicts', async () => {
  const pendingInput = {
    kind: 'counter',
    seed: 2969,
    time: 116,
    question: 'Should I celebrate yet?',
  };
  const first = (request) => {
    const packet = JSON.parse(request.messages.at(-1).content);
    assert.equal(packet.pendingOutcomeContext.count, 1);
    assert.equal(packet.pendingOutcomeContext.attempts[0].player, 'A. Reed');
    assert.equal(packet.pendingOutcomeContext.attempts[0].time, '01:56');
    const goals = packet.queryResults.find(
      (q) => q.query.filters.type === 'shot' && q.query.filters.result === true,
    );
    return {
      scope: 'match',
      claims: [
        { text: 'No team has scored yet.', kind: 'observation', evidence: [goals.scopeReference] },
      ],
      followUp: '',
    };
  };
  const queries = [{ filters: { type: 'shot', result: true }, aggregate: 'by-player' }];
  const mock = transport([first], undefined, queries);
  await assert.rejects(
    answerMatchQuestionAI(pendingInput, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld' && /unresolved attempt/.test(error.message),
  );
  assert.equal(mock.count(), 2);
  const supported = transport(
    [
      (request) => {
        const packet = JSON.parse(request.messages.at(-1).content);
        const goals = packet.queryResults.find(
          (q) => q.query.filters.type === 'shot' && q.query.filters.result === true,
        );
        return {
          scope: 'match',
          claims: [
            {
              text: 'The confirmed score is 0-0. Reed’s latest shot is awaiting confirmation.',
              kind: 'observation',
              evidence: [
                goals.scopeReference,
                ...packet.pendingOutcomeContext.attempts[0].evidence,
              ],
            },
          ],
          followUp: '',
        };
      },
      { decision: 'approve' },
    ],
    undefined,
    queries,
  );
  const result = await answerMatchQuestionAI(pendingInput, { config, fetcher: supported.fetcher });
  assert.match(result.answer, /awaiting confirmation/);
});

test('arbitrary absent player references cannot become participants with zero actions', async () => {
  for (const name of ['Messi', 'Zoran Velic', 'Ada Okoro']) {
    const bad = {
      scope: 'match',
      claims: [{ text: `${name} has no goals.`, kind: 'observation', evidence: [ref] }],
      followUp: '',
    };
    const mock = directTransport({ mentionedPlayers: [name], draft: bad, queries: [] });
    const answer = await answerMatchQuestionAI(
      { ...input, question: `Has ${name} scored?` },
      { config, fetcher: mock.fetcher },
    );
    assert.equal(answer.answer, `${name} is not in this match’s lineup.`);
    assert.doesNotMatch(answer.answer, /goals|scored|zero/);
    assert.equal(answer.status, 'limited');
    assert.equal(answer.scope, 'clarify');
    assert.equal(answer.provenance.modelGenerated, false);
    assert.equal(answer.provenance.aiInterpreted, true);
    assert.equal(answer.provenance.source, 'verified-lineup-resolution');
    assert.deepEqual(answer.moments, []);
    assert.equal(mock.count(), 1);
    assert.equal(mock.count(), 1, 'Unresolved participant claims fail before model review');
  }
});

test('resolved names are carried to independent review without an extra model call', async () => {
  const mock = directTransport(
    { mentionedPlayers: ['Reed'], draft, queries: [] },
    { decision: 'approve' },
    (packet, call) => {
      if (call) {
        assert.equal(packet.evidence.mentionedPlayerResolution[0].status, 'resolved');
        assert.equal(packet.evidence.mentionedPlayerResolution[0].canonicalId, 'home-10');
      }
    },
  );
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 2);
});

test('mixed resolved and absent names cannot hide behind shortened names or pronouns', async () => {
  for (const text of ['Lionel has no goals.', 'Messi has no goals.', 'He has no goals.']) {
    const mock = directTransport({
      mentionedPlayers: ['Lionel Messi', 'Reed'],
      draft: {
        scope: 'match',
        claims: [{ text, kind: 'observation', evidence: [ref] }],
        followUp: '',
      },
      queries: [],
    });
    await assert.rejects(
      answerMatchQuestionAI(
        { ...input, question: 'Has Lionel Messi scored? Reed is playing.' },
        { config, fetcher: mock.fetcher },
      ),
      (error) => error.code === 'question-withheld',
    );
    assert.equal(mock.count(), 1);
  }
});

test('verified roster absence can be stated directly and control characters fail cleanly', async () => {
  const correction = {
    scope: 'match',
    claims: [
      {
        text: 'Messi is not listed as a player for Northbridge in this match.',
        kind: 'observation',
        evidence: [ref],
      },
    ],
    followUp: '',
  };
  const mock = directTransport({ mentionedPlayers: ['Messi'], draft: correction, queries: [] });
  const result = await answerMatchQuestionAI(
    { ...input, question: 'Has Messi scored?' },
    { config, fetcher: mock.fetcher },
  );
  assert.match(result.answer, /not listed/);
  assert.equal(mock.count(), 2);
  const invalid = directTransport({ mentionedPlayers: ['Reed\u0000'], draft, queries: [] });
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: invalid.fetcher }),
    (error) =>
      error.constructor.name === 'GenerationError' && /player references/.test(error.message),
  );
  assert.equal(invalid.count(), 1);
});

test('verified unresolved-only correction needs no model rewrite and retains canonical resolution evidence', async () => {
  const bad = {
    scope: 'match',
    claims: [{ text: 'Messi has no goals.', kind: 'observation', evidence: [ref] }],
    followUp: '',
  };
  const mock = directTransport({ mentionedPlayers: ['Messi'], draft: bad, queries: [] });
  const result = await answerMatchQuestionAI(
    { ...input, question: 'Has Messi scored?' },
    {
      config,
      fetcher: mock.fetcher,
      canRepair: () => {
        throw new Error('No model repair allowance is needed');
      },
    },
  );
  assert.equal(mock.count(), 1);
  assert.equal(result.claims.length, 1);
  assert.equal(result.answer, 'Messi is not in this match’s lineup.');
  assert.equal(result.execution.repairMode, 'verified-lineup-resolution');
  assert.equal(result.execution.modelCalls, 1);
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.evidence[0].type, 'scope');
  assert.match(result.evidence[0].id, /^match-query-/);
  const query = result.lookups.find((q) => q.scope.reference.id === result.evidence[0].id);
  assert.equal(query.query.filters.player, 'Messi');
  assert.equal(query.scope.entityResolution.player.status, 'absent');
  assert.deepEqual(result.moments, []);
});

test('uncited absent-player draft retains citation failure and typed roster resolution before repair', async () => {
  const bad = {
    scope: 'match',
    claims: [
      {
        text: 'There are no recorded goals scored by Messi for Northbridge in the available match data.',
        kind: 'observation',
        evidence: [],
      },
    ],
    followUp: '',
  };
  const corrected = {
    scope: 'clarify',
    claims: [
      {
        text: 'Messi is not on the Northbridge roster for this match.',
        kind: 'limitation',
        evidence: [],
      },
      { text: 'An assist credits the player who sets up a goal.', kind: 'general', evidence: [] },
    ],
    followUp: '',
  };
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    if (calls === 1) {
      assert.deepEqual(packet.rejectedAnswer, bad);
      assert.match(packet.feedback.reason, /could not verify/);
      assert.equal(packet.feedback.rosterResolution.length, 1);
      assert.equal(packet.feedback.rosterResolution[0].input, 'Messi');
      assert.equal(packet.feedback.rosterResolution[0].status, 'absent');
      assert.deepEqual(packet.feedback.rosterResolution, packet.evidence.mentionedPlayerResolution);
      assert.equal(body.response_format.json_schema.schema.properties.claims.maxItems, 4);
    }
    if (calls === 2) {
      assert.equal(packet.answer.claims[0].text, corrected.claims[0].text);
      assert.equal(packet.evidence.mentionedPlayerResolution[0].status, 'absent');
    }
    const values = [
      { mentionedPlayers: ['Messi'], draft: bad, queries: [] },
      corrected,
      {
        decision: 'approve',
        requestCheck: {
          requestedInformation: 'Messi goals and assist definition',
          status: 'corrected-premise',
          reason: 'Both requested components are addressed.',
          coverage: [
            {
              requestSpan: 'How many goals did Messi score for Northbridge',
              answerSpan: corrected.claims[0].text,
            },
            { requestSpan: 'What is an assist', answerSpan: corrected.claims[1].text },
          ],
        },
      },
    ];
    const value = reviewFixture(values[calls++], body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      }),
    };
  };
  const answer = await answerMatchQuestionAI(
    {
      kind: 'quiet',
      seed: 2969,
      time: 120,
      question: 'How many goals did Messi score for Northbridge? What is an assist?',
    },
    { config, fetcher, canRepair: () => true },
  );
  assert.equal(calls, 3);
  assert.equal(answer.execution.repairs, 1);
  assert.equal(answer.answer, corrected.claims.map((c) => c.text).join(' '));
  assert.deepEqual(
    answer.execution.stages.map((stage) => stage.stage),
    ['answer-or-query', 'repair', 'review'],
  );
});

test('actual uncited absent-name failure becomes an accurately labelled lineup clarification', async () => {
  const bad = {
    scope: 'match',
    claims: [
      {
        text: 'There are no recorded goals scored by Messi for Northbridge in the available match data.',
        kind: 'observation',
        evidence: [],
      },
    ],
    followUp: '',
  };
  const mock = directTransport({ mentionedPlayers: ['Messi'], draft: bad, queries: [] });
  const answer = await answerMatchQuestionAI(
    {
      kind: 'quiet',
      seed: 2969,
      time: 120,
      question: 'How many goals did Messi score for Northbridge?',
    },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(mock.count(), 1);
  assert.equal(answer.status, 'limited');
  assert.equal(answer.scope, 'clarify');
  assert.equal(answer.answer, 'Messi is not in this match’s lineup.');
  assert.equal(answer.provenance.modelGenerated, false);
  assert.equal(answer.provenance.aiInterpreted, true);
  assert.equal(answer.execution.repairMode, 'verified-lineup-resolution');
  assert.deepEqual(
    answer.execution.stages.map((stage) => stage.stage),
    ['answer-or-query'],
  );
  assert.deepEqual(answer.moments, []);
  assert.equal(answer.totalMoments, 0);
  assert.doesNotMatch(answer.answer, /goals|score|zero/);
});

test('lineup ambiguity uses received candidates and cannot adopt a model-invented name', async () => {
  for (const [language, expected] of [
    ['en', /Which Costa/],
    ['es', /qué Costa/],
    ['fr', /quel Costa/],
    ['pt', /qual Costa/],
  ]) {
    const bad = {
      scope: 'match',
      claims: [{ text: 'Costa has scored.', kind: 'observation', evidence: [] }],
      followUp: '',
    };
    const mock = directTransport({ mentionedPlayers: ['Costa'], draft: bad, queries: [] });
    const answer = await answerMatchQuestionAI(
      { ...input, question: 'Has Costa scored?', language },
      { config, fetcher: mock.fetcher },
    );
    assert.match(answer.answer, expected);
    assert.match(answer.answer, /E\. Costa \(Northbridge\)/);
    assert.match(answer.answer, /M\. Costa \(Harbour Athletic\)/);
    assert.equal(answer.provenance.modelGenerated, false);
    assert.equal(mock.count(), 1);
  }
  const invented = directTransport({
    mentionedPlayers: ['Messi'],
    draft: {
      scope: 'match',
      claims: [{ text: 'Messi has scored.', kind: 'observation', evidence: [] }],
      followUp: '',
    },
    queries: [],
  });
  await assert.rejects(
    answerMatchQuestionAI(
      { ...input, question: 'Has Reed scored?' },
      { config, fetcher: invented.fetcher },
    ),
    /could not verify/,
  );
  assert.equal(invented.count(), 1);
});

test('one-component chronology repair can preserve both requested endpoints in separate claims', async () => {
  const question = 'How did the first shot turn out compared with the most recent one?';
  assert.equal(requestComponents(question).length, 1);
  const bad = {
    scope: 'match',
    claims: [
      {
        text: 'The first shot in the match was taken by D. Silva at 98 seconds and was blocked.',
        kind: 'observation',
        evidence: [{ type: 'event', id: 'comparison-interrupted-8341-shot-98', revision: 1 }],
      },
    ],
    followUp: '',
  };
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0) value = { mentionedPlayers: [], draft: bad, queries: [] };
    else if (calls === 1) {
      assert.equal(body.response_format.json_schema.schema.properties.claims.maxItems, 3);
      assert.match(
        body.messages[0].content,
        /Do not put required information only in the internal premiseCheck/,
      );
      assert.deepEqual(packet.rejectedAnswer, bad);
      const [first, ...remaining] = packet.evidence.shotTimeline.rows,
        last = remaining.at(-1);
      assert.equal(first.time, 64);
      assert.equal(last.time, 98);
      value = {
        scope: 'match',
        claims: [
          {
            text: 'The first shot was A. Reed’s saved attempt at 01:04.',
            kind: 'observation',
            evidence: first.evidence,
          },
          {
            text: 'The latest shot was D. Silva’s blocked attempt at 01:38.',
            kind: 'observation',
            evidence: last.evidence,
          },
        ],
        followUp: '',
      };
    } else {
      assert.equal(calls, 2);
      assert.equal(packet.answer.claims.length, 2);
      value = { decision: 'approve' };
    }
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, body)) },
          },
        ],
      }),
    };
  };
  const answer = await answerMatchQuestionAI(
    { kind: 'interrupted', seed: 8341, time: 100, question },
    { config, fetcher, canRepair: () => true },
  );
  assert.equal(calls, 3);
  assert.equal(answer.execution.repairs, 1);
  assert.equal(answer.claims.length, 2);
  assert.match(answer.answer, /first.*Reed.*saved/);
  assert.match(answer.answer, /latest.*Silva.*blocked/);
  assert.equal(answer.provenance.modelGenerated, true);
});

test('equivalent bare first-turn answer is validated and reviewed without an extra call', async () => {
  const mock = directTransport(draft, { decision: 'approve' }, (_packet, call, body) => {
    if (!call) {
      assert.match(body.messages[0].content, /Plan evidence only/);
      assert.doesNotMatch(
        body.messages[0].content,
        /Fill this INTERNAL field before writing claims/,
      );
    }
  });
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 2);
  assert.deepEqual(result.claims, draft.claims);
  for (const first of [
    { ...draft, queries: [] },
    { ...draft, claims: [{ ...draft.claims[0], evidence: [{ ...ref, revision: 99 }] }] },
  ]) {
    const bad = directTransport(first);
    await assert.rejects(answerMatchQuestionAI(input, { config, fetcher: bad.fetcher }));
    assert.equal(bad.count(), 1);
  }
});

test('structured lookup ignores unused null fields without treating result null as a pending-shot filter', async () => {
  let calls = 0,
    lookupPacket;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0) {
      const schema = decisionBranch(body, 'queries').properties.queries.items.anyOf[0];
      const query = Object.fromEntries(Object.keys(schema.properties).map((key) => [key, null]));
      query.filters = Object.fromEntries(
        Object.keys(schema.properties.filters.anyOf[0].properties).map((key) => [key, null]),
      );
      query.filters.type = 'shot';
      query.aggregate = 'list';
      value = { draft: null, queries: [query] };
    } else if (calls === 1) {
      lookupPacket = packet;
      value = draft;
    } else value = { decision: 'approve', reason: 'Supported by received events.' };
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, JSON.parse(options.body))) },
          },
        ],
      }),
    };
  };
  const result = await answerMatchQuestionAI(input, { config, fetcher });
  const shots = wireQueries(lookupPacket).find(
    (q) =>
      q.query.aggregate === 'list' &&
      q.query.filters.type === 'shot' &&
      Object.keys(q.query.filters).length === 1,
  );
  assert.ok(shots.count > 0);
  assert.equal(Object.hasOwn(shots.query.filters, 'result'), false);
  assert.ok(shots.rows.some((row) => row.result !== null));
  assert.equal(calls, 3);
  assert.equal(result.status, 'answered');
});

test('compact review keeps all comparison evidence and source facts without copying records into each claim', async () => {
  let firstEvidence;
  const mock = transport([
    (request) => {
      const packet = JSON.parse(request.messages.at(-1).content);
      firstEvidence = packet;
      return draft;
    },
    (request) => {
      const packet = JSON.parse(request.messages.at(-1).content);
      assert.ok(packet.evidence.queryResults.length < firstEvidence.queryResults.length);
      assert.match(packet.evidence.sourceFingerprint, /^[a-f0-9]{64}$/);
      assert.ok(
        packet.evidence.queryResults.every((q) =>
          packet.answer.claims.some((c) => c.evidence.some((r) => r.id === q.scopeReference.id)),
        ),
      );
      for (const query of packet.evidence.queryResults) {
        const original = executeMatchQuery(
          { kind: input.kind, seed: input.seed, time: input.time },
          query.query,
        );
        assert.equal(query.scope.inventoryCount, original.scope.inventoryCount);
        assert.deepEqual(query.scope.missingFields, original.scope.missingFields);
        assert.equal(query.count, original.count);
        assert.equal(query.truncated, original.truncated);
        assert.equal(query.query.timeFrom, original.query.timeFrom);
        assert.equal(query.query.timeTo, original.query.timeTo);
        assert.deepEqual(
          query.groups.map(({ key, count }) => ({ key, count })),
          original.groups.map(({ key, count }) => ({ key, count })),
        );
        for (const row of query.rows) {
          const source = original.rows.find((r) => r.id === row.id);
          assert.ok(source);
          assert.equal(row.revision, source.revision);
          assert.equal(row.time, source.time);
          assert.equal(row.arrivedAt, source.arrivedAt);
          // Optional unknown attributes may be omitted, but no recorded fact changes.
          for (const [key, value] of Object.entries(row)) assert.deepEqual(value, source[key]);
        }
      }
      assert.ok(
        packet.claimChecks.every((check) =>
          check.cited.every((c) => c.record === undefined && !c.unavailable),
        ),
      );
      assert.match(packet.reviewConstraints.eventLinks, /sequence/);
      assert.ok(
        packet.evidence.relevanceContext.recentComparison.metrics.some((m) => m.teams.length === 2),
      );
      assert.ok(packet.evidence.relevanceContext.playerContributions.metrics.length === 7);
      assert.equal(packet.evidence.relevanceContext.citable, false);
      return { decision: 'approve' };
    },
  ]);
  await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(mock.count(), 3);
});

// Legacy scenario fixtures supply an explicit per-claim mock review; this does
// not run in production or infer semantic correctness from reference validity.
function reviewFixture(value, body) {
  if (
    body.response_format?.json_schema?.name === 'rule_fact_selection' &&
    value &&
    Object.hasOwn(value, 'factIds')
  )
    return { routeMismatch: false, matchEvidenceRequired: false, ...value };
  if (!['approve', 'withhold'].includes(value?.decision)) return value;
  const source = JSON.parse(body.messages.at(-1).content);
  value = {
    requestCheck: {
      requestedInformation: 'Mock scenario question',
      status: 'answered',
      reason: 'Mock scenario answer',
    },
    ...value,
  };
  if (source.ruleClauses?.length && !Object.hasOwn(value, 'ruleChecks'))
    value.ruleChecks = source.ruleClauses.map((clause) => ({
      clauseId: clause.clauseId,
      factIds: source.footballKnowledge.concepts.flatMap((concept) =>
        concept.facts.map((fact) => fact.id),
      ),
      supported: value.decision === 'approve',
      reason: 'Explicit mocked source support; not a semantic verifier.',
    }));
  value.requestCheck = {
    coverage: requestComponents(source.evidence.question).map((requestSpan) => ({
      requestSpan,
      claimIndices: [0],
    })),
    ...value.requestCheck,
  };
  if (Object.hasOwn(value, 'checks'))
    return {
      ...value,
      checks: Array.isArray(value.checks)
        ? value.checks.map((check) => ({
            ...check,
            inventedFacts: check.inventedFacts ?? [],
            counts: check.counts ?? [],
            shotOutcomeAssertions: check.shotOutcomeAssertions ?? [],
          }))
        : value.checks,
    };
  const packet = JSON.parse(body.messages.at(-1).content);
  return {
    ...value,
    reason: value.reason || 'Mock review',
    checks: packet.answer.claims.map((_, claimIndex) => ({
      claimIndex,
      actors: [],
      inventedFacts: [],
      counts: [],
      shotOutcomeAssertions: [],
      supported: value.decision === 'approve',
      reason: 'Mock scenario evidence',
    })),
  };
}

test('approval cannot bypass missing, duplicate, rejected or unexplained claim checks', async () => {
  const checks = draft.claims.map((_, claimIndex) => ({
    claimIndex,
    actors: [],
    supported: true,
    reason: 'Supported in mock scenario',
  }));
  for (const invalid of [
    null,
    [],
    [checks[0], checks[0]],
    [checks[0], { ...checks[1], supported: false }],
    [checks[0], { ...checks[1], claimIndex: 8 }],
    [checks[0], { ...checks[1], reason: '' }],
  ]) {
    const mock = directTransport(
      { draft, queries: [] },
      { decision: 'approve', reason: 'All supported', checks: invalid },
    );
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-withheld',
    );
    assert.equal(mock.count(), 2);
  }
});

test('one semantic repair gets a fresh review using the same evidence snapshot', async () => {
  const bad = {
    ...draft,
    claims: [{ text: 'Reed lost concentration.', kind: 'interpretation', evidence: [ref] }],
  };
  let calls = 0;
  const snapshots = [];
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    snapshots.push(packet);
    const values = [
      { draft: bad, queries: [] },
      { decision: 'withhold', reason: 'Intention unknown' },
      draft,
      { decision: 'approve' },
    ];
    const value = reviewFixture(values[calls++], body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      }),
    };
  };
  const result = await answerMatchQuestionAI(input, { config, fetcher, canRepair: () => true });
  assert.equal(calls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.equal(result.observedAt, input.time);
  assert.deepEqual(snapshots[2].rejectedAnswer, bad);
  assert.equal(snapshots[2].evidence.observedAt, input.time);
  for (const row of snapshots[1].evidence.linkedContext.rows) {
    const repairedRows = [
      ...wireQueries(snapshots[2].evidence).flatMap((q) => q.rows || []),
      ...(snapshots[2].evidence.linkedContext?.rows || []),
    ];
    assert.ok(
      repairedRows.some(
        (candidate) =>
          candidate.id === row.id &&
          candidate.revision === row.revision &&
          candidate.result === row.result,
      ),
    );
  }
  assert.equal(snapshots[1].evidence.sourceFingerprint, snapshots[3].evidence.sourceFingerprint);
  assert.match(result.answer, /off target/);
  assert.doesNotMatch(result.answer, /panicked/);
});
test('semantic repair cannot loop or publish a second rejected answer', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      value = reviewFixture(
        [
          { draft, queries: [] },
          { decision: 'withhold', reason: 'Unsupported' },
          draft,
          { decision: 'withhold', reason: 'Still unsupported' },
        ][calls++],
        body,
      );
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      }),
    };
  };
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher, canRepair: () => true }),
    (e) => e.code === 'question-withheld',
  );
  assert.equal(calls, 4);
});

test('pre-review repair receives complete labelled team scopes and cannot retry a rejected replacement', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'Which side has completed more passes so far, and by how many?',
  };
  const queryInput = { kind: question.kind, seed: question.seed, time: question.time };
  const recentPass = executeMatchQuery(queryInput, {
    filters: { type: 'pass', result: true },
    order: 'desc',
    limit: 1,
  }).rows[0];
  const bad = {
    scope: 'match',
    claims: [
      {
        text: 'The home team has completed 1 pass so far.',
        kind: 'observation',
        evidence: recentPass.evidence,
      },
    ],
    followUp: '',
  };
  let calls = 0,
    allowanceChecks = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    let value;
    if (calls === 0) {
      assert.equal(packet.fullMatchComparison, undefined);
      value = { mentionedPlayers: [], draft: bad, queries: [] };
    } else if (calls === 1) {
      assert.match(
        body.messages[0].content,
        /For team totals and comparisons, use fullMatchComparison/,
      );
      const comparison = packet.evidence.fullMatchComparison;
      assert.equal(comparison.metrics.length, 5);
      assert.equal(comparison.from, '00:00');
      assert.equal(comparison.to, '01:50');
      const passes = comparison.metrics.find((metric) => metric.filters.type === 'pass');
      assert.deepEqual(passes.teams, [
        { team: 'home', name: 'Northbridge', count: 5 },
        { team: 'away', name: 'Harbour Athletic', count: 4 },
      ]);
      for (const metric of comparison.metrics) {
        const scope = packet.evidence.queryResults.find(
          (query) => query.scopeReference.id === metric.evidence[0].id,
        );
        assert.equal(scope.query.aggregate, 'by-team');
        assert.equal(scope.query.timeFrom, 0);
        assert.equal(scope.query.timeTo, 110);
        const actual = executeMatchQuery(queryInput, {
          filters: metric.filters,
          aggregate: 'by-team',
        });
        assert.deepEqual(
          scope.groups,
          actual.groups.map(({ key, label, count }) => ({ key, label, count })),
        );
        assert.equal(scope.count, actual.count);
      }
      const scope = packet.evidence.queryResults.find(
        (query) =>
          query.query.aggregate === 'by-player' &&
          query.query.filters.type === 'pass' &&
          query.query.filters.result === true,
      );
      value = {
        scope: 'match',
        claims: [
          {
            text: 'The home team has completed 9 passes so far.',
            kind: 'observation',
            evidence: [scope.scopeReference],
          },
        ],
        followUp: '',
      };
    } else {
      assert.equal(calls, 2, 'No second semantic rewrite is permitted');
      const scopeReference = packet.answer.claims[0].evidence[0];
      value = {
        decision: 'approve',
        reason: 'Intentionally incorrect model approval.',
        checks: [
          {
            claimIndex: 0,
            actors: [],
            counts: [{ text: '9 passes', value: 9, groupKey: 'home', scopeReference }],
            supported: true,
            reason: 'Intentionally incorrect model approval.',
          },
        ],
      };
    }
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(reviewFixture(value, body)) },
          },
        ],
      }),
    };
  };
  await assert.rejects(
    answerMatchQuestionAI(question, {
      config,
      fetcher,
      canRepair: () => {
        allowanceChecks++;
        return true;
      },
    }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(calls, 3);
  assert.equal(allowanceChecks, 1);
});
test('provider failure is not treated as a semantic repair opportunity', async () => {
  let calls = 0,
    checks = 0;
  const fetcher = async () => {
    calls++;
    return { ok: false, status: 429 };
  };
  await assert.rejects(
    answerMatchQuestionAI(input, {
      config,
      fetcher,
      canRepair: () => {
        checks++;
        return true;
      },
    }),
    (e) => e.code === 'azure-rate-limit',
  );
  assert.equal(calls, 1);
  assert.equal(checks, 0);
});

test('assessment dimensions separate shot volume from unmeasured quality and keep named actions at question time', async () => {
  let seen;
  const mock = transport(
    [
      {
        scope: 'match',
        claims: [{ text: 'Player intention is unknown.', kind: 'limitation', evidence: [] }],
        followUp: '',
      },
      { decision: 'approve' },
    ],
    (body, call) => {
      if (!call) seen = JSON.parse(body.messages.at(-1).content);
    },
  );
  await answerMatchQuestionAI(
    { ...input, question: 'Why did Cole not pass?' },
    { config, fetcher: mock.fetcher },
  );
  const quality = seen.assessmentDimensions.find((d) => d.dimension === 'chanceQuality');
  assert.equal(quality.availability, 'unmeasured');
  assert.equal(quality.leader, null);
  assert.deepEqual(quality.evidence, []);
  const onTarget = seen.assessmentDimensions.find((d) => d.dimension === 'shotsOnTarget');
  const expected = executeMatchQuery(
    { kind: input.kind, seed: input.seed, time: input.time },
    {
      filters: { type: 'shot', outcome: 'on-target' },
      aggregate: 'by-team',
      timeFrom: 66,
      timeTo: 96,
    },
  );
  for (const team of ['home', 'away'])
    assert.equal(onTarget[team], expected.groups.find((g) => g.key === team)?.count ?? 0);
  assert.ok(seen.namedPlayerActions.some((row) => row.player.name === 'J. Cole'));
  for (const row of seen.namedPlayerActions)
    for (const action of row.actions) {
      const [minutes, seconds] = action.time.split(':').map(Number);
      assert.ok(minutes * 60 + seconds <= input.time);
      assert.ok(
        action.evidence.every(
          (ref) =>
            seen.queryResults.some((q) => q.rows.some((r) => r.id === ref.id)) ||
            seen.linkedContext.rows.some((r) => r.id === ref.id),
        ),
      );
    }
});

test('unsupported judgment triggers a whole-answer rewrite rather than orphaned retained facts', async () => {
  const bad = {
    ...draft,
    claims: [
      { text: 'Northbridge creates better chances.', kind: 'interpretation', evidence: [ref] },
      { text: 'They took this shot off target.', kind: 'observation', evidence: [ref] },
    ],
  };
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    const values = [{ draft: bad, queries: [] }, draft, { decision: 'approve' }];
    if (calls === 1) {
      const packet = JSON.parse(body.messages.at(-1).content);
      assert.deepEqual(packet.rejectedAnswer, bad);
      assert.equal(packet.evidence.question, input.question);
    }
    const value = reviewFixture(values[calls++], body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      }),
    };
  };
  const result = await answerMatchQuestionAI(input, { config, fetcher, canRepair: () => true });
  assert.equal(calls, 3);
  assert.equal(result.execution.repairMode, 'reviewed-rewrite');
  assert.match(result.answer, /Reed/);
  assert.doesNotMatch(result.answer, /better chances|They/);
});

test('claim removal cannot leave a second unsupported causal claim without attempting the bounded rewrite', async () => {
  const bad = {
    ...draft,
    claims: [
      { text: 'Northbridge creates better chances.', kind: 'interpretation', evidence: [ref] },
      { text: 'Reed forced the turnover.', kind: 'observation', evidence: [ref] },
    ],
  };
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    const values = [{ draft: bad, queries: [] }, draft, { decision: 'approve' }];
    if (calls === 1) assert.deepEqual(JSON.parse(body.messages.at(-1).content).rejectedAnswer, bad);
    const value = reviewFixture(values[calls++], body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      }),
    };
  };
  const result = await answerMatchQuestionAI(input, { config, fetcher, canRepair: () => true });
  assert.equal(calls, 3);
  assert.equal(result.execution.repairMode, 'reviewed-rewrite');
  assert.match(result.answer, /off target/);
  assert.doesNotMatch(result.answer, /forced|better chances/);
});

test('independent review receives the actual question and evidence without the writer premise guess', async () => {
  const premiseCheck = {
    questionAssumption: 'A shot was a goal',
    recordedAction: 'The shot was off target',
    conclusion: 'contradicted',
  };
  let received;
  const mock = directTransport(
    { draft: { ...draft, premiseCheck }, queries: [] },
    undefined,
    (packet, call) => {
      if (call) received = packet;
    },
  );
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(Object.hasOwn(received, 'premiseCheck'), false);
  assert.equal(received.evidence.question, input.question);
  assert.ok(received.evidence.linkedContext.rows.some((row) => row.id === ref.id));
  assert.equal(Object.hasOwn(result, 'premiseCheck'), false);
  assert.doesNotMatch(result.answer, /questionAssumption|contradicted/);
});

test('repeated initials remain clarifications even after earlier answers', async () => {
  for (const answer of [
    'Could you clarify what you would like to know?',
    'J. Cole recovered the ball.',
  ]) {
    const result = await answerMatchQuestionAI(
      {
        ...input,
        question: 'j',
        previousQuestion: 'j',
        conversation: [{ question: 'j', answer, time: 0 }],
      },
      {
        config,
        fetcher: async () => {
          throw new Error('Must not infer intent from an initial');
        },
      },
    );
    assert.equal(result.scope, 'clarify');
    assert.equal(result.execution.modelCalls, 0);
    assert.deepEqual(result.moments, []);
  }
});

test('reviewer approval cannot override its own identified unsupported assertion', async () => {
  const claim = {
    scope: 'match',
    claims: [
      {
        text: 'Reed put the attempt off target because he lost concentration.',
        kind: 'observation',
        evidence: [ref],
      },
    ],
    followUp: '',
  };
  const review = {
    decision: 'approve',
    reason: 'The shot actor is right',
    checks: [
      {
        claimIndex: 0,
        actors: [],
        inventedFacts: ['because he lost concentration'],
        reason: 'No evidence of concentration',
        supported: true,
      },
    ],
  };
  const mock = directTransport({ draft: claim, queries: [] }, review);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld',
  );
});

test('true claims cannot pass when the review identifies an unanswered request', async () => {
  const mock = directTransport(
    { draft, queries: [] },
    {
      decision: 'approve',
      reason: 'Facts true',
      requestCheck: {
        requestedInformation: 'A missing quantity',
        status: 'not-answered',
        reason: 'Only states a shot outcome',
      },
    },
  );
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld',
  );
});

test('rule follow-ups retain their specific prior condition through planning, selection and independent review', async () => {
  const conversation = [
    {
      question: 'Can a player be offside directly from a throw-in?',
      answer: 'A direct throw-in is exempt.',
      time: 40,
    },
  ];
  const question = { ...input, question: 'And does the same apply from a corner?', conversation };
  const planner = { mentionedPlayers: [], decision: { kind: 'general', concepts: ['offside'] } };
  const mock = sequenceTransport(
    [planner, { factIds: ['offside.direct-restarts'] }, { decision: 'approve' }],
    (packet, call, body) => {
      assert.deepEqual((call === 2 ? packet.evidence : packet).conversation, conversation);
      assert.match(
        body.messages[0].content,
        /Previous answers are conversational context, never authoritative rule evidence/,
      );
      assert.match(
        body.messages[0].content,
        /a question about the restart needs the applicable restart procedure/,
      );
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(result.answer, /goal kick, throw-in or corner kick is exempt/);
  assert.equal(mock.count(), 3);
  const adjacent = sequenceTransport([
    planner,
    { factIds: ['offside.position'] },
    {
      decision: 'approve',
      requestCheck: {
        status: 'not-answered',
        reason: 'The position definition does not answer the direct-restart exception.',
      },
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: adjacent.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(
    adjacent.count(),
    3,
    'An irrelevant canonical source selection must not escape independent coverage review',
  );
});

test('canonical rule selection can only render exact selected versioned source facts, never authored match evidence', async () => {
  const question = { ...input, question: 'Is an offside position alone an offence?' },
    knowledge = retrieveFootballKnowledge(['offside']);
  const reference = { type: 'knowledge', id: 'offside.involvement', version: knowledge.version };
  const planner = { mentionedPlayers: [], decision: { kind: 'general', concepts: ['offside'] } };
  const mock = sequenceTransport(
    [planner, { factIds: ['offside.involvement'] }, { decision: 'approve' }],
    (packet, call, body) => {
      if (call === 1) {
        const schema = body.response_format.json_schema.schema;
        assert.deepEqual(schema.required, ['routeMismatch', 'matchEvidenceRequired', 'factIds']);
        assert.equal(schema.properties.routeMismatch.type, 'boolean');
        assert.equal(schema.properties.claims, undefined);
        assert.ok(schema.properties.factIds.items.enum.includes(reference.id));
        assert.equal(schema.properties.factIds.maxItems, 4);
        assert.equal(body.response_format.json_schema.name, 'rule_fact_selection');
      }
      if (call === 2) {
        assert.equal(packet.answer.scope, 'general');
        assert.deepEqual(packet.knowledgeChecks, [{ claimIndex: 0, reference }]);
        assert.deepEqual(packet.claimChecks[0].cited, []);
        assert.equal(packet.ruleClauses.length, 2);
        const schema = body.response_format.json_schema.schema.properties.ruleChecks;
        assert.equal(schema.minItems, 2);
        assert.equal(schema.maxItems, 2);
        assert.deepEqual(
          schema.items.properties.clauseId.enum,
          packet.ruleClauses.map((c) => c.clauseId),
        );
        assert.match(body.messages[0].content, /necessary versus sufficient/);
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.scope, 'general');
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.moments, []);
  assert.deepEqual(result.knowledgeCitations, [{ claimIndex: 0, reference }]);
  assert.equal(result.knowledgeReview.method, 'model-clause-review');
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.provenance.aiInterpreted, true);
  assert.equal(result.provenance.source, 'verified-rule-facts');
  assert.equal(
    result.answer,
    knowledge.concepts[0].facts.find((fact) => fact.id === reference.id).text,
  );
  for (const selection of [
    { factIds: [] },
    { factIds: ['offside.involvement', 'offside.involvement'] },
    { factIds: ['handball.offence'] },
    { factIds: ['offside.involvement'], claims: [{ text: 'Invented rule' }] },
    { factIds: knowledge.concepts[0].facts.slice(0, 5).map((fact) => fact.id) },
    { factIds: [{ type: 'scope', id: reference.id, revision: 1 }] },
  ]) {
    const invalid = sequenceTransport([planner, selection]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: invalid.fetcher, canRepair: () => true }),
      (error) => error.code === 'question-invalid-rule-selection',
    );
    assert.equal(invalid.count(), 2);
  }
});

test('canonical rule coverage cannot omit required clauses or accept contradictory review, and canonical text is never rewritten', async () => {
  const question = { ...input, question: 'Does handling have to be deliberate to be an offence?' };
  const planner = { mentionedPlayers: [], decision: { kind: 'general', concepts: ['handball'] } };
  const selection = { factIds: ['handball.offence', 'handball.scoring'] };
  const valid = selection.factIds.map((factId, index) => ({
    clauseId: `claim${index}.clause0`,
    factIds: [factId],
    supported: true,
    reason: 'Mock source match',
  }));
  for (const checks of [
    [],
    [valid[0]],
    [valid[0], valid[0]],
    [
      valid[0],
      {
        ...valid[1],
        supported: false,
        reason: 'Selection does not fully answer the requested condition.',
      },
    ],
    [valid[0], { ...valid[1], factIds: [] }],
    [valid[0], { ...valid[1], factIds: ['offside.position'] }],
    [valid[0], { ...valid[1], clauseId: 'invented' }],
  ]) {
    const mock = sequenceTransport([
      planner,
      selection,
      { decision: 'approve', ruleChecks: checks },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher, canRepair: () => true }),
      (error) => error.code === 'question-withheld',
    );
    assert.equal(mock.count(), 3);
  }
  const mock = sequenceTransport([planner, selection, { decision: 'approve' }]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  const facts = retrieveFootballKnowledge(['handball']).concepts[0].facts;
  assert.deepEqual(
    result.claims.map((claim) => claim.text),
    selection.factIds.map((id) => facts.find((fact) => fact.id === id).text),
  );
  assert.match(result.answer, /even accidentally/);
  assert.doesNotMatch(result.answer, /only if/i);
  assert.equal(result.execution.repairs, 0);
});

test('explicit moment inspection rejects contradictory narrowing and can replan once without dropping the event', async () => {
  const bad = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        { filters: { id: input.anchorId, type: 'pass', player: 'home-9' }, aggregate: 'list' },
      ],
    },
  };
  const fixed = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { id: input.anchorId }, aggregate: 'list' }],
    },
  };
  const invalid = sequenceTransport([bad]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: invalid.fetcher }),
    /ID alone/,
  );
  const repaired = sequenceTransport(
    [bad, fixed, draft, { decision: 'approve' }],
    (packet, call) => {
      if (call === 1) assert.match(packet.planningError, /ID alone/);
      if (call === 2) {
        assert.equal(packet.requestedEvidence[0].count, 1);
        assert.equal(packet.requestedEvidence[0].rows[0].type, 'shot');
        assert.deepEqual(packet.requestedEvidence[0].query.filters, { id: input.anchorId });
      }
    },
  );
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: repaired.fetcher,
    canRepair: (required) => required === 3,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.planningRepairs, 1);
  assert.ok(result.moments.some((moment) => moment.anchorId === input.anchorId));
});

test('application numeric citation completion is audited without rewriting correct totals or accepting false totals', async () => {
  const question = {
    kind: 'sustained',
    seed: 84621,
    time: 110,
    question: 'How many completed passes has Northbridge made?',
  };
  const plan = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'pass', result: true }, aggregate: 'by-team' }],
    },
  };
  const candidate = (count) => ({
    scope: 'match',
    claims: [
      { text: `Northbridge has ${count} completed passes.`, kind: 'observation', evidence: [] },
    ],
    followUp: '',
  });
  const mock = sequenceTransport(
    [
      plan,
      candidate(5),
      (packet) => ({
        decision: 'approve',
        reason: 'Verified complete team count',
        checks: [
          {
            claimIndex: 0,
            actors: [],
            supported: true,
            reason: 'Verified team count',
            inventedFacts: [],
            counts: [
              {
                text: '5 completed passes',
                value: 5,
                scopeReference: packet.answer.claims[0].evidence[0],
                groupKey: 'home',
              },
            ],
          },
        ],
      }),
    ],
    (packet, call) => {
      if (call === 2) {
        assert.equal(packet.citationAugmentations.length, 1);
        assert.equal(packet.citationAugmentations[0].value, 5);
        assert.equal(packet.answer.claims[0].text, candidate(5).claims[0].text);
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.citationAugmentations[0].reason, 'verified-complete-count-scope');
  assert.equal(result.citationAugmentations[0].reference.type, 'scope');
  assert.ok(result.evidence.some((ref) => ref.id === result.citationAugmentations[0].reference.id));
  assert.equal(result.provenance.modelGenerated, true);
  assert.equal(result.execution.modelCalls, 3);
  const bad = sequenceTransport([plan, candidate(9)]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: bad.fetcher }),
    /verify|evidence/,
  );
  assert.equal(bad.count(), 2);
});

test('canonical own-half rule selection retains the source exception and incomplete selection may be withheld', async () => {
  const question = { ...input, question: 'Could an offside offence be punished in your own half?' };
  const planner = { mentionedPlayers: [], decision: { kind: 'general', concepts: ['offside'] } };
  const incomplete = sequenceTransport([
    planner,
    { factIds: ['offside.position'] },
    {
      decision: 'approve',
      requestCheck: {
        status: 'not-answered',
        reason: 'Position alone omits the later involvement exception.',
      },
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: incomplete.fetcher, canRepair: () => true }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(incomplete.count(), 3);
  const full = sequenceTransport([
    planner,
    { factIds: ['offside.position', 'offside.restart'] },
    { decision: 'approve' },
  ]);
  const result = await answerMatchQuestionAI(
    { ...question, language: 'fr' },
    { config, fetcher: full.fetcher },
  );
  assert.match(result.answer, /potentially in the player's own half/);
  assert.equal(result.language, 'en');
  assert.equal(result.knowledgeReference.selection.requestedLanguage, 'fr');
  assert.equal(result.knowledgeReference.selection.renderedLanguage, 'en');
  assert.equal(result.provenance.modelGenerated, false);
  assert.doesNotMatch(result.answer, /can never|cannot.*penalized/);
});

test('pass outcome licenses preserve unqualified selectors, negative qualifiers and outcome questions across supported languages', () => {
  const query = (result) => ({
    filters: { type: 'pass', result },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
  });
  const unqualified = [
    'Who made the most recent right-footed pass?',
    'Which was Cole’s first pass?',
    'What was Silva’s last pass, not just completed passes?',
    'Who made the latest pass, whether or not it succeeded?',
    'Was the last pass completed?',
    'Did the last pass succeed?',
    'Was Silva’s latest pass not completed?',
    'Quel était le dernier passe ?',
    'Quel est le dernier passe, pas seulement les passes réussies ?',
    '¿Quién hizo el último pase con el pie derecho?',
    '¿Fue el último pase completado?',
    'Quem fez o último passe com o pé direito?',
    'O último passe foi completado?',
    'How many passes has Reed made?',
  ];
  for (const question of unqualified) {
    assert.equal(passQuerySelectionPermission({ question }).constrained, true, question);
    assert.equal(passQueryOutcomeAllowed({ question }, query(true)), false, question);
    assert.equal(passQueryOutcomeAllowed({ question }, query(false)), false, question);
    assert.equal(
      passQueryOutcomeAllowed({ question }, { ...query(true), filters: { type: 'pass' } }),
      true,
      question,
    );
  }
  const completed = [
    'Who made the most recent completed right-footed pass?',
    'Who made Silva’s first successful pass?',
    'Quel joueur a fait le dernier passe réussi ?',
    '¿Quién hizo el último pase completado?',
    'Quem fez o último passe completo?',
  ];
  for (const question of completed) {
    assert.equal(passQueryOutcomeAllowed({ question }, query(true)), true, question);
    assert.equal(passQueryOutcomeAllowed({ question }, query(false)), false, question);
  }
  const failed = [
    'Who made the latest failed pass?',
    'Quel joueur a fait le dernier passe raté ?',
    '¿Quién hizo el último pase fallido?',
    'Quem fez o último passe incompleto?',
  ];
  for (const question of failed) {
    assert.equal(passQueryOutcomeAllowed({ question }, query(false)), true, question);
    assert.equal(passQueryOutcomeAllowed({ question }, query(true)), false, question);
  }
  assert.equal(
    passQueryOutcomeAllowed(
      { question: 'Who is standing out so far?' },
      { filters: { type: 'pass', result: true }, aggregate: 'by-player' },
    ),
    true,
    'Qualitative contributions can legitimately use labelled completed-pass metrics',
  );
  assert.equal(
    passQueryOutcomeAllowed(
      { question: 'Who made the last pass?' },
      { filters: { type: 'pass', result: true }, aggregate: 'by-player' },
    ),
    false,
    'Changing aggregation cannot bypass outcome licensing',
  );
  assert.equal(
    passQueryOutcomeAllowed(
      { question: 'Who made the latest pass?' },
      { filters: { result: true }, aggregate: 'list', order: 'desc', limit: 1 },
    ),
    false,
    'Omitting type cannot mix completed passes and goals',
  );
  assert.equal(
    passQueryOutcomeAllowed(
      { question: 'Who made the latest completed pass, and was there a goal?' },
      { filters: { type: 'shot', result: true }, aggregate: 'list' },
    ),
    true,
    'Explicit supporting shot queries remain available',
  );
  assert.equal(
    passQueryOutcomeAllowed(
      {
        question: 'And the latest one?',
        previousQuestion: 'How many completed passes has Reed made?',
      },
      query(true),
    ),
    true,
  );
  assert.equal(
    passQueryOutcomeAllowed(
      {
        question: 'And the latest pass?',
        previousQuestion: 'How many completed passes has Reed made?',
      },
      query(true),
    ),
    false,
    'Current explicit unqualified topic replaces inherited completion',
  );
});

test('latest pass planning cannot substitute an older completed pass and bounded repair retrieves the actual failed latest pass', async () => {
  const question = {
    kind: 'sustained',
    seed: 59231,
    time: 67,
    question: 'Who made the most recent right-footed pass?',
  };
  const filters = { type: 'pass', bodyPart: 'right-foot' },
    base = { filters, order: 'desc', limit: 1, aggregate: 'list' };
  const source = { kind: question.kind, seed: question.seed, time: question.time };
  const raw = executeMatchQuery(source, base),
    complete = executeMatchQuery(source, { ...base, filters: { ...filters, result: true } });
  assert.equal(raw.rows[0].player, 'M. Costa');
  assert.equal(raw.rows[0].time, 62);
  assert.equal(raw.rows[0].result, false);
  assert.equal(complete.rows[0].player, 'H. Diallo');
  assert.equal(complete.rows[0].time, 56);
  const planner = (query) => ({
    mentionedPlayers: [],
    decision: { kind: 'queries', queries: [query] },
  });
  const writer = (packet) => {
    const query = packet.requestedEvidence[0],
      row = query.rows[0];
    return {
      scope: 'match',
      claims: [
        {
          text: `${row.player} attempted the latest right-footed pass at ${row.clock}; it failed.`,
          kind: 'observation',
          evidence: [...row.evidence, query.scopeReference],
        },
      ],
      followUp: '',
    };
  };
  const rejected = sequenceTransport([planner({ ...base, filters: { ...filters, result: true } })]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: rejected.fetcher }),
    /unrequested outcome filter/,
  );
  assert.equal(rejected.count(), 1);
  const repaired = sequenceTransport(
    [
      planner({ ...base, filters: { ...filters, result: true } }),
      planner(base),
      writer,
      { decision: 'approve' },
    ],
    (packet, call) => {
      if (call === 1) assert.match(packet.planningError, /unrequested outcome filter/);
      if (call === 2) {
        assert.equal(packet.requestedEvidence[0].rows[0].player, 'M. Costa');
        assert.equal(packet.requestedEvidence[0].query.filters.result, undefined);
      }
    },
  );
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: repaired.fetcher,
    canRepair: (required) => required === 3,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.planningRepairs, 1);
  assert.match(result.answer, /Costa/);
  assert.doesNotMatch(result.answer, /Diallo/);
  assert.equal(result.provenance.modelGenerated, true);
  const qualified = {
    ...question,
    question: 'Who made the most recent completed right-footed pass?',
  };
  const success = sequenceTransport([
    planner({ ...base, filters: { ...filters, result: true } }),
    (packet) => {
      const query = packet.requestedEvidence[0],
        row = query.rows[0];
      return {
        scope: 'match',
        claims: [
          {
            text: `${row.player} made the latest completed right-footed pass at ${row.clock}.`,
            kind: 'observation',
            evidence: [...row.evidence, query.scopeReference],
          },
        ],
        followUp: '',
      };
    },
    { decision: 'approve' },
  ]);
  const qualifiedResult = await answerMatchQuestionAI(qualified, {
    config,
    fetcher: success.fetcher,
  });
  assert.match(qualifiedResult.answer, /Diallo/);
  assert.equal(qualifiedResult.execution.modelCalls, 3);
  assert.equal(qualifiedResult.execution.repairs, 0);
});

test('general explanations outside retrieved rules have general-only wire kinds and no match dependencies', async () => {
  const question = { ...input, question: 'What is a low block?' };
  const answer = {
    scope: 'general',
    claims: [
      {
        text: 'A low block is a compact defensive shape close to a team’s own goal.',
        kind: 'general',
        evidence: [],
        dependsOn: [],
      },
    ],
    followUp: '',
  };
  const mock = sequenceTransport(
    [
      { mentionedPlayers: [], decision: { kind: 'general', concepts: [] } },
      answer,
      { decision: 'approve' },
    ],
    (_packet, call, body) => {
      if (call === 1) {
        const schema = body.response_format.json_schema.schema;
        assert.deepEqual(schema.properties.claims.items.properties.kind.enum, [
          'general',
          'limitation',
        ]);
        assert.deepEqual(schema.properties.scope.enum, ['general', 'clarify']);
        assert.equal(schema.properties.claims.items.properties.dependsOn.maxItems, 0);
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.provenance.modelGenerated, true);
  assert.equal(result.knowledgeReference, undefined);
  assert.equal(result.execution.modelCalls, 3);
});

test('typed action outcomes distinguish false, explicit null and absent source fields', () => {
  assert.deepEqual(actionOutcome({ type: 'pass', result: false }), {
    status: 'failed',
    basis: 'result-boolean',
  });
  assert.deepEqual(actionOutcome({ type: 'pass', result: true }), {
    status: 'completed',
    basis: 'result-boolean',
  });
  assert.deepEqual(actionOutcome({ type: 'pass', result: null }), {
    status: 'pending',
    basis: 'result-null',
  });
  assert.deepEqual(actionOutcome({ type: 'pass' }), { status: 'unknown', basis: 'result-absent' });
  assert.deepEqual(actionOutcome({ type: 'shot', result: false, outcome: 'saved' }), {
    status: 'saved',
    basis: 'result-and-outcome',
  });
  assert.deepEqual(actionOutcome({ type: 'shot', result: false }), {
    status: 'not-goal',
    basis: 'result-boolean',
  });
  assert.equal(actionOutcome({ type: 'recovery', result: false }), null);
});

test('known failed pass outcome cannot be called unknown; target recipient and chronology proof survive bounded repair', async () => {
  const question = {
    kind: 'sustained',
    seed: 59231,
    time: 67,
    question: 'Who made the most recent right-footed pass?',
  };
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', bodyPart: 'right-foot' },
          order: 'desc',
          limit: 1,
          aggregate: 'list',
        },
      ],
    },
  };
  let pass;
  const wrong = (packet) => {
    pass = packet.requestedEvidence[0].rows[0];
    assert.equal(pass.result, false);
    assert.equal(pass.outcome, undefined);
    assert.equal(pass.actionOutcome.status, 'failed');
    assert.equal(pass.recipientStatus, 'target-only');
    assert.equal(pass.targetPlayer, 'A. Rossi');
    assert.equal(pass.receiverName, undefined);
    return {
      scope: 'match',
      claims: [
        {
          text: 'This pass was aimed at A. Rossi but the outcome is not recorded as successful or unsuccessful.',
          kind: 'observation',
          evidence: pass.evidence,
        },
      ],
      followUp: '',
    };
  };
  const mock = sequenceTransport(
    [
      planner,
      wrong,
      (packet) => {
        assert.ok(
          packet.feedback.issues.some(
            (issue) => issue.correctRecord.actionOutcome.status === 'failed',
          ),
        );
        return {
          scope: 'match',
          claims: [
            {
              text: 'M. Costa made the latest right-footed pass at 01:02; the pass failed.',
              kind: 'observation',
              evidence: pass.evidence,
            },
          ],
          followUp: '',
        };
      },
      { decision: 'approve' },
    ],
    (packet, call) => {
      if (call === 3) {
        assert.ok(packet.answer.claims[0].evidence.some((ref) => ref.type === 'scope'));
        assert.ok(
          packet.evidence.queryResults.some((q) => q.query.order === 'desc' && q.query.limit === 1),
        );
        assert.equal(
          packet.evidence.linkedContext.rows.find((row) => row.id === pass.id).actionOutcome.status,
          'failed',
        );
      }
    },
  );
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: (required) => required === 2,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.match(result.answer, /failed/);
  assert.doesNotMatch(result.answer, /not recorded/);
  assert.equal(result.citationAugmentations[0].reason, 'verified-ordered-event-scope');
  assert.match(result.citationAugmentations[0].reference.id, /^match-query-/);
});

test('ordered scope supplementation fails closed for wrong endpoints and unrequested filtered subsets', () => {
  const source = { kind: 'sustained', seed: 59231, time: 67 };
  const state = matchState(source),
    query = executeMatchQuery(source, {
      filters: { type: 'pass', bodyPart: 'right-foot' },
      order: 'desc',
      limit: 1,
      aggregate: 'list',
    });
  const packet = {
    question: 'Who made the most recent right-footed pass?',
    observedAt: 67,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [query],
    queryResults: [query],
  };
  const row = query.rows[0],
    answer = (text) => ({
      scope: 'match',
      claims: [{ text, kind: 'observation', evidence: row.evidence }],
      followUp: '',
    });
  const checked = checkActionEvidence(
    answer('M. Costa made the latest right-footed pass.'),
    packet,
  );
  assert.equal(checked.issues.length, 0);
  assert.equal(checked.augmentations.length, 1);
  assert.deepEqual(checked.answer.claims[0].evidence.at(-1), query.scopeReference);
  assert.equal(
    checkActionEvidence(answer('M. Costa made the first right-footed pass.'), packet).issues.length,
    1,
  );
  const completed = executeMatchQuery(source, {
    filters: { type: 'pass', result: true },
    order: 'desc',
    limit: 1,
    aggregate: 'list',
  });
  const narrowed = {
    ...packet,
    question: 'Who made the last pass?',
    requestedEvidence: [completed],
    queryResults: [completed],
  };
  const falseLatest = {
    scope: 'match',
    claims: [
      {
        text: 'H. Diallo made the latest pass.',
        kind: 'observation',
        evidence: completed.rows[0].evidence,
      },
    ],
    followUp: '',
  };
  assert.equal(checkActionEvidence(falseLatest, narrowed).issues.length, 1);
  assert.equal(
    checkActionEvidence(answer('No other right-footed passes occurred after this time.'), packet)
      .augmentations.length,
    1,
  );
});

test('raw ambiguous surname prevents a model-expanded identity from choosing one roster player', async () => {
  const question = { kind: 'quiet', seed: 48371, time: 72, question: 'How is Costa doing?' };
  const mock = sequenceTransport(
    [
      {
        mentionedPlayers: ['M. Costa'],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'pass', player: 'away-7' }, aggregate: 'list' }],
        },
      },
    ],
    (packet, call) => {
      assert.equal(call, 0);
      assert.equal(packet.ambiguousPlayerMentions[0].status, 'ambiguous');
      assert.equal(packet.ambiguousPlayerMentions[0].input, 'Costa');
      assert.equal(packet.ambiguousPlayerMentions[0].candidates.length, 2);
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.scope, 'clarify');
  assert.match(result.answer, /E\. Costa/);
  assert.match(result.answer, /M\. Costa/);
  assert.doesNotMatch(result.answer, /zero|no recorded|not contributing/i);
  assert.equal(result.execution.modelCalls, 1);
  assert.equal(result.execution.repairs, 0);
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.provenance.source, 'verified-lineup-resolution');
  assert.deepEqual(result.moments, []);
  assert.ok(result.evidence.every((ref) => ref.type === 'scope'));
  for (const text of [
    'How is M. Costa doing?',
    'How is Harbour Athletic’s Costa doing?',
    'Compare both Costas.',
  ]) {
    const invalid = sequenceTransport([{ invalid: 'stop at planner' }], (packet) => {
      assert.equal(packet.ambiguousPlayerMentions, undefined, text);
    });
    await assert.rejects(
      answerMatchQuestionAI({ ...question, question: text }, { config, fetcher: invalid.fetcher }),
    );
    assert.equal(invalid.count(), 1);
  }
});

test('pending goal answer retains known scoreboard and unresolved latest shot despite omitted duplicate zero extraction', async () => {
  const question = { kind: 'counter', seed: 48371, time: 117, question: 'Goal?' };
  let goals, shot;
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        { filters: { type: 'shot', outcome: 'goal' }, aggregate: 'list', order: 'desc', limit: 1 },
      ],
    },
  };
  const mock = sequenceTransport([
    planner,
    (packet) => {
      goals = wireQueries(packet).find(
        (q) =>
          q.query.aggregate === 'by-team' &&
          q.query.filters.type === 'shot' &&
          q.query.filters.result === true,
      );
      shot = packet.pendingOutcomeContext.attempts[0];
      return {
        scope: 'match',
        claims: [
          {
            text: 'No goals have been recorded in the match by 01:57, as confirmed by the complete goal count scopes showing zero goals for both teams.',
            kind: 'observation',
            evidence: [goals.scopeReference],
          },
          {
            text: 'The latest shot by A. Reed at 01:56 is still pending and has not been confirmed as a goal or miss.',
            kind: 'observation',
            evidence: shot.evidence,
          },
        ],
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      reason: 'Confirmed scoreboard and pending attempt are distinguished',
      checks: [
        {
          claimIndex: 0,
          actors: [],
          inventedFacts: [],
          supported: true,
          reason: 'Complete goal scope is zero',
          counts: ['home', 'away'].map((groupKey) => ({
            text: 'zero goals for both teams',
            value: 0,
            scopeReference: goals.scopeReference,
            groupKey,
          })),
        },
        {
          claimIndex: 1,
          actors: [{ name: 'A. Reed', action: 'shot', individualAction: true }],
          inventedFacts: [],
          counts: [],
          supported: true,
          reason: 'Current shot is pending',
        },
      ],
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /pending/);
  assert.ok(result.reviewAugmentations.some((augmentation) => augmentation.span === 'No goals'));
  assert.ok(
    result.reviewAugmentations.every(
      (augmentation) =>
        augmentation.reason === 'verified-omitted-count-binding' &&
        augmentation.scopeReference.id.startsWith('match-query-'),
    ),
  );
  assert.ok(
    result.citationAugmentations.some(
      (augmentation) => augmentation.reason === 'verified-ordered-event-scope',
    ),
  );
});

test('indexed numeric review binds immutable assertion spans and rejects missing, duplicate, mixed and invalid indices', () => {
  const answer = {
    claims: [
      { kind: 'observation', text: 'Reed has 2 shots and 1 goal.' },
      { kind: 'interpretation', text: 'That suggests a threat.' },
    ],
  };
  const scopeReference = { type: 'scope', id: 'count-proof', revision: 1 };
  const make = () => ({
    numericBindingMode: 'assertion-index-v1',
    checks: [
      {
        claimIndex: 0,
        counts: [
          { assertionIndex: 0, scopeReference, groupKey: 'home-10' },
          { assertionIndex: 1, scopeReference, groupKey: 'home-10' },
        ],
      },
      { claimIndex: 1, counts: [] },
    ],
  });
  const reviewed = resolveNumericReview(make(), answer);
  assert.deepEqual(
    reviewed.checks[0].counts.map(({ text, value }) => ({ text, value })),
    [
      { text: '2 shots', value: 2 },
      { text: '1 goal', value: 1 },
    ],
  );
  assert.equal(reviewed.numericBindings.length, 2);
  for (const mutate of [
    (r) => r.checks[0].counts.pop(),
    (r) => (r.checks[0].counts = []),
    (r) => (r.checks[0].counts[1].assertionIndex = 0),
    (r) => (r.checks[0].counts[0].assertionIndex = 4),
    (r) => (r.checks[0].counts[0].text = '2 shots'),
    (r) => (r.checks[0].counts[0].value = 99),
    (r) => (r.checks[1].claimIndex = 0),
    (r) => (r.checks[0].counts[0].assertionIndex = '0'),
  ]) {
    const value = make();
    mutate(value);
    assert.throws(
      () => resolveNumericReview(value, answer),
      (error) => error.code === 'question-invalid-review',
    );
  }
  const legacy = {
    checks: [
      {
        claimIndex: 0,
        counts: [{ text: '2 shots', value: 2, scopeReference, groupKey: 'home-10' }],
      },
    ],
  };
  assert.equal(
    resolveNumericReview(legacy, answer),
    legacy,
    'Historical offline fixtures retain their old protocol',
  );
});

test('actual review wire requires per-claim assertion indices including a zero at an explicit observation clock', async () => {
  const question = { kind: 'counter', seed: 48371, time: 117, question: 'Goal?' };
  const mock = sequenceTransport([
    { draft: null, queries: [{ filters: { type: 'shot', result: true }, aggregate: 'by-team' }] },
    (_body, request) => {
      const packet = JSON.parse(request.messages.at(-1).content),
        scope = wireQueries(packet).find(
          (q) => q.query.aggregate === 'by-team' && q.query.filters.result === true,
        ).scopeReference;
      return {
        scope: 'match',
        claims: [
          {
            text: 'No goals have been recorded in the match up to 01:57.',
            kind: 'observation',
            evidence: [scope],
          },
        ],
        followUp: '',
      };
    },
    (_body, request) => {
      const packet = JSON.parse(request.messages.at(-1).content),
        schema = request.response_format.json_schema.schema,
        variant = schema.properties.checks.items.anyOf[0];
      assert.equal(variant.properties.counts.minItems, 1);
      assert.equal(variant.properties.counts.maxItems, 1);
      assert.deepEqual(variant.properties.counts.items.properties.assertionIndex.enum, [0]);
      assert.equal(variant.properties.counts.items.properties.text, undefined);
      assert.equal(variant.properties.counts.items.properties.value, undefined);
      assert.deepEqual(
        packet.numericAssertions[0].assertions.map(({ text, value }) => ({ text, value })),
        [{ text: 'No goals', value: 0 }],
      );
      return {
        decision: 'approve',
        reason: 'Bound confirmed score.',
        numericBindingMode: 'assertion-index-v1',
        checks: [
          {
            claimIndex: 0,
            actors: [],
            inventedFacts: [],
            counts: [
              {
                assertionIndex: 0,
                scopeReference: packet.answer.claims[0].evidence[0],
                groupKey: null,
              },
            ],
            supported: true,
            reason: 'Confirmed scoreboard, not a pending-shot verdict.',
          },
        ],
      };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.numericReviewBindings[0].value, 0);
});

test('actual match writer selects canonical last-action facts and never authors observations or receiver roles', async () => {
  const question = { kind: 'sustained', seed: 48371, time: 67, question: 'Last pass?' };
  let selected;
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet, body) => {
      const schema = resolvedWireSchema(body);
      assert.ok(schema.required.includes('composition'));
      assert.equal(schema.properties.claims, undefined);
      assert.deepEqual(
        schema.properties.composition.anyOf
          .find((mode) => mode.properties.mode.enum[0] === 'explanation')
          .properties.claim.anyOf.flatMap((branch) => branch.properties.kind.enum),
        ['interpretation', 'limitation', 'general'],
      );
      selected = packet.matchFacts.facts.find(
        (fact) => fact.selection.kind === 'ordered-event' && fact.selection.metric === 'passes',
      );
      assert.ok(selected);
      assert.match(selected.claim.text, /Costa/);
      assert.match(selected.claim.text, /unsuccessful|failed/i);
      return { scope: 'match', selectedFactIds: [selected.id], claims: [], followUp: '' };
    },
    (packet, body) => {
      assert.equal(packet.answer.claims[0].text, selected.claim.text);
      assert.equal(packet.answer.claims[0].kind, selected.claim.kind);
      assert.ok(
        packet.answer.claims[0].evidence.length > 0,
        'review retains canonical citations omitted from writer transport',
      );
      assert.deepEqual(packet.canonicalClaimIndices, [0]);
      assert.deepEqual(packet.numericAssertions, []);
      const variant = resolvedWireSchema(body).properties.checks.items.anyOf[0];
      assert.equal(variant.properties.actors.maxItems, 0);
      assert.equal(variant.properties.counts.maxItems, 0);
      // Contradictory legacy extraction cannot rewrite a program-verified fact.
      return {
        decision: 'approve',
        reason: 'The latest pass fact directly answers this request.',
        checks: [
          {
            claimIndex: 0,
            actors: [{ name: 'A. Rossi', action: 'receive', individualAction: true }],
            counts: [],
            inventedFacts: [],
            supported: true,
            reason: 'Exact selected event is relevant.',
          },
        ],
      };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.answer, selected.claim.text);
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.provenance.source, 'verified-facts-with-ai-analysis');
  assert.equal(result.claimProvenance[0].modelGenerated, false);
  assert.equal(result.canonicalFactSelection.selectedFactIds[0], selected.id);
  assert.ok(
    result.evidence.some(
      (ref) => ref.type === 'event' && ref.id.endsWith('pass-62') && ref.revision === 2,
    ),
  );
  assert.ok(
    result.evidence.some((ref) => ref.type === 'scope' && !ref.id.startsWith('scope-')),
    'Returned scope references are canonical, not temporary model handles',
  );
});

test('selected shooting profiles keep exact arithmetic and distinguish app facts from a reviewed opinion', async () => {
  const question = {
    kind: 'duel',
    seed: 48371,
    time: 120,
    question: 'Would you say Reed has looked more dangerous than Silva?',
  };
  let profiles;
  const mock = sequenceTransport([
    {
      mentionedPlayers: ['A. Reed', 'D. Silva'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot', player: 'A. Reed' }, aggregate: 'list' },
          { filters: { type: 'shot', player: 'D. Silva' }, aggregate: 'list' },
        ],
      },
    },
    (packet) => {
      profiles = ['home-10', 'away-10'].map((id) =>
        packet.matchFacts.facts.find(
          (fact) =>
            fact.selection.kind === 'shooting-profile' &&
            fact.selection.subjectId === id &&
            fact.selection.timeFrom === 0 &&
            fact.selection.timeTo === 120,
        ),
      );
      assert.ok(profiles.every(Boolean));
      return {
        scope: 'match',
        selectedFactIds: profiles.map((fact) => fact.id),
        claims: [
          {
            text: 'Reed looks more threatening on the recorded shot outcomes, though that does not measure chance quality.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        ],
        followUp: '',
      };
    },
    (packet) => {
      assert.deepEqual(packet.canonicalClaimIndices, [0, 1]);
      assert.equal(packet.answer.claims[2].kind, 'interpretation');
      assert.deepEqual(packet.answer.claims[2].evidence, [
        ...new Map(
          packet.answer.claims
            .slice(0, 2)
            .flatMap((claim) => claim.evidence)
            .map((ref) => [JSON.stringify(ref), ref]),
        ).values(),
      ]);
      return { decision: 'approve', reason: 'Provisional comparison grounded in both profiles.' };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.deepEqual(
    result.claims.slice(0, 2).map((claim) => claim.text),
    profiles.map((fact) => fact.claim.text),
  );
  assert.deepEqual(
    result.claimProvenance.map((claim) => claim.modelGenerated),
    [false, false, true],
  );
  assert.equal(result.provenance.modelGenerated, true);
  assert.equal(result.claimDependencies[0].claimIndex, 2);
  assert.deepEqual(result.claimDependencies[0].observationIndices, [0, 1]);
});

test('canonical fact selection rejects fabricated IDs, authored observation text, invalid dependencies and irrelevant selections', async () => {
  const question = { kind: 'sustained', seed: 48371, time: 67, question: 'Last pass?' };
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 }],
    },
  };
  for (const mode of ['unknown', 'duplicate', 'observation', 'dependency']) {
    const mock = sequenceTransport([
      planner,
      (packet) => {
        const id = packet.matchFacts.facts[0].id;
        return {
          scope: 'match',
          selectedFactIds:
            mode === 'unknown' ? ['fact-invented'] : mode === 'duplicate' ? [id, id] : [id],
          claims:
            mode === 'observation'
              ? [{ kind: 'observation', text: 'A made-up observation.', evidence: [] }]
              : mode === 'dependency'
                ? [
                    {
                      kind: 'interpretation',
                      text: 'Unsupported inference.',
                      evidence: [],
                      dependsOn: [3],
                    },
                  ]
                : [],
          followUp: '',
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-fact-selection',
    );
    assert.equal(mock.count(), 2);
  }
  const irrelevant = sequenceTransport([
    planner,
    (packet) => ({
      scope: 'match',
      selectedFactIds: [packet.matchFacts.facts.find((fact) => fact.selection.kind === 'count').id],
      claims: [],
      followUp: '',
    }),
    {
      decision: 'withhold',
      requestCheck: {
        status: 'not-answered',
        reason: 'A cumulative total does not identify the latest pass.',
      },
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: irrelevant.fetcher }),
    (error) => error.code === 'question-withheld',
  );
  assert.equal(irrelevant.count(), 3);
});

test('indexed numeric protocol does not turn a wrong subject binding into valid arithmetic', async () => {
  const question = {
    kind: 'sustained',
    seed: 8341,
    time: 110,
    question: 'How many completed passes does Northbridge have?',
  };
  const mock = sequenceTransport([
    { draft: null, queries: [{ filters: { type: 'pass', result: true }, aggregate: 'by-team' }] },
    (packet) => {
      const scope = wireQueries(packet).find(
        (q) =>
          q.query.aggregate === 'by-team' &&
          q.query.filters.type === 'pass' &&
          q.query.filters.result === true,
      ).scopeReference;
      return {
        scope: 'match',
        claims: [
          { text: 'Northbridge has 5 completed passes.', kind: 'observation', evidence: [scope] },
        ],
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      reason: 'Intentionally wrong group binding.',
      numericBindingMode: 'assertion-index-v1',
      checks: [
        {
          claimIndex: 0,
          actors: [],
          inventedFacts: [],
          counts: [
            {
              assertionIndex: 0,
              scopeReference: packet.answer.claims[0].evidence[0],
              groupKey: 'away',
            },
          ],
          supported: true,
          reason: 'Wrong group despite correct indexed text.',
        },
      ],
    }),
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) =>
      error.code === 'question-withheld' &&
      error.feedback.actorIssues.some((issue) => issue.claimed === 5),
  );
  assert.equal(mock.count(), 3);
});

test('canonical selections still require semantic relevance and one repaired selection stays inside five calls', async () => {
  const question = { kind: 'sustained', seed: 48371, time: 67, question: 'Last pass?' };
  let latest;
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 }],
    },
  };
  const mock = sequenceTransport([
    planner,
    (packet) => {
      latest = packet.matchFacts.facts.find(
        (fact) => fact.selection.kind === 'ordered-event' && fact.selection.metric === 'passes',
      );
      return {
        scope: 'match',
        selectedFactIds: [
          packet.matchFacts.facts.find((fact) => fact.selection.kind === 'count').id,
        ],
        claims: [],
        followUp: '',
      };
    },
    {
      decision: 'withhold',
      requestCheck: {
        status: 'not-answered',
        reason: 'A cumulative total does not identify the latest pass.',
      },
    },
    (packet, body) => {
      assert.ok(body.response_format.json_schema.schema.required.includes('composition'));
      assert.ok(packet.evidence.matchFacts.facts.some((fact) => fact.id === latest.id));
      return { scope: 'match', selectedFactIds: [latest.id], claims: [], followUp: '' };
    },
    { decision: 'approve', reason: 'The selected latest action now answers the request.' },
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.equal(result.execution.repairs, 1);
  assert.equal(result.answer, latest.claim.text);
  assert.equal(result.provenance.modelGenerated, false);
});

test('canonical fact selection cannot launder a false model-authored numerical interpretation', async () => {
  const question = {
    kind: 'duel',
    seed: 48371,
    time: 120,
    question: 'How threatening has Reed looked?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: ['A. Reed'],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', player: 'A. Reed' }, aggregate: 'list' }],
      },
    },
    (packet) => {
      const profile = packet.matchFacts.facts.find(
        (fact) =>
          fact.selection.kind === 'shooting-profile' && fact.selection.subjectId === 'home-10',
      );
      assert.ok(profile);
      return {
        scope: 'match',
        selectedFactIds: [profile.id],
        claims: [
          { text: 'A. Reed has 99 shots.', kind: 'interpretation', evidence: [], dependsOn: [0] },
        ],
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      reason: 'Incorrect review deliberately approves a fabricated total.',
      numericBindingMode: 'assertion-index-v1',
      checks: packet.answer.claims.map((_claim, claimIndex) => ({
        claimIndex,
        actors: [],
        inventedFacts: [],
        counts: claimIndex
          ? [
              {
                assertionIndex: 0,
                scopeReference: packet.answer.claims[claimIndex].evidence[0],
                groupKey: 'home-10',
              },
            ]
          : [],
        supported: true,
        reason: 'Mock approval',
      })),
    }),
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld',
  );
  assert.ok(mock.count() <= 3);
});

test('canonical pending-shot facts keep confirmed scoreboard separate from the unresolved event without numeric re-extraction', async () => {
  const question = { kind: 'counter', seed: 48371, time: 117, question: 'Goal?' };
  let selections;
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet) => {
      const pending = packet.matchFacts.facts.find(
        (fact) => fact.selection.kind === 'ordered-event' && fact.selection.metric === 'attempts',
      );
      const zeros = ['home', 'away'].map((id) =>
        packet.matchFacts.facts.find(
          (fact) =>
            fact.selection.kind === 'count' &&
            fact.selection.metric === 'goals' &&
            fact.selection.subjectId === id &&
            fact.selection.timeFrom === 0,
        ),
      );
      assert.ok(pending);
      assert.match(pending.claim.text, /pending|awaiting/i);
      assert.ok(zeros.every(Boolean));
      selections = [...zeros, pending];
      assert.ok(
        packet.matchFacts.facts.every((fact) => fact.proof === undefined),
        'Writer receives compact selection metadata, not repeated proof bodies',
      );
      return {
        scope: 'match',
        selectedFactIds: selections.map((fact) => fact.id),
        claims: [],
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      reason: 'Confirmed score and pending attempt both present.',
      numericBindingMode: 'assertion-index-v1',
      checks: packet.answer.claims.map((_claim, claimIndex) => ({
        claimIndex,
        actors: [],
        counts: [],
        inventedFacts: [],
        supported: true,
        reason: 'Relevant canonical source fact.',
      })),
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.deepEqual(
    result.claims.map((claim) => claim.text),
    selections.map((fact) => fact.claim.text),
  );
  assert.equal(result.provenance.modelGenerated, false);
  assert.equal(result.canonicalFactSelection.proofs.length, 3);
  assert.ok(
    result.canonicalFactSelection.proofs.some(
      (proof) => proof.kind === 'count' && proof.value === 0,
    ),
  );
});

test('composition wire enforces joint budgets and four canonical pending facts need no redundant prose', async () => {
  const question = { kind: 'counter', seed: 48371, time: 117, question: 'Goal?' };
  let chosen;
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet, body) => {
      const schema = resolvedWireSchema(body),
        modes = Object.fromEntries(
          schema.properties.composition.anyOf.map((mode) => [mode.properties.mode.enum[0], mode]),
        );
      assert.equal(schema.properties.claims, undefined);
      assert.equal(schema.properties.selectedFactIds, undefined);
      assert.deepEqual(modes.facts.required, ['mode', 'factIds']);
      assert.equal(modes.facts.properties.factIds.minItems, 1);
      assert.equal(modes.facts.properties.factIds.maxItems, 4);
      assert.deepEqual(modes.explanation.required, ['mode', 'factIds', 'claim']);
      assert.equal(modes.explanation.properties.factIds.maxItems, 3);
      assert.ok(
        modes.explanation.properties.claim.anyOf.every(
          (branch) => branch.type === 'object' && branch.properties.evidence.maxItems === 0,
        ),
      );
      assert.equal(modes.limitation.properties.factIds.maxItems, 0);
      assert.deepEqual(modes.limitation.properties.claim.properties.kind.enum, ['limitation']);
      const explanations = schema.properties.composition.anyOf.filter(
        (mode) => mode.properties.mode.enum[0] === 'explanation',
      );
      assert.equal(explanations.length, 3);
      explanations.forEach((mode, index) => {
        assert.equal(mode.properties.factIds.minItems, index + 1);
        assert.equal(mode.properties.factIds.maxItems, index + 1);
        const [interpretation, nonInterpretive] = mode.properties.claim.anyOf;
        assert.deepEqual(interpretation.properties.kind.enum, ['interpretation']);
        assert.equal(interpretation.properties.dependsOn.minItems, index + 1);
        assert.deepEqual(
          interpretation.properties.dependsOn.items.enum,
          Array.from({ length: index + 1 }, (_v, i) => i),
        );
        assert.deepEqual(nonInterpretive.properties.kind.enum, ['limitation', 'general']);
        assert.equal(nonInterpretive.properties.dependsOn.maxItems, 0);
      });
      const policy = body.messages[0].content;
      assert.match(policy, /Choose ONE composition mode/);
      assert.doesNotMatch(
        policy,
        /Every observation or interpretation needs|Return the required answer JSON schema|Select only fact IDs needed/,
      );
      chosen = ['home', 'away'].map((id) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === 'goals' &&
            f.selection.subjectId === id &&
            f.selection.timeFrom === 0,
        ),
      );
      chosen.push(
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === 'pendingShots' &&
            f.selection.subjectId === 'home-10',
        ),
      );
      chosen.push(
        packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
        ),
      );
      assert.ok(chosen.every(Boolean));
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: chosen.map((f) => f.id) },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'Confirmed counts and the unresolved latest attempt answer the question.',
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 4);
  assert.deepEqual(
    result.claims.map((c) => c.text),
    chosen.map((f) => f.claim.text),
  );
  assert.equal(result.provenance.modelGenerated, false);
});

test('composition explanation uses two shooting profiles and exactly one dependent opinion', async () => {
  const question = {
    kind: 'duel',
    seed: 48371,
    time: 120,
    question: 'Would you say Reed has looked more dangerous than Silva?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: ['A. Reed', 'D. Silva'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot', player: 'A. Reed' }, aggregate: 'list' },
          { filters: { type: 'shot', player: 'D. Silva' }, aggregate: 'list' },
        ],
      },
    },
    (packet) => {
      const profiles = ['home-10', 'away-10'].map((id) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'shooting-profile' &&
            f.selection.subjectId === id &&
            f.selection.timeFrom === 0,
        ),
      );
      assert.ok(profiles.every(Boolean));
      assert.ok(
        !packet.matchFacts.facts.some((f) => f.selection.kind === 'ordered-event'),
        'A full default-ordered list should not introduce incidental first-shot facts',
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: profiles.map((f) => f.id),
          claim: {
            text: 'Reed looks more threatening on the recorded outcomes, although these attempts do not measure chance quality.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    { decision: 'approve', reason: 'Qualified assessment based on both profiles.' },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.claims.length, 3);
  assert.deepEqual(
    result.claimProvenance.map((c) => c.modelGenerated),
    [false, false, true],
  );
  assert.equal(result.execution.modelCalls, 3);
});

test('composition runtime rejects mixed modes, oversized selections, duplicate facts and unsupported prose dependencies', async () => {
  const question = { kind: 'sustained', seed: 48371, time: 67, question: 'Last pass?' };
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 }],
    },
  };
  const claim = {
    text: 'A short explanation.',
    kind: 'interpretation',
    evidence: [],
    dependsOn: [0],
  };
  for (const make of [
    (ids) => ({ mode: 'facts', factIds: ids.slice(0, 4), claim }),
    (ids) => ({ mode: 'facts', factIds: ids.slice(0, 5) }),
    (ids) => ({ mode: 'facts', factIds: [ids[0], ids[0]] }),
    (ids) => ({ mode: 'explanation', factIds: ids.slice(0, 4), claim }),
    (ids) => ({ mode: 'explanation', factIds: [ids[0]], claim: { ...claim, dependsOn: [] } }),
    (ids) => ({ mode: 'explanation', factIds: [ids[0]], claim: { ...claim, dependsOn: [1] } }),
    (ids) => ({ mode: 'explanation', factIds: [ids[0]], claim: { ...claim, kind: 'observation' } }),
    (ids) => ({
      mode: 'limitation',
      factIds: [ids[0]],
      claim: { ...claim, kind: 'limitation', dependsOn: [] },
    }),
    (ids) => ({ mode: 'facts', factIds: [] }),
  ]) {
    const mock = sequenceTransport([
      planner,
      (packet) => ({
        scope: 'match',
        composition: make(packet.matchFacts.facts.map((f) => f.id)),
        followUp: '',
      }),
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) => error.code === 'question-invalid-fact-selection',
    );
    assert.equal(mock.count(), 2);
  }
  const mixed = sequenceTransport([
    planner,
    (packet) => ({
      scope: 'match',
      composition: { mode: 'facts', factIds: [packet.matchFacts.facts[0].id] },
      claims: [],
      followUp: '',
    }),
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mixed.fetcher }),
    (error) => error.code === 'question-invalid-fact-selection',
  );
});

test('a standalone limitation has no selected facts and one paragraph, and oversized legacy repair uses the dedicated composition policy', async () => {
  const question = {
    kind: 'sustained',
    seed: 48371,
    time: 67,
    question: 'Can you tell what pressure caused that pass to fail?',
  };
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 }],
    },
  };
  const limitation = {
    text: 'The recorded actions do not establish what pressure caused the pass to fail.',
    kind: 'limitation',
    evidence: [],
    dependsOn: [],
  };
  const limited = sequenceTransport([
    planner,
    {
      scope: 'match',
      composition: { mode: 'limitation', factIds: [], claim: limitation },
      followUp: '',
    },
    { decision: 'approve', reason: 'Specific uncertainty is accurate.' },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: limited.fetcher });
  assert.equal(result.claims.length, 1);
  assert.equal(result.claimProvenance[0].modelGenerated, true);
  assert.equal(result.execution.modelCalls, 3);
  let latest;
  const repair = sequenceTransport([
    planner,
    (packet) => {
      latest = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'passes',
      );
      return {
        scope: 'match',
        selectedFactIds: packet.matchFacts.facts.slice(0, 4).map((f) => f.id),
        claims: [limitation],
        followUp: '',
      };
    },
    (_packet, body) => {
      assert.match(body.messages[0].content, /one bounded repair of a rejected composition/);
      assert.doesNotMatch(
        body.messages[0].content,
        /Repair a rejected football answer|Every observation or interpretation needs|up to .*concise necessary fan-facing claims/,
      );
      return {
        scope: 'match',
        composition: { mode: 'explanation', factIds: [latest.id], claim: limitation },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'The recorded outcome plus specific unknown answers the request.',
    },
  ]);
  const repaired = await answerMatchQuestionAI(question, {
    config,
    fetcher: repair.fetcher,
    canRepair: () => true,
  });
  assert.equal(repaired.execution.modelCalls, 4);
  assert.equal(repaired.execution.repairs, 1);
  assert.equal(repaired.claims.length, 2);
});

test('review preserves explicit opposing recovery linkage without granting pressure or forcing attribution', async () => {
  const question = {
    kind: 'sustained',
    seed: 48371,
    time: 67,
    question: 'What followed the unsuccessful pass?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet) => {
      const pass = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'passes',
      );
      const recovery = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'recovery' &&
          f.selection.time === 66,
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [pass.id, recovery.id],
          claim: {
            text: 'The failed pass was followed by the opposing recovery in that turnover sequence.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    (packet, body) => {
      const link = packet.recordedActionLinks.find((link) => link.next.id.endsWith('recovery-66'));
      assert.ok(link);
      assert.ok(link.prior.id.endsWith('pass-62'));
      assert.equal(link.prior.revision, 2);
      assert.deepEqual(link.sourceFields, ['cause', 'passId']);
      assert.match(link.doesNotEstablish, /Who forced/);
      assert.match(
        body.messages[0].content,
        /Linked failed-pass\/recovery events can establish sequence, not who forced/,
      );
      assert.match(packet.claimChecks[1].recoveryConstraint, /explicit prior-action link/);
      return {
        decision: 'approve',
        reason: 'A recorded linked sequence, not attribution of who forced the mistake.',
      };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 3);
});

test('dependent queries bind a recovered-ball anchor and its team before looking for subsequent shots', async () => {
  const question = {
    kind: 'interrupted',
    seed: 1007,
    time: 106,
    question: 'Who got the ball back most recently, and did their side get a shot away afterwards?',
  };
  let chosen;
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'recovery', recoveryClass: 'ball-win' },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
        },
        {
          filters: { type: 'shot' },
          aggregate: 'list',
          order: 'asc',
          limit: 1,
          relativeTo: { queryIndex: 0, relation: 'after', sameTeam: true },
        },
      ],
    },
  };
  const mock = sequenceTransport(
    [
      planner,
      (packet, body) => {
        assert.equal(packet.queryRelations.length, 1);
        const relation = packet.queryRelations[0];
        assert.equal(relation.anchorTime, 92);
        assert.equal(relation.anchorTeam, 'away');
        assert.equal(relation.query.timeFrom, 92);
        assert.equal(relation.query.timeFromExclusive, true);
        assert.equal(relation.query.timeTo, 106);
        assert.equal(relation.query.filters.team, 'away');
        assert.notEqual(
          relation.query.timeFrom,
          packet.observedAt,
          'Afterwards binds the requested event, not the observation pin',
        );
        chosen = [
          packet.matchFacts.facts.find(
            (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'ballWins',
          ),
          packet.matchFacts.facts.find(
            (f) =>
              f.selection.kind === 'ordered-event' &&
              f.selection.metric === 'attempts' &&
              f.selection.timeFrom === 92,
          ),
        ];
        assert.ok(chosen.every(Boolean));
        assert.match(chosen[0].claim.text, /Patel/);
        assert.match(chosen[1].claim.text, /Evans/);
        return {
          scope: 'match',
          composition: { mode: 'facts', factIds: chosen.map((f) => f.id) },
          followUp: '',
        };
      },
      (packet) => ({
        decision: 'approve',
        reason: 'Correct action class and dependent same-team sequence.',
        requestCheck: {
          status: 'answered',
          requestedInformation: question.question,
          reason: 'Both components covered.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: 'fact',
            requestedAction: index ? 'shot' : 'ball-win',
            temporalRelation: index ? 'after-requested-event' : 'none',
          })),
        },
      }),
    ],
    (packet, index, body) => {
      if (index === 0) {
        assert.match(packet.actionOntology.receive, /not evidence of taking possession back/);
        assert.match(body.messages[0].content, /relativeTo/);
        const variants = decisionBranch(body, 'queries').properties.queries.items.anyOf;
        assert.ok(variants.every((variant) => variant.properties.relativeTo));
        for (const variant of variants.filter(
          (variant) =>
            variant.properties.relativeTo.type === 'object' &&
            !variant.properties.relativeTo.properties.relation.enum.includes('none'),
        ))
          for (const field of ['timeFrom', 'timeTo', 'timeFromExclusive', 'timeToExclusive'])
            assert.deepEqual(variant.properties[field], { type: 'null' });
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.queryRelations[0].anchorTime, 92);
  assert.deepEqual(
    result.claims.map((claim) => claim.text),
    chosen.map((f) => f.claim.text),
  );
});

test('relative query resolution rejects forward, non-singleton and contradictory anchors without guessing clocks', async () => {
  const question = {
    kind: 'interrupted',
    seed: 1007,
    time: 106,
    question: 'What happened after the recovery?',
  };
  const anchor = {
    filters: { type: 'recovery', recoveryClass: 'ball-win' },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
  };
  const after = {
    filters: { type: 'shot' },
    aggregate: 'list',
    relativeTo: { queryIndex: 0, relation: 'after', sameTeam: true },
  };
  for (const queries of [
    [after],
    [anchor, { ...after, timeFrom: 106 }],
    [{ ...anchor, limit: 20 }, after],
    [anchor, { ...after, filters: { type: 'shot', team: 'home' } }],
    [anchor, { ...after, relativeTo: { queryIndex: 1, relation: 'after', sameTeam: true } }],
  ]) {
    const mock = sequenceTransport([
      { mentionedPlayers: [], decision: { kind: 'queries', queries } },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      /lookup/,
    );
    assert.equal(mock.count(), 1);
  }
});

test('relative windows remain exact when the anchor is at the observation pin and no later record exists', async () => {
  const question = {
    kind: 'sustained',
    seed: 48371,
    time: 62,
    question: 'Was there a shot after the latest pass?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass' }, aggregate: 'list', order: 'desc', limit: 1 },
          {
            filters: { type: 'shot' },
            aggregate: 'list',
            limit: 1,
            relativeTo: { queryIndex: 0, relation: 'after', sameTeam: false },
          },
        ],
      },
    },
    (packet) => {
      const relation = packet.queryRelations[0],
        source = wireQueries(packet).find(
          (q) => q.scopeReference.id === relation.scopeReference.id,
        );
      assert.equal(relation.anchorTime, 62);
      assert.equal(source.query.timeFrom, 62);
      assert.equal(source.query.timeTo, 62);
      assert.equal(source.query.timeFromExclusive, true);
      assert.equal(source.count, 0);
      const zero = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'attempts' &&
          f.selection.timeFromExclusive === true,
      );
      assert.ok(zero);
      return { scope: 'match', composition: { mode: 'facts', factIds: [zero.id] }, followUp: '' };
    },
    { decision: 'approve', reason: 'No shot is received after the selected cutoff event.' },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.queryRelations[0].query.timeFromExclusive, true);
});

test('declared requested assessment cannot be satisfied by canonical numerical profiles alone', async () => {
  const question = {
    kind: 'duel',
    seed: 48371,
    time: 120,
    question: 'Would you say Reed has looked more dangerous than Silva?',
  };
  let ids;
  const planner = {
    mentionedPlayers: ['A. Reed', 'D. Silva'],
    decision: {
      kind: 'queries',
      queries: [
        { filters: { type: 'shot', player: 'A. Reed' }, aggregate: 'list' },
        { filters: { type: 'shot', player: 'D. Silva' }, aggregate: 'list' },
      ],
    },
  };
  const review = (packet) => ({
    decision: 'approve',
    reason: 'Facts are correct.',
    requestCheck: {
      status: 'answered',
      requestedInformation: question.question,
      reason: 'Assessment requested.',
      coverage: packet.requestComponents.map((requestSpan) => ({
        requestSpan,
        claimIndices: packet.answer.claims.map((_c, index) => index),
        answerForm: 'assessment',
        requestedAction: 'shot',
        temporalRelation: 'none',
      })),
    },
  });
  const mock = sequenceTransport([
    planner,
    (packet) => {
      ids = ['home-10', 'away-10'].map(
        (id) =>
          packet.matchFacts.facts.find(
            (f) =>
              f.selection.kind === 'shooting-profile' &&
              f.selection.subjectId === id &&
              f.selection.timeFrom === 0,
          ).id,
      );
      return { scope: 'match', composition: { mode: 'facts', factIds: ids }, followUp: '' };
    },
    review,
    (packet, body) => {
      assert.equal(packet.feedback.requestAdequacy[0].answerForm, 'assessment');
      assert.match(body.messages[0].content, /qualified conclusion/);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: ids,
          claim: {
            text: 'Reed looks more threatening on the recorded shot outcomes, though those counts do not measure chance quality.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    review,
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.equal(result.claims.at(-1).kind, 'interpretation');
  assert.equal(result.execution.repairs, 1);
});

test('known shooter plus unavailable speed becomes an explicit fact and limitation, not an invented measurement or repeated omission', async () => {
  const question = {
    kind: 'counter',
    seed: 1007,
    time: 115,
    question: 'How fast did that last shot travel, and who hit it?',
  };
  let shot;
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
    },
  };
  const review = (packet) => ({
    decision: 'approve',
    reason: 'Known shooter, speed is unavailable.',
    requestCheck: {
      status: 'answered',
      requestedInformation: question.question,
      reason: 'Separate known identity and unavailable measurement.',
      coverage: packet.requestComponents.map((requestSpan, index) => ({
        requestSpan,
        claimIndices: index ? [0] : packet.answer.claims.length > 1 ? [1] : [],
        answerForm: index ? 'fact' : 'unavailable-measurement',
        requestedAction: 'shot',
        temporalRelation: 'none',
      })),
    },
  });
  const mock = sequenceTransport(
    [
      planner,
      (packet) => {
        shot = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
        );
        assert.match(shot.claim.text, /Murray/);
        return { scope: 'match', composition: { mode: 'facts', factIds: [shot.id] }, followUp: '' };
      },
      review,
      (packet, body) => {
        assert.equal(packet.feedback.requestAdequacy[0].answerForm, 'unavailable-measurement');
        assert.match(body.messages[0].content, /known fact and one limitation/);
        return {
          scope: 'match',
          composition: {
            mode: 'explanation',
            factIds: [shot.id],
            claim: {
              text: 'The shot speed is not recorded.',
              kind: 'limitation',
              evidence: [],
              dependsOn: [],
            },
          },
          followUp: '',
        };
      },
      review,
    ],
    (_packet, index, body) => {
      if (index === 2)
        assert.match(
          body.messages[0].content,
          /premiseCheck and your reasons are internal and cannot answer the fan/,
        );
    },
  );
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.equal(result.claims.length, 2);
  assert.equal(result.claims[0].text, shot.claim.text);
  assert.equal(result.claims[1].kind, 'limitation');
  assert.doesNotMatch(result.answer, /\d+\s*(?:km\/h|mph)/);
});

test('recorded contact attribute plus unavailable velocity remains two explicit components with empty limitation dependencies', async () => {
  const source = { kind: 'duel', seed: 19437, time: 14 },
    event = executeMatchQuery(source, { filters: { type: 'pass' }, order: 'asc', limit: 1 })
      .rows[0];
  const question = {
    ...source,
    anchorId: event.id,
    question: 'About that pass — which foot contacted it, and is its velocity measured?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { id: question.anchorId }, aggregate: 'list' }],
      },
    },
    (packet) => {
      assert.deepEqual(packet.requestComponents, [
        'which foot contacted it',
        'is its velocity measured',
      ]);
      const attribute = packet.matchFacts.facts.find(
        (f) =>
          f.selection.attributes?.bodyPart === event.bodyPart && f.selection.time === event.time,
      );
      assert.ok(attribute);
      assert.match(attribute.claim.text, /foot/);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [attribute.id],
          claim: {
            text: 'The velocity of that delivery is not recorded.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    (packet, body) => {
      const policy = body.messages[0].content;
      assert.match(policy, /FIRST fill responseIntent/);
      assert.doesNotMatch(policy, /SECOND check every claim|FIRST fill requestCheck/);
      assert.ok(
        body.response_format.json_schema.schema.properties.requestCheck.required.includes(
          'responseIntent',
        ),
      );
      return {
        decision: 'approve',
        requestCheck: {
          requestedInformation: question.question,
          status: 'useful-limitation',
          responseIntent: {
            purpose: 'mixed',
            needsAssessment: false,
            needsExplicitCorrection: false,
            needsMeasurementLimitation: true,
            reason: 'Known contact attribute and unrecorded velocity.',
          },
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: index ? 'unavailable-measurement' : 'fact',
            requestedAction: 'other',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
          })),
          reason: 'Both requested attributes are addressed.',
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 2);
  assert.equal(result.canonicalFactSelection.proofs[0].attributes.bodyPart, event.bodyPart);
  assert.equal(result.claimProvenance[1].modelGenerated, true);
  assert.doesNotMatch(result.answer, /\d+\s*(?:mph|km\/h)/);
});

test('implicit contribution request receives a bounded repair when whole-request intent requires an assessment', async () => {
  const source = { kind: 'interrupted', seed: 52109, time: 115 },
    player = executeMatchQuery(source, {
      filters: { type: 'pass', team: 'home' },
      order: 'desc',
      limit: 1,
    }).rows[0];
  const question = {
    ...source,
    question: `Is ${player.player} making a useful defensive contribution, or mainly circulating the ball?`,
  };
  let chosen;
  const plan = {
    mentionedPlayers: [player.player],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'recovery', recoveryClass: 'ball-win', player: player.playerId },
          aggregate: 'count',
        },
        { filters: { type: 'pass', result: true, player: player.playerId }, aggregate: 'count' },
      ],
    },
  };
  const review = (packet) => ({
    decision: 'approve',
    requestCheck: {
      requestedInformation: question.question,
      status: 'answered',
      responseIntent: {
        purpose: 'assessment',
        needsAssessment: true,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
        reason: 'The fan asks for a judgment on contribution, not raw totals.',
      },
      coverage: packet.requestComponents.map((requestSpan) => ({
        requestSpan,
        claimIndices: packet.answer.claims.map((_c, i) => i),
        answerForm: 'fact',
        requestedAction: 'other',
        temporalRelation: 'none',
        relationAnchorClaimIndex: null,
        relationEntityBinding: 'none',
      })),
      reason: 'Judgment must be explicit.',
    },
  });
  const mock = sequenceTransport([
    plan,
    (packet) => {
      chosen = ['ballWins', 'completedPasses'].map((metric) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === metric &&
            f.selection.subjectId === player.playerId,
        ),
      );
      assert.ok(chosen.every(Boolean));
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: chosen.map((f) => f.id) },
        followUp: '',
      };
    },
    review,
    (packet) => {
      assert.match(packet.feedback.requestAdequacy[0].reason, /qualified assessment/);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: chosen.map((f) => f.id),
          claim: {
            text: 'Those actions show involvement in circulation and regaining the ball, but they do not establish the overall defensive impact.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    review,
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.equal(result.claims.at(-1).kind, 'interpretation');
  assert.match(result.answer, /overall defensive impact/);
});

test('a declared false scorer premise needs an explicit correction in addition to source facts and preserves the requested attribute', async () => {
  const source = { kind: 'sustained', seed: 46382, time: 120 },
    goal = executeMatchQuery(source, {
      filters: { type: 'shot', result: true },
      order: 'desc',
      limit: 1,
    }).rows[0],
    wrong = executeMatchQuery(source, {
      filters: { type: 'pass' },
      order: 'asc',
      limit: 20,
    }).rows.find((row) => row.playerId !== goal.playerId);
  const question = { ...source, question: `Was ${wrong.player}'s goal a header?` };
  let ids;
  const premiseCheck = {
    questionAssumption: `${wrong.player} scored the goal.`,
    recordedAction: `The goal actor is ${goal.player}.`,
    conclusion: 'contradicted',
  };
  const plan = {
    mentionedPlayers: [wrong.player],
    decision: {
      kind: 'queries',
      queries: [
        { filters: { type: 'shot', result: true }, aggregate: 'list' },
        { filters: { type: 'shot', result: true, player: wrong.playerId }, aggregate: 'count' },
      ],
    },
  };
  const mock = sequenceTransport([
    plan,
    (packet) => {
      const attribute = packet.matchFacts.facts.find(
          (f) =>
            f.selection.attributes?.bodyPart === goal.bodyPart &&
            f.selection.playerId === goal.playerId &&
            f.selection.time === goal.time,
        ),
        zero = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === 'goals' &&
            f.selection.subjectId === wrong.playerId,
        );
      assert.ok(attribute && zero);
      ids = [zero.id, attribute.id];
      return {
        premiseCheck,
        scope: 'match',
        composition: { mode: 'facts', factIds: ids },
        followUp: '',
      };
    },
    (packet) => {
      assert.match(packet.feedback.requirement, /explicit correction/);
      return {
        premiseCheck,
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: ids,
          claim: {
            text: `The scorer was ${goal.player}, rather than ${wrong.player}.`,
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        requestedInformation: question.question,
        status: 'corrected-premise',
        responseIntent: {
          purpose: 'premise-correction',
          needsAssessment: false,
          needsExplicitCorrection: true,
          needsMeasurementLimitation: false,
          reason:
            'The assumed scorer needs correction and the known contact attribute is retained.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1, 2],
          answerForm: 'premise-correction',
          requestedAction: 'other',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'Explicit correction with source-bound contact attribute.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.match(result.answer, /rather than/);
  assert.ok(
    result.canonicalFactSelection.proofs.some(
      (proof) => proof.attributes?.bodyPart === goal.bodyPart,
    ),
  );
});

test('semantic coverage cannot substitute a reception or initial control for regained possession', () => {
  const input = { kind: 'interrupted', seed: 1007, time: 106 },
    state = matchState(input),
    received = state.events.find((event) => event.type === 'receive' && event.time === 103),
    won = state.events.find((event) => event.type === 'recovery' && event.time === 92),
    initial = state.events.find((event) => event.recoveryKind === 'segment-start');
  const packet = {
    question: 'Who regained possession?',
    observedAt: 106,
    queryResults: [],
    linkedContext: { rows: [received, won, initial] },
  };
  const review = {
    requestCheck: {
      coverage: [
        {
          requestSpan: packet.question,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'ball-win',
          temporalRelation: 'none',
        },
      ],
    },
  };
  const answer = (event) => ({
    claims: [
      {
        kind: 'observation',
        text: 'A recorded action.',
        evidence: [{ type: 'event', id: event.id, revision: event.revision }],
      },
    ],
  });
  assert.equal(reviewRequestAdequacy(review, answer(received), packet).length, 1);
  assert.equal(reviewRequestAdequacy(review, answer(initial), packet).length, 1);
  assert.deepEqual(reviewRequestAdequacy(review, answer(won), packet), []);
  const relative = {
    requestCheck: {
      coverage: [
        {
          ...review.requestCheck.coverage[0],
          requestedAction: 'receive',
          temporalRelation: 'after-requested-event',
        },
      ],
    },
  };
  assert.match(
    reviewRequestAdequacy(relative, answer(received), packet)[0].reason,
    /relative sequence/,
  );
});

test('default fan recovery metrics exclude initial control while an explicit raw-record lookup remains distinct', async () => {
  const question = {
    kind: 'quiet',
    seed: 1007,
    time: 3,
    question: 'How many provider recovery records have arrived?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'recovery' }, aggregate: 'count' }],
      },
    },
    (packet) => {
      for (const comparison of [packet.fullMatchComparison, packet.recentComparison]) {
        const metric = comparison.metrics.find((metric) => metric.filters.type === 'recovery');
        assert.equal(metric.filters.recoveryClass, 'ball-win');
        assert.ok(metric.teams.every((team) => team.count === 0));
      }
      const contribution = packet.playerContributions.metrics.find(
        (metric) => metric.name === 'recoveries',
      );
      const sources = wireQueries(packet);
      assert.ok(
        contribution.evidence.every((ref) =>
          sources.some(
            (source) =>
              source.scopeReference.id === ref.id &&
              source.query.filters.recoveryClass === 'ball-win' &&
              source.count === 0,
          ),
        ),
      );
      const explicit = packet.requestedEvidence.find(
        (source) => source.query.filters.type === 'recovery',
      );
      assert.equal(explicit.query.filters.recoveryClass, undefined);
      assert.equal(explicit.count, 1);
      const fact = packet.matchFacts.facts.find(
        (fact) =>
          fact.selection.kind === 'count' &&
          fact.selection.metric === 'recoveries' &&
          isDeepStrictEqual(fact.selection.filters, explicit.query.filters),
      );
      assert.ok(fact);
      assert.match(fact.claim.text, /recovery record/);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    { decision: 'approve', reason: 'Explicit raw-record request is kept distinct from ball wins.' },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.doesNotMatch(result.answer, /won|ball win/i);
});

test('semantic answer-form checks accept general explanation without inventing match action evidence', () => {
  const answer = {
    scope: 'general',
    claims: [
      { kind: 'general', text: 'An offside position alone is not an offence.', evidence: [] },
    ],
  };
  const review = {
    requestCheck: {
      coverage: [
        {
          requestSpan: 'Why?',
          claimIndices: [0],
          answerForm: 'explanation',
          requestedAction: 'shot',
          temporalRelation: 'none',
        },
      ],
    },
  };
  assert.deepEqual(
    reviewRequestAdequacy(review, answer, { queryResults: [], question: 'Why?' }),
    [],
  );
});

test('positive same-team chronology is proved from a canonical ordered anchor and current event without a dependent lookup', async () => {
  const question = {
    kind: 'interrupted',
    seed: 1007,
    time: 106,
    question: 'Who got the ball back most recently, and did their side get a shot away afterwards?',
  };
  let captured, review;
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'recovery', recoveryClass: 'ball-win' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
        ],
      },
    },
    (packet) => {
      const anchor = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'ballWins',
      );
      const shot = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'shot' &&
          f.selection.time === 105,
      );
      assert.match(anchor.claim.text, /Patel/);
      assert.match(shot.claim.text, /Evans/);
      assert.equal(packet.queryRelations, undefined);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [anchor.id, shot.id] },
        followUp: '',
      };
    },
    (packet, body) => {
      captured = packet;
      const schema =
        body.response_format.json_schema.schema.properties.requestCheck.properties.coverage.items
          .properties;
      assert.deepEqual(schema.relationAnchorClaimIndex.anyOf[0].enum, [0, 1]);
      assert.deepEqual(schema.relationEntityBinding.enum, ['none', 'same-team', 'same-player']);
      review = {
        decision: 'approve',
        requestCheck: {
          requestedInformation: question.question,
          status: 'answered',
          reason: 'Latest classified ball win and a later same-team shot.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: 'fact',
            requestedAction: index ? 'shot' : 'ball-win',
            temporalRelation: index ? 'after-requested-event' : 'none',
            relationAnchorClaimIndex: index ? 0 : null,
            relationEntityBinding: index ? 'same-team' : 'none',
          })),
        },
      };
      return review;
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.queryRelations, undefined);
  assert.equal(result.provenance.modelGenerated, false);
  assert.match(result.answer, /Patel.*01:32.*Evans.*01:45/);
  assert.equal(result.relationWitnesses.length, 1);
  assert.equal(result.relationWitnesses[0].team, 'away');
  assert.equal(result.relationWitnesses[0].proves, 'positive-existence');
  assert.ok(result.relationWitnesses[0].doesNotProve.includes('causation'));
  assert.ok(result.evidence.some((ref) => ref.id === result.relationWitnesses[0].anchorScope.id));
  const check = (
    r = review,
    answer = captured.answer,
    packet = captured.evidence,
    selection = captured.canonicalFactSelection,
  ) => reviewRequestAdequacy(r, answer, packet, { canonicalFactSelection: selection });
  assert.deepEqual(check(), []);
  for (const modification of [
    { relationEntityBinding: 'same-player' },
    { relationAnchorClaimIndex: 1 },
    { relationAnchorClaimIndex: null },
    { temporalRelation: 'before-requested-event' },
    { requestedAction: 'pass' },
    { relationEntityBinding: 'unknown' },
  ]) {
    const invalid = structuredClone(review);
    Object.assign(invalid.requestCheck.coverage[1], modification);
    assert.ok(check(invalid).length, JSON.stringify(modification));
  }
  const stale = structuredClone(captured.canonicalFactSelection);
  stale.proofs[1].revision++;
  assert.ok(check(review, captured.answer, captured.evidence, stale).length);
  const incidental = structuredClone(captured.canonicalFactSelection);
  incidental.proofs[0] = incidental.proofs[0].event;
  assert.ok(
    check(review, captured.answer, captured.evidence, incidental).length,
    'An arbitrary nearby event does not prove latest anchor selection',
  );
  const opposite = structuredClone(captured.evidence);
  opposite.linkedContext.rows.find((row) => row.id.endsWith('shot-105')).team = 'home';
  assert.ok(
    check(review, captured.answer, opposite).length,
    'A later opponent event cannot prove their side acted',
  );
  const simultaneous = structuredClone(captured.evidence),
    equalProof = structuredClone(captured.canonicalFactSelection);
  simultaneous.linkedContext.rows.find((row) => row.id.endsWith('shot-105')).time = 92;
  equalProof.proofs[1].time = 92;
  assert.ok(
    check(review, captured.answer, simultaneous, equalProof).length,
    'After is strict, not simultaneous',
  );
  const absent = {
    scope: 'match',
    claims: [
      captured.answer.claims[0],
      { text: 'No later shot.', kind: 'observation', evidence: [] },
    ],
  };
  assert.ok(check(review, absent).length, 'Missing positive evidence never establishes absence');
});

test('entity-only dependency binds the first shooter to a separately requested full or restricted count window', async () => {
  const question = {
    kind: 'duel',
    seed: 1007,
    time: 106,
    question: 'Who took Harbour’s first shot, and how many attempts has that player had?',
  };
  for (const from of [0, 60]) {
    let actor, expected;
    const mock = sequenceTransport(
      [
        {
          mentionedPlayers: [],
          decision: {
            kind: 'queries',
            queries: [
              {
                filters: { type: 'shot', team: 'away' },
                aggregate: 'list',
                order: 'asc',
                limit: 1,
              },
              {
                filters: { type: 'shot' },
                aggregate: 'count',
                timeFrom: from,
                timeTo: 106,
                relativeTo: { queryIndex: 0, relation: 'none', sameTeam: false, samePlayer: true },
              },
            ],
          },
        },
        (packet) => {
          const relation = packet.queryRelations[0];
          actor = relation.anchorPlayerId;
          assert.equal(actor, 'away-10');
          assert.equal(relation.anchorTime, 46);
          assert.equal(relation.query.filters.player, actor);
          assert.equal(relation.query.timeFrom, from);
          assert.equal(relation.query.timeFromExclusive, undefined);
          expected = matchState(question).events.filter(
            (row) =>
              row.type === 'shot' && row.playerId === actor && row.time >= from && row.time <= 106,
          ).length;
          const first = packet.matchFacts.facts.find(
            (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
          );
          const total = packet.matchFacts.facts.find(
            (f) =>
              f.selection.kind === 'count' &&
              f.selection.metric === 'attempts' &&
              f.selection.subjectId === actor &&
              f.selection.timeFrom === from &&
              f.selection.timeTo === 106,
          );
          assert.ok(total);
          assert.match(total.claim.text, new RegExp(String(expected)));
          return {
            scope: 'match',
            composition: { mode: 'facts', factIds: [first.id, total.id] },
            followUp: '',
          };
        },
        {
          decision: 'approve',
          reason:
            'The independent count is bound to the retrieved actor, not a guessed roster position.',
        },
      ],
      (_packet, index, body) => {
        if (index) return;
        const variants = decisionBranch(body, 'queries').properties.queries.items.anyOf;
        const entity = variants.find((v) =>
          v.properties.relativeTo.properties?.relation.enum.includes('none'),
        );
        assert.deepEqual(entity.properties.relativeTo.properties.samePlayer.enum, [true]);
        assert.deepEqual(entity.properties.filters.anyOf[0].properties.player, { type: 'null' });
        assert.notDeepEqual(entity.properties.timeFrom, { type: 'null' });
      },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 3);
    assert.equal(result.queryRelations[0].anchorPlayerId, actor);
    assert.equal(result.canonicalFactSelection.proofs[1].value, expected);
  }
});

test('entity dependencies reject ambiguous anchors and authored conflicting actors, preserving temporal strictness', async () => {
  const question = {
    kind: 'duel',
    seed: 1007,
    time: 106,
    question: 'Count the actions by the first shooter.',
  };
  const anchor = {
    filters: { type: 'shot', team: 'away' },
    aggregate: 'list',
    order: 'asc',
    limit: 1,
  };
  const dependent = {
    filters: { type: 'shot' },
    aggregate: 'count',
    timeFrom: 0,
    timeTo: 106,
    relativeTo: { queryIndex: 0, relation: 'none', sameTeam: false, samePlayer: true },
  };
  for (const queries of [
    [dependent],
    [{ ...anchor, limit: 20 }, dependent],
    [{ ...anchor, filters: { type: 'shot', team: 'away', result: true } }, dependent],
    [anchor, { ...dependent, filters: { type: 'shot', player: 'away-1' } }],
    [anchor, { ...dependent, relativeTo: { ...dependent.relativeTo, samePlayer: false } }],
    [anchor, { ...dependent, relativeTo: { ...dependent.relativeTo, relation: 'after' } }],
  ]) {
    const mock = sequenceTransport([
      { mentionedPlayers: [], decision: { kind: 'queries', queries } },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      /lookup/,
    );
    assert.equal(mock.count(), 1);
  }
});

test('same-player temporal dependencies preserve strict windows and do not turn the actor into a guessed recipient', async () => {
  const question = {
    kind: 'duel',
    seed: 1007,
    time: 106,
    question:
      'Who took the first Harbour shot, and how many shots did that player have afterwards?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot', team: 'away' }, aggregate: 'list', order: 'asc', limit: 1 },
          {
            filters: { type: 'shot' },
            aggregate: 'count',
            relativeTo: { queryIndex: 0, relation: 'after', sameTeam: false, samePlayer: true },
          },
        ],
      },
    },
    (packet) => {
      const relation = packet.queryRelations[0];
      assert.equal(relation.anchorPlayerId, 'away-10');
      assert.equal(relation.query.timeFrom, 46);
      assert.equal(relation.query.timeFromExclusive, true);
      const first = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
      );
      const count = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.timeFrom === 46 &&
          f.selection.subjectId === 'away-10',
      );
      assert.ok(count);
      assert.match(count.claim.text, /1 shot/);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [first.id, count.id] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        reason: 'Actor-bound count with strict start.',
        coverage: packet.requestComponents.map((requestSpan, index) => ({
          requestSpan,
          claimIndices: [index],
          answerForm: 'fact',
          requestedAction: 'shot',
          temporalRelation: index ? 'after-requested-event' : 'none',
          relationAnchorClaimIndex: index ? 0 : null,
          relationEntityBinding: index ? 'same-player' : 'none',
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.queryRelations[0].samePlayer, true);
  assert.equal(result.canonicalFactSelection.proofs[1].value, 1);
});

test('canonical composite normalization remaps raw dependencies before validation and reviews final claim indices', async () => {
  const question = {
    kind: 'counter',
    seed: 48371,
    time: 117,
    question: 'What does the confirmed score tell us?',
  };
  let requested;
  const planner = {
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
    },
  };
  const mock = sequenceTransport([
    planner,
    (packet) => {
      const composite = packet.matchFacts.facts.find((f) => f.selection.kind === 'confirmed-score');
      assert.ok(composite);
      const atoms = ['home', 'away'].map((id) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === 'goals' &&
            f.selection.subjectId === id &&
            f.selection.timeFrom === 0,
        ),
      );
      requested = [atoms[0].id, composite.id, atoms[1].id];
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: requested,
          claim: {
            text: 'That confirmed score does not settle the unresolved attempt.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 2],
          },
        },
        followUp: '',
      };
    },
    (packet, body) => {
      assert.equal(packet.answer.claims.length, 2);
      assert.deepEqual(packet.canonicalClaimIndices, [0]);
      assert.deepEqual(packet.canonicalFactSelection.requestedFactIds, requested);
      assert.deepEqual(packet.canonicalFactSelection.originalToSelectedIndex, [0, 0, 0]);
      assert.deepEqual(
        body.response_format.json_schema.schema.properties.requestCheck.properties.coverage.items
          .properties.claimIndices.items.enum,
        [0, 1],
      );
      assert.equal(packet.answer.claimDependencies.length, 1);
      assert.deepEqual(packet.answer.claimDependencies[0].observationIndices, [0]);
      return {
        decision: 'approve',
        reason:
          'The same proved score supports the interpretation after exact operand normalization.',
      };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.claims.length, 2);
  assert.equal(result.canonicalFactSelection.normalizations.length, 2);
  assert.deepEqual(result.canonicalFactSelection.dependencyMappings, [
    { proseIndex: 0, requestedIndices: [0, 2], selectedIndices: [0] },
  ]);
  assert.deepEqual(
    result.claimProvenance.map((p) => p.modelGenerated),
    [false, true],
  );
  for (const indices of [[0, 0], [3], [-1], [0.5]]) {
    const invalid = sequenceTransport([
      planner,
      () => ({
        scope: 'match',
        selectedFactIds: requested,
        claims: [
          {
            text: 'A supported conclusion.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: indices,
          },
        ],
        followUp: '',
      }),
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: invalid.fetcher }),
      (error) => error.code === 'question-invalid-fact-selection',
    );
    assert.equal(invalid.count(), 2, 'Invalid raw dependencies cannot be hidden by normalization');
  }
});

test('approved coverage prunes an unrelated canonical pass while preserving shooter, limitation and audit without another model call', async () => {
  const question = {
    kind: 'counter',
    seed: 1007,
    time: 115,
    question: 'How fast did that last shot travel, and who hit it?',
  };
  let requested, limitation;
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
      },
    },
    (packet, body) => {
      const shot = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'attempts',
      );
      const pass = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'pass' &&
          f.selection.time === 115,
      );
      assert.ok(pass);
      requested = [shot.id, pass.id];
      limitation = 'The speed of the shot is not recorded.';
      assert.match(
        body.messages[0].content,
        /do not restate the selected actor, clock or action outcome/,
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: requested,
          claim: { text: limitation, kind: 'limitation', evidence: [], dependsOn: [] },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        requestedInformation: question.question,
        status: 'useful-limitation',
        reason: 'The shooter is known and speed unavailable.',
        coverage: packet.requestComponents.map((requestSpan, index) => ({
          requestSpan,
          claimIndices: index ? [0] : [2],
          answerForm: index ? 'fact' : 'unavailable-measurement',
          requestedAction: 'shot',
          temporalRelation: 'none',
          relationAnchorClaimIndex: index ? 0 : 2,
          relationEntityBinding: 'none',
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.execution.repairs, 0);
  assert.equal(result.claims.length, 2);
  assert.match(result.claims[0].text, /Murray/);
  assert.equal(result.claims[1].text, limitation);
  assert.doesNotMatch(result.answer, /Demir/);
  assert.deepEqual(result.canonicalFactSelection.requestedFactIds, requested);
  assert.deepEqual(result.canonicalFactSelection.selectedFactIds, [requested[0]]);
  assert.deepEqual(result.canonicalFactSelection.originalToSelectedIndex, [0, null]);
  assert.deepEqual(
    result.claimProvenance.map((p) => p.claimIndex),
    [0, 1],
  );
  assert.equal(result.claimProvenance[1].modelGenerated, true);
  assert.equal(result.provenance.modelGenerated, true);
  assert.ok(result.evidence.every((ref) => !ref.id.endsWith('pass-115')));
  assert.ok(result.moments.every((moment) => !moment.anchorId.endsWith('pass-115')));
  assert.deepEqual(result.coveragePruning.originalToFinalClaimIndex, [0, null, 1]);
  assert.deepEqual(
    result.coveragePruning.reviewAfter.requestCheck.coverage.map((p) => p.claimIndices),
    [[1], [0]],
  );
  assert.equal(result.coveragePruning.reviewBefore.checks.length, 3);
  assert.equal(result.coveragePruning.reviewAfter.checks.length, 2);
  assert.equal(result.coveragePruning.removed[0].claim.text.includes('Demir'), true);
});

test('planner wire licenses pass outcome filters without restricting supporting shot queries or permitting an untyped bypass', async () => {
  for (const [question, allowed] of [
    ['Who did my favourite last pass to?', []],
    ['Was the latest pass completed?', []],
    ['Who made the latest completed pass?', [true]],
    ['Who made the latest unsuccessful pass?', [false]],
    ['Who made the latest pass, not just completed ones?', []],
    ['¿Quién hizo el último pase?', []],
    ['Qui a fait la dernière passe ?', []],
    ['Quem fez o último passe?', []],
  ]) {
    const mock = sequenceTransport(
      [
        { mentionedPlayers: [], decision: { kind: 'queries', queries: [] } },
        {
          scope: 'match',
          claims: [{ kind: 'limitation', text: 'Please identify the player.', evidence: [] }],
          followUp: '',
        },
        { decision: 'approve' },
      ],
      (_packet, call, body) => {
        if (call) return;
        const raw = body.response_format.json_schema.schema;
        const definitions = Object.keys(raw.$defs || {});
        assert.ok(
          definitions.length >= 2,
          'Share ordinary and entity-bound filters, plus repeated schema subtrees',
        );
        const wire = JSON.stringify(raw);
        assert.ok(
          definitions.every((name) => wire.includes('"$ref":"#/$defs/' + name + '"')),
          'Every emitted definition is used',
        );
        assert.ok(
          JSON.stringify(raw).length < 25000,
          'Permission constraints must not duplicate the filter schema for every query mode',
        );
        const variants = decisionBranch(body, 'queries').properties.queries.items.anyOf;
        for (const variant of variants) {
          const filters = variant.properties.filters.anyOf,
            pass = filters.find((branch) => branch.properties?.type.enum?.includes('pass')),
            other = filters.find((branch) => branch.properties?.type.enum?.includes('shot')),
            untyped = filters.find((branch) => branch.properties?.type.type === 'null');
          for (const branch of filters.filter((branch) => branch.properties)) {
            assert.equal(branch.additionalProperties, false);
            assert.deepEqual(new Set(branch.required), new Set(Object.keys(branch.properties)));
          }
          assert.ok(pass && other && untyped);
          assert.deepEqual(
            pass.properties.result,
            allowed.length
              ? { anyOf: [{ type: 'boolean', enum: allowed }, { type: 'null' }] }
              : { type: 'null' },
          );
          assert.deepEqual(pass.properties.outcome, { type: 'null' });
          assert.deepEqual(untyped.properties.result, { type: 'null' });
          assert.deepEqual(untyped.properties.outcome, { type: 'null' });
          assert.notDeepEqual(other.properties.result, { type: 'null' });
          assert.equal(other.properties.type.enum.includes('pass'), false);
          const control = filters.find((branch) =>
            branch.properties?.type.enum?.includes('receive'),
          );
          assert.ok(control);
          assert.deepEqual(control.properties.result, { type: 'null' });
          assert.deepEqual(control.properties.outcome, { type: 'null' });
        }
      },
    );
    await answerMatchQuestionAI({ ...input, question }, { config, fetcher: mock.fetcher });
  }
});

test('recipient planning repair identifies forbidden fields and preserves favourite actor and actual latest pass', async () => {
  const question = {
    kind: 'quiet',
    seed: 1014,
    time: 80,
    audience: 'player',
    favoriteClub: 'home',
    favoritePlayer: 'E. Khan',
    question: 'Who did my favourite last pass to?',
  };
  const plan = (result) => ({
    mentionedPlayers: ['E. Khan'],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', team: 'home', player: 'home-7', result },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 80,
        },
      ],
    },
  });
  let selected;
  const mock = sequenceTransport(
    [
      plan(true),
      plan(null),
      (packet) => {
        selected = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'passes',
        );
        assert.ok(selected);
        assert.match(selected.claim.text, /E\. Khan completed a pass to Z\. James at 01:13/);
        return {
          scope: 'match',
          composition: { mode: 'facts', factIds: [selected.id] },
          followUp: '',
        };
      },
      { decision: 'approve' },
    ],
    (packet, call) => {
      if (call === 1) {
        assert.equal(packet.planningCorrection.kind, 'unlicensed-outcome-filter');
        assert.deepEqual(packet.planningCorrection.fields, [
          {
            path: 'decision.queries[0].filters.result',
            rejectedValue: true,
            allowedValues: [null],
          },
        ]);
        assert.deepEqual(packet.planningCorrection.permission.results, []);
        assert.match(packet.planningCorrection.instruction, /older completed pass/);
        assert.equal(packet.viewerProfile.favoritePlayerResolution.canonicalId, 'home-7');
      }
    },
  );
  const answer = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: (required) => required === 3,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.equal(answer.answer, selected.claim.text);
  assert.equal(answer.provenance.modelGenerated, false);
  assert.equal(answer.canonicalFactSelection.proofs[0].event.recipient.playerId, 'home-6');
  assert.equal(
    answer.canonicalFactSelection.proofs[0].event.recipient.status,
    'confirmed-recipient',
  );
});

test('arbitrary favourite identity and latest failed recipient are source-bound instead of substituted by an older completion', async () => {
  const source = { kind: 'sustained', seed: 92761, time: 67 },
    latest = executeMatchQuery(source, { filters: { type: 'pass' }, order: 'desc', limit: 1 })
      .rows[0];
  const question = {
    ...source,
    audience: 'analyst',
    favoriteClub: 'away',
    question: 'Who did my favourite last pass to?',
  };
  // Use the received identity dictionary, never the names from an earlier fixture.
  question.favoritePlayer = latest.player;
  const plan = {
    mentionedPlayers: [latest.player],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', player: latest.playerId },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
        },
      ],
    },
  };
  let selected;
  const mock = sequenceTransport([
    plan,
    (packet) => {
      selected = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'passes',
      );
      assert.ok(selected);
      assert.match(selected.claim.text, /recorded target.*unsuccessful/);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [selected.id] },
        followUp: '',
      };
    },
    { decision: 'approve' },
  ]);
  const answer = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.canonicalFactSelection.proofs[0].event.eventId, latest.id);
  assert.equal(answer.canonicalFactSelection.proofs[0].event.recipient.status, 'recorded-target');
  assert.equal(answer.answer, selected.claim.text);
});

test('validated viewer preferences reach planning, writing and review without changing an explicitly requested player scope', async () => {
  const question = {
    kind: 'duel',
    seed: 48371,
    time: 120,
    question: 'How many shots has Reed had?',
    audience: 'analyst',
    favoriteClub: 'away',
    favoritePlayer: 'D. Silva',
  };
  let profile;
  const mock = sequenceTransport(
    [
      {
        mentionedPlayers: ['A. Reed'],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot', player: 'A. Reed' }, aggregate: 'count' }],
        },
      },
      (packet) => {
        assert.deepEqual(packet.viewerProfile, profile);
        assert.equal(packet.requestedEvidence[0].entityResolution.player.canonicalId, 'home-10');
        const fact = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === 'attempts' &&
            f.selection.subjectId === 'home-10' &&
            isDeepStrictEqual(f.selection.filters, packet.requestedEvidence[0].query.filters),
        );
        assert.ok(fact);
        return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
      },
      (packet) => {
        assert.deepEqual(packet.viewerProfile, profile);
        return {
          decision: 'approve',
          reason: 'Explicit Reed request has priority over the Silva preference.',
        };
      },
    ],
    (packet, index, body) => {
      assert.match(
        body.messages[0].content,
        /Explicit requested players, teams, actions, comparisons, windows and filters always take priority/,
      );
      if (!index) {
        profile = packet.viewerProfile;
        assert.equal(profile.audience, 'analyst');
        assert.equal(profile.favoriteClub, 'away');
        assert.equal(profile.favoritePlayer, 'D. Silva');
        assert.equal(profile.favoritePlayerResolution.status, 'resolved');
        assert.equal(profile.favoritePlayerResolution.canonicalId, 'away-10');
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(result.answer, /Reed/);
  assert.doesNotMatch(result.answer, /Silva/);
  assert.deepEqual(result.viewerProfile, profile);
  assert.equal(result.execution.modelCalls, 3);
});

test('general minimal packets keep audience preferences with no match evidence and default to newcomer', async () => {
  for (const audience of [undefined, 'newcomer', 'analyst', 'player']) {
    const question = {
      kind: 'quiet',
      seed: 17,
      time: 10,
      question: 'What is a brace?',
      ...(audience ? { audience } : {}),
    };
    const mock = sequenceTransport(
      [
        { mentionedPlayers: [], decision: { kind: 'general', concepts: [] } },
        {
          scope: 'general',
          claims: [
            {
              text: 'A brace is two goals by the same player in a game.',
              kind: 'general',
              evidence: [],
            },
          ],
          followUp: '',
        },
        { decision: 'approve' },
      ],
      (packet, index, body) => {
        assert.equal(packet.viewerProfile.audience, audience || 'newcomer');
        assert.equal(packet.viewerProfile.favoritePlayerResolution, null);
        assert.equal(packet.viewerProfile.favoriteClub, null);
        assert.match(body.messages[0].content, /For newcomer/);
        assert.match(body.messages[0].content, /For analyst/);
        assert.match(body.messages[0].content, /Simple factual answers may correctly be identical/);
        if (index === 1)
          for (const field of ['score', 'roster', 'queryResults', 'selectedAnchor'])
            assert.equal(packet[field], undefined);
      },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.viewerProfile.audience, audience || 'newcomer');
    assert.equal(result.evidence.length, 0);
  }
});

test('absent and ambiguous favourite players stay unresolved presentation context rather than zero-action match participants', async () => {
  for (const [favoritePlayer, status] of [
    ['Messi', 'absent'],
    ['Costa', 'ambiguous'],
  ]) {
    const question = {
      kind: 'sustained',
      seed: 48371,
      time: 67,
      question: 'How is my favourite player doing?',
      audience: 'player',
      favoritePlayer,
    };
    const mock = sequenceTransport(
      [
        { mentionedPlayers: [], decision: { kind: 'queries', queries: [] } },
        {
          scope: 'clarify',
          claims: [
            { text: 'Which player would you like to focus on?', kind: 'limitation', evidence: [] },
          ],
          followUp: '',
        },
        { decision: 'approve' },
      ],
      (packet) => {
        assert.equal(packet.viewerProfile.favoritePlayerResolution.status, status);
        assert.equal(packet.viewerProfile.favoritePlayerResolution.canonicalId, null);
        assert.equal(
          packet.viewerProfile.favoritePlayerResolution.candidates.length,
          status === 'absent' ? 0 : 2,
        );
      },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.scope, 'clarify');
    assert.equal(result.evidence.length, 0);
    assert.doesNotMatch(result.answer, /zero|0/);
    assert.equal(result.viewerProfile.favoritePlayerResolution.status, status);
  }
});

test('a genuinely deictic favourite-player request can use the resolved roster identity without changing its window', async () => {
  const question = {
    kind: 'duel',
    seed: 48371,
    time: 120,
    question: 'How many shots has my favourite player had?',
    audience: 'player',
    favoritePlayer: 'D. Silva',
  };
  const mock = sequenceTransport([
    (packet) => ({
      mentionedPlayers: [packet.viewerProfile.favoritePlayer],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: {
              type: 'shot',
              player: packet.viewerProfile.favoritePlayerResolution.canonicalId,
            },
            aggregate: 'count',
            timeFrom: 0,
            timeTo: 120,
          },
        ],
      },
    }),
    (packet) => {
      const scope = packet.requestedEvidence.find((q) => q.query.filters.type === 'shot');
      assert.equal(scope.query.filters.player, 'away-10');
      assert.equal(scope.query.timeFrom, 0);
      assert.equal(scope.query.timeTo, 120);
      const count = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'attempts' &&
          isDeepStrictEqual(f.selection.filters, scope.query.filters),
      );
      assert.ok(count);
      return { scope: 'match', composition: { mode: 'facts', factIds: [count.id] }, followUp: '' };
    },
    {
      decision: 'approve',
      reason: 'The genuine favourite-player reference is bound to a known roster identity.',
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(result.answer, /Silva/);
  assert.equal(result.viewerProfile.favoritePlayerResolution.canonicalId, 'away-10');
  assert.equal(result.execution.modelCalls, 3);
});

test('collection after an identified shot uses the explicit source link without a redundant anchor sentence', async () => {
  const question = {
    kind: 'interrupted',
    seed: 1008,
    time: 95,
    language: 'es',
    question: '¿Quién se quedó con el balón tras el tiro de B. Laurent del 1:29?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: ['B. Laurent'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'recovery' }, aggregate: 'list', timeFrom: 90, timeTo: 92, limit: 1 },
        ],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'recovery' &&
          f.selection.time === 91,
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet) => {
      const index = packet.sourceSequenceLinks.findIndex(
        (link) => link.anchorTime === 89 && link.witnessTime === 91,
      );
      assert.ok(index >= 0);
      return {
        decision: 'approve',
        requestCheck: {
          requestedInformation: question.question,
          status: 'answered',
          reason: 'Exact source-linked collection.',
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'recovery',
            temporalRelation: 'after-requested-event',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            relationSourceLinkIndex: index,
          })),
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Eriksen/);
  assert.equal(result.claims.length, 1);
  assert.equal(result.relationWitnesses[0].anchorTime, 89);
});

test('a complete current score directly corrects a false score premise without redundant numeric prose', async () => {
  const question = {
    kind: 'sustained',
    seed: 1012,
    time: 120,
    question: 'Dunford are two up now, aren’t they?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', result: true }, aggregate: 'by-team' }],
      },
    },
    (packet) => {
      const goals = packet.matchFacts.facts.filter(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'goals' &&
          ['home', 'away'].includes(f.selection.subjectId) &&
          f.selection.timeFrom === 0 &&
          f.selection.timeTo === 120,
      );
      assert.equal(goals.length, 2);
      return {
        premiseCheck: {
          questionAssumption: 'Dunford lead by two.',
          recordedAction: 'Current confirmed score differs.',
          conclusion: 'contradicted',
        },
        scope: 'match',
        composition: { mode: 'facts', factIds: goals.map((f) => f.id) },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'corrected-premise',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'premise-correction',
          needsAssessment: false,
          needsExplicitCorrection: true,
          needsMeasurementLimitation: false,
          reason: 'The complete current score resolves the false margin.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
          answerForm: 'premise-correction',
          requestedAction: 'other',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationSourceLinkIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'Direct current score correction.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 2);
  assert.match(result.answer, /Dunford.*1.*Bracken/i);
});

test('whole-match keeper assessment has complete team on-target scopes distinct from total attempts and recent play', async () => {
  const question = {
    kind: 'duel',
    seed: 1011,
    time: 115,
    question: 'Portwell or Highfield: who’s been making the other keeper busier?',
  };
  const mock = sequenceTransport([
    {
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'shot', outcome: 'on-target' },
            aggregate: 'by-team',
            timeFrom: 0,
            timeTo: 115,
          },
        ],
      },
    },
    (packet) => {
      const facts = packet.matchFacts.facts.filter(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'shotsOnTarget' &&
          ['home', 'away'].includes(f.selection.subjectId) &&
          f.selection.timeFrom === 0 &&
          f.selection.timeTo === 115,
      );
      assert.equal(facts.length, 2);
      const scopes = packet.fullMatchComparison.metrics.find(
        (m) => m.filters.outcome === 'on-target',
      );
      assert.ok(scopes);
      assert.deepEqual(
        scopes.teams.map((t) => t.count),
        [2, 1],
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: facts.map((f) => f.id),
          claim: {
            text: 'Highfield’s keeper has faced more on-target attempts on this measure; it does not capture every part of his workload.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsMeasurementLimitation: false,
          reason: 'An opposing-keeper workload comparison.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1, 2],
          answerForm: 'assessment',
          requestedAction: 'other',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationSourceLinkIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'Complete full-window proxy and qualified conclusion.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Highfield’s keeper/);
  assert.equal(result.claims.length, 3);
});

test('planner-declared assessment reaches the writer as a required concise conclusion, independently reviewed', async () => {
  const question = {
    kind: 'duel',
    seed: 1011,
    time: 115,
    question: 'Which side has made the opposing keeper busier?',
  };
  const mock = sequenceTransport([
    {
      requestedForm: 'assessment',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', outcome: 'on-target' }, aggregate: 'by-team' }],
      },
    },
    (packet, body) => {
      assert.equal(packet.requestedForm, 'assessment');
      assert.equal(packet.queryResults, undefined);
      assert.equal(packet.playerContributions, undefined);
      assert.ok(packet.matchFacts.facts.length);
      assert.ok(packet.requestedEvidence.every((query) => query.rows === undefined));
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      for (const mode of modes.filter((mode) => mode.properties.mode.enum.includes('facts'))) {
        assert.equal(mode.properties.factIds.maxItems, 1);
        assert.ok(
          mode.properties.factIds.items.enum.every(
            (id) =>
              packet.matchFacts.facts.find((f) => f.id === id).selection.kind === 'team-comparison',
          ),
        );
      }
      const paragraph = modes.find((mode) => mode.properties.mode.enum.includes('explanation'))
        .properties.claim.anyOf[0].properties.text;
      assert.equal(paragraph.maxLength, 600);
      assert.match(paragraph.description, /complete sentences/);
      const facts = packet.matchFacts.facts.filter(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'shotsOnTarget' &&
          ['home', 'away'].includes(f.selection.subjectId) &&
          f.selection.timeFrom === 0 &&
          f.selection.timeTo === 115,
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: facts.map((f) => f.id),
          claim: {
            text: 'Portwell has tested the opposing keeper more on this measure. It is a limited view of keeper workload.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsMeasurementLimitation: false,
          reason: 'Qualified full-window judgment.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1, 2],
          answerForm: 'assessment',
          requestedAction: 'other',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationSourceLinkIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'Complete evidence and an actual conclusion.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Portwell has tested/);
  const invalid = directTransport({
    requestedForm: 'invented',
    mentionedPlayers: [],
    decision: { kind: 'queries', queries: [] },
  });
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: invalid.fetcher }),
    (error) => error.code === 'question-invalid-operation',
  );
});

test('a verified metric-bound comparison supplies a qualified assessment without redundant authored totals', async () => {
  const question = {
    kind: 'duel',
    seed: 1011,
    time: 115,
    question: 'Who has tested the opposing keeper more?',
  };
  const mock = sequenceTransport([
    {
      requestedForm: 'assessment',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [{ filters: { type: 'shot', outcome: 'on-target' }, aggregate: 'by-team' }],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'team-comparison' &&
          f.selection.metric === 'shotsOnTarget' &&
          f.selection.timeFrom === 0 &&
          f.selection.timeTo === 115,
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsMeasurementLimitation: false,
          reason: 'A qualified on-target comparison, not overall workload.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'assessment',
          requestedAction: 'shot',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationSourceLinkIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'The exact measure, leader and both values are explicit.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 1);
  assert.match(result.answer, /On shots on target, Portwell Athletic leads/);
  assert.equal(result.canonicalFactSelection.proofs[0].assessmentBounds, 'this-measure-only');
  assert.equal(result.provenance.modelGenerated, false);
});

test('personal action question with an explicit inspected moment stays on match evidence, not unrelated rules', async () => {
  const question = {
    kind: 'sustained',
    seed: 1042,
    time: 96,
    anchorId: 'comparison-sustained-1042-shot-96',
    question: 'Why did he shoot instead of slipping it to a teammate?',
  };
  const mock = sequenceTransport(
    [
      {
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { id: question.anchorId }, aggregate: 'list', limit: 1 }],
        },
      },
      (packet) => {
        const fact = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'shot' &&
            f.selection.time === 96 &&
            !f.selection.attributes,
        );
        assert.ok(fact);
        return {
          scope: 'match',
          composition: {
            mode: 'explanation',
            factIds: [fact.id],
            claim: {
              text: 'I cannot tell what he saw or whether a pass was available.',
              kind: 'limitation',
              evidence: [],
              dependsOn: [],
            },
          },
          followUp: '',
        };
      },
      (packet) => ({
        decision: 'approve',
        requestCheck: {
          status: 'useful-limitation',
          requestedInformation: question.question,
          responseIntent: {
            purpose: 'explanation',
            needsAssessment: false,
            needsExplicitCorrection: false,
            needsMeasurementLimitation: false,
            reason: 'Explain the actual shot while preserving unknown intentions and options.',
          },
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0, 1],
            answerForm: 'explanation',
            requestedAction: 'shot',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationSourceLinkIndex: null,
            relationEntityBinding: 'none',
          })),
          reason: 'Actual action plus specific uncertainty.',
        },
      }),
    ],
    (packet, call, body) => {
      if (!call) {
        assert.equal(packet.selectedMoment.id, question.anchorId);
        assert.equal(decisionBranch(body, 'general'), undefined);
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /cannot tell/);
});

test('last pass before an inspected goal has a complete ordered lookup with an internal identified anchor', async () => {
  const question = {
    kind: 'counter',
    seed: 1041,
    time: 118,
    anchorId: 'comparison-counter-1041-shot-116',
    question: 'Who played the final pass before that goal?',
  };
  let captured, review;
  const mock = sequenceTransport([
    {
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { id: 'comparison-counter-1041-shot-116' }, aggregate: 'list', limit: 1 },
        ],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'ordered-event' &&
          f.selection.metric === 'passes' &&
          f.selection.timeTo === 116 &&
          f.selection.timeToExclusive,
      );
      assert.ok(fact);
      assert.ok(
        packet.queryRelations.some((link) => link.anchorIdentifiedBy === 'requested-moment'),
      );
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet) => {
      captured = packet;
      review = {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: question.question,
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'before-requested-event',
            relationAnchorClaimIndex: null,
            relationSourceLinkIndex: null,
            relationEntityBinding: 'same-team',
          })),
          reason: 'Complete last-pass query before the source-identified goal.',
        },
      };
      return review;
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Mensah/);
  assert.equal(result.claims.length, 1);
  assert.equal(result.queryRelations[0].query.timeToExclusive, true);
  const source = { ...captured.evidence, queryRelations: captured.queryRelations };
  assert.deepEqual(
    reviewRequestAdequacy(review, captured.answer, source, {
      canonicalFactSelection: captured.canonicalFactSelection,
    }),
    [],
  );
  const bad = structuredClone(source);
  bad.requestedMoment.reference.revision++;
  assert.ok(
    reviewRequestAdequacy(review, captured.answer, bad, {
      canonicalFactSelection: captured.canonicalFactSelection,
    }).length,
  );
  const wrongSide = structuredClone(source);
  wrongSide.queryRelations[0].sameTeam = false;
  assert.ok(
    reviewRequestAdequacy(review, captured.answer, wrongSide, {
      canonicalFactSelection: captured.canonicalFactSelection,
    }).length,
  );
});

test('personal player references keep unfamiliar action paraphrases in the match route without a fabricated anchor', async () => {
  for (const text of [
    'Why did he shoot instead of passing?',
    'Was there a reason he went for goal rather than looking for a teammate?',
    'What was behind his attempt there?',
  ]) {
    const question = { kind: 'sustained', seed: 1042, time: 98, question: text };
    const mock = sequenceTransport(
      [
        {
          requestedForm: 'explanation',
          mentionedPlayers: [],
          decision: {
            kind: 'queries',
            queries: [{ filters: { type: 'shot' }, aggregate: 'list', order: 'desc', limit: 1 }],
          },
        },
        (packet) => {
          const fact = packet.matchFacts.facts.find(
            (f) =>
              f.selection.kind === 'ordered-event' &&
              f.selection.eventType === undefined &&
              f.selection.metric === 'attempts',
          );
          assert.ok(fact);
          return {
            scope: 'match',
            composition: {
              mode: 'explanation',
              factIds: [fact.id],
              claim: {
                text: 'I cannot tell what he saw or whether a pass was available.',
                kind: 'limitation',
                evidence: [],
                dependsOn: [],
              },
            },
            followUp: '',
          };
        },
        (packet) => ({
          decision: 'approve',
          requestCheck: {
            status: 'useful-limitation',
            requestedInformation: question.question,
            coverage: packet.requestComponents.map((requestSpan) => ({
              requestSpan,
              claimIndices: [0, 1],
              answerForm: 'explanation',
              requestedAction: 'shot',
              temporalRelation: 'none',
              relationAnchorClaimIndex: null,
              relationSourceLinkIndex: null,
              relationEntityBinding: 'none',
            })),
            reason: 'Latest shot and a necessary specific limitation.',
          },
        }),
      ],
      (packet, call, body) => {
        if (!call) {
          assert.equal(packet.selectedMoment, undefined);
          assert.equal(decisionBranch(body, 'general'), undefined);
        }
      },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 3);
    assert.match(result.answer, /cannot tell/);
  }
});
test('sequence-specific player involvement retains relevant passing evidence and an explicit assessment', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 79,
    question: 'Who has been most involved in Northbridge’s buildup so far?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'player-assessment',
      explanationTarget: 'observed-sequence',
      requestedForm: 'assessment',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass', team: 'home', result: true }, aggregate: 'by-player' },
        ],
      },
    },
    (packet, body) => {
      const modes = resolvedWireSchema(body).properties.composition.anyOf.map(
        (mode) => mode.properties.mode.enum[0],
      );
      assert.deepEqual(modes, ['metric-player-pick']);
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === 'home-7',
      );
      assert.ok(fact);
      return {
        scope: 'match',
        composition: { mode: 'metric-player-pick', playerId: 'home-7', factIds: [fact.id] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsMeasurementLimitation: false,
          reason: 'The conclusion names a player on the explicitly limited passing measure.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
          answerForm: 'assessment',
          requestedAction: 'pass',
          temporalRelation: 'none',
          relationAnchorClaimIndex: null,
          relationSourceLinkIndex: null,
          relationEntityBinding: 'none',
        })),
        reason: 'Relevant passing evidence and qualified conclusion.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(result.answer, /J\. Cole.*2/);
  assert.match(result.answer, /On completed passing, my pick so far is J\. Cole/);
  assert.doesNotMatch(result.answer, /shots/);
  assert.equal(result.execution.modelCalls, 3);
});
test('ordinary rankings repair invented group thresholds before counting the full inventory', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 79,
    question: 'Who received Northbridge’s passes most often?',
  };
  const plan = (bounds) => ({
    answerFocus: 'event-actor',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'receive', team: 'home' },
          aggregate: 'by-player',
          ...(bounds ? { groupCount: bounds } : {}),
        },
      ],
    },
  });
  const mock = sequenceTransport([
    plan({ min: 1, max: 3 }),
    (packet) => {
      assert.equal(packet.planningCorrection.kind, 'unlicensed-group-bound');
      return plan(null);
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'receptions' &&
          f.selection.subjectId === 'home-10',
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    {
      decision: 'approve',
      reason: 'Reed leads the complete unrestricted home reception comparison.',
    },
  ]);
  const answer = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.planningRepairs, 1);
  assert.match(answer.answer, /A\. Reed.*2/);
});
test('an explicitly requested group threshold remains available exactly in the wire and answer', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 79,
    question: 'Which Northbridge players have at least two completed passes?',
  };
  const mock = sequenceTransport([
    (_packet, body) => {
      const grouped = decisionBranch(body, 'queries').properties.queries.items.anyOf[1];
      const bounds = grouped.properties.groupCount.anyOf.find((s) => s.type === 'object');
      assert.deepEqual(bounds.properties.min.enum, [2]);
      assert.deepEqual(bounds.properties.max, { type: 'null' });
      return {
        requestedForm: 'fact',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'pass', team: 'home', result: true },
              aggregate: 'by-player',
              groupCount: { min: 2 },
            },
          ],
        },
      };
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find((f) => f.selection.kind === 'qualifying-groups');
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    {
      decision: 'approve',
      reason: 'Complete groups for the requested two-or-more completed passes predicate.',
    },
  ]);
  const answer = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(answer.answer, /J\. Cole.*2/);
  assert.equal(answer.execution.modelCalls, 3);
});
test('multi-part role assessments cannot collapse to an unrelated one-fact team comparison', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: 'Have the keepers actually been tested, or have most attempts missed?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'team-assessment',
      requestedForm: 'assessment',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot' }, aggregate: 'by-team' },
          { filters: { type: 'shot', outcome: 'on-target' }, aggregate: 'by-team' },
        ],
      },
    },
    (packet, body) => {
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.ok(modes.every((mode) => !mode.properties.mode.enum.includes('facts')));
      assert.match(body.messages[0].content, /question-specific queries/);
      const fact = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'shooting-profile' && f.selection.subjectId === 'home',
      );
      assert.ok(fact);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [fact.id],
          claim: {
            text: 'There have been on-target attempts, but overall keeper workload is not established by this shooting measure.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (_packet, body) => {
      assert.match(body.messages[0].content, /ball wins cannot substitute/);
      assert.match(body.messages[0].content, /never relevant but unselected context/);
      return {
        decision: 'withhold',
        reason: 'The answer still does not distinguish blocked attempts from off-target misses.',
      };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-withheld',
  );
});
test('inferred lineup names cannot turn an unnamed involvement request into named player assessments', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 79,
    question: "Who's linking Northbridge's play together rather than just taking the shots?",
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'player-assessment',
      explanationTarget: 'observed-sequence',
      requestedForm: 'assessment',
      mentionedPlayers: ['A. Reed', 'J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass', team: 'home', result: true }, aggregate: 'by-player' },
        ],
      },
    },
    (packet, body) => {
      assert.deepEqual(packet.mentionedPlayerResolution, []);
      assert.deepEqual(
        resolvedWireSchema(body).properties.composition.anyOf.map(
          (mode) => mode.properties.mode.enum[0],
        ),
        ['metric-player-pick'],
      );
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === 'home-7',
      );
      return {
        scope: 'match',
        composition: { mode: 'metric-player-pick', playerId: 'home-7', factIds: [fact.id] },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      reason: 'A relevant explicitly qualified passing-involvement judgment.',
    },
  ]);
  const answer = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(answer.answer, /On completed passing/);
  assert.equal(answer.execution.modelCalls, 3);
});
test('goal contribution review cannot invent an unasked temporal same-player relation', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 118,
    question: 'Did Cole help create the goal, or was he just nearby?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-sequence',
      explanationTarget: 'observed-sequence',
      requestedForm: 'explanation',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'shot', result: true }, aggregate: 'list', order: 'desc', limit: 1 },
        ],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find((f) => f.selection.kind === 'credited-goal-assist');
      assert.ok(fact);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [fact.id],
          claim: {
            text: 'His credited assist establishes active involvement, rather than an inference from his position.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0],
          },
        },
        followUp: '',
      };
    },
    (packet, body) => {
      const coverage =
        body.response_format.json_schema.schema.properties.requestCheck.properties.coverage.items
          .properties;
      assert.deepEqual(coverage.temporalRelation.enum, ['none']);
      assert.deepEqual(coverage.relationEntityBinding.enum, ['none']);
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: question.question,
          responseIntent: {
            purpose: 'explanation',
            needsAssessment: true,
            needsExplicitCorrection: false,
            needsMeasurementLimitation: false,
            reason: 'Credit establishes active contribution.',
          },
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0, 1],
            answerForm: 'explanation',
            requestedAction: 'assist',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationSourceLinkIndex: null,
            relationEntityBinding: 'none',
          })),
          reason: 'Credited assist and a concise supported conclusion.',
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.match(answer.answer, /active involvement/);
  assert.equal(answer.execution.modelCalls, 3);
});

test('writer duplicate suppression preserves distinct complete results, order and input source identity', () => {
  const a = {
    scopeReference: { type: 'scope', id: 'same', revision: 1 },
    query: { filters: { type: 'pass' }, timeFrom: 0, timeTo: 30 },
    count: 1,
    groups: [],
    rows: [{ id: 'p', revision: 1 }],
    scope: { missingFields: { result: 0 } },
  };
  const reordered = {
    ...structuredClone(a),
    query: { timeTo: 30, timeFrom: 0, filters: { type: 'pass' } },
  };
  const variants = [
    { ...a, scopeReference: { ...a.scopeReference, revision: 2 } },
    { ...a, count: 2 },
    { ...a, query: { ...a.query, timeFrom: 1 } },
    { ...a, rows: [{ id: 'p', revision: 2 }] },
    { ...a, scope: { missingFields: { result: 1 } } },
    { ...a, groups: [{ key: 'home', count: 1 }] },
  ];
  const noIdentity = { count: 1 },
    sources = [a, reordered, ...variants, noIdentity, noIdentity],
    before = structuredClone(sources);
  const selected = deduplicateWriterRequestedEvidence(sources);
  assert.deepEqual(selected, [a, ...variants, noIdentity, noIdentity]);
  assert.equal(selected[0], a);
  assert.deepEqual(sources, before);
  assert.ok(
    Buffer.byteLength(JSON.stringify(selected)) < Buffer.byteLength(JSON.stringify(sources)),
  );
});

test('requested source attributes reject shooter substitution, stale links, and unknown roster identity despite approval', () => {
  const input = { kind: 'duel', seed: 1004, time: 30 },
    state = matchState(input),
    hold = state.events.find((row) => row.recoveryKind === 'goalkeeper-hold'),
    shot = state.events.find((row) => row.id === hold.cause);
  const roster = state.frames
    .at(-1)
    .players.map(({ id, name, number, team }) => ({ id, name, number, team }));
  const question = 'Which goalkeeper gathered it, and whose attempt was it?',
    packet = { question, observedAt: 30, roster, linkedContext: { rows: [hold, shot] } };
  const ref = (row) => ({ type: 'event', id: row.id, revision: row.revision });
  const demand = {
    requestSpan: 'Which goalkeeper gathered it',
    source: 'event',
    sourceField: 'playerId',
    actorRole: 'goalkeeper',
    linkage: 'saved-shot-hold',
  };
  const part = {
    requestSpan: question,
    claimIndices: [0],
    answerForm: 'fact',
    requestedAction: 'recovery',
    requestedSourceAttributes: [demand],
  };
  const answer = {
    scope: 'match',
    claims: [
      { text: 'The holder and shooter.', kind: 'observation', evidence: [ref(hold), ref(shot)] },
    ],
  };
  const selection = {
    proofs: [
      {
        kind: 'linked-goalkeeper-hold',
        eventId: hold.id,
        revision: hold.revision,
        holderId: hold.playerId,
        shotId: shot.id,
        shotRevision: shot.revision,
        shooterId: shot.playerId,
      },
    ],
  };
  assert.deepEqual(requestedSourceAttributeIssues(part, answer, packet, selection), []);
  for (const question of [
    'Avant le but de Reed, quel gardien a récupéré un tir arrêté ?',
    'Which goalkeeper gathered the saved shot?',
    '¿Qué portero recogió el tiro parado?',
    'Qual goleiro recolheu o remate defendido?',
  ]) {
    const span = question.replace(/\s*\?$/, '');
    const attribute = { ...demand, requestSpan: question };
    const coverage = { ...part, requestSpan: span, requestedSourceAttributes: [attribute] };
    const source = { ...packet, question, requestedSourceAttributes: [attribute] };
    assert.deepEqual(requestedSourceAttributeIssues(coverage, answer, source, selection), []);
    assert.ok(
      requestedSourceAttributeIssues(
        { ...coverage, requestSpan: span.slice(0, 12) },
        answer,
        source,
        selection,
      ).length,
    );
    assert.ok(
      requestedSourceAttributeIssues(
        coverage,
        answer,
        { ...source, question: 'Different words?' },
        selection,
      ).length,
    );
  }

  assert.ok(
    requestedSourceAttributeIssues(
      part,
      { ...answer, claims: [{ ...answer.claims[0], evidence: [ref(shot)] }] },
      packet,
      { proofs: [{ kind: 'event', eventType: 'shot' }] },
    ).length,
  );
  for (const change of [
    { ...hold, cause: 'unrelated' },
    { ...hold, revision: hold.revision + 1 },
    { ...hold, time: shot.time - 1 },
    { ...hold, team: shot.team },
    { ...hold, operation: 'delete' },
  ])
    assert.ok(
      requestedSourceAttributeIssues(
        part,
        answer,
        { ...packet, linkedContext: { rows: [shot, change] } },
        selection,
      ).length,
    );
  const captain = {
    ...part,
    requestedAction: 'other',
    requestedSourceAttributes: [
      {
        requestSpan: 'captain',
        source: 'roster',
        sourceField: 'captain',
        actorRole: 'none',
        linkage: 'none',
      },
    ],
    requestSpan: 'Identify the captain',
  };
  const p = { ...packet, question: captain.requestSpan };
  assert.ok(requestedSourceAttributeIssues(captain, answer, p, selection).length);
  assert.ok(
    requestedSourceAttributeIssues(
      { ...captain, requestedSourceAttributes: null },
      answer,
      { ...p, requestedSourceAttributes: captain.requestedSourceAttributes },
      selection,
    ).length,
  );
  const limitation = {
    scope: 'match',
    claims: [
      {
        kind: 'limitation',
        text: 'The available information does not identify the captain.',
        evidence: [],
      },
    ],
  };
  assert.deepEqual(
    requestedSourceAttributeIssues(captain, limitation, p, null, [
      { claimIndex: 0, supported: true },
    ]),
    [],
  );
  assert.deepEqual(
    requestedSourceAttributeIssues(
      { ...captain, requestedSourceAttributes: undefined },
      answer,
      p,
      selection,
    ),
    [],
  );
  assert.deepEqual(
    requestedSourceAttributeIssues(
      { ...captain, requestedSourceAttributes: null, requestedAction: 'shot' },
      answer,
      p,
      selection,
    ),
    [],
  );
});

test('source-role review repairs an approved shooter-only answer to the explicit holder and shooter', async () => {
  const input = {
    kind: 'duel',
    seed: 1004,
    time: 30,
    question:
      'Which goalkeeper has actually gathered a saved shot so far, and whose attempt was it?',
  };
  const parts = requestComponents(input.question),
    keeper = {
      requestSpan: parts[0],
      source: 'event',
      sourceField: 'playerId',
      actorRole: 'goalkeeper',
      linkage: 'saved-shot-hold',
    },
    shooter = {
      requestSpan: parts[1],
      source: 'event',
      sourceField: 'playerId',
      actorRole: 'shooter',
      linkage: 'none',
    };
  let keeperId;
  const review = (packet) => ({
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      requestedInformation: input.question,
      reason: 'Mock independently extracted role demands.',
      coverage: parts.map((requestSpan, i) => ({
        requestSpan,
        claimIndices: [0],
        answerForm: 'fact',
        requestedAction: i ? 'shot' : 'recovery',
        temporalRelation: 'none',
        requestedSourceAttributes: null,
      })),
    },
  });
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      requestedForm: 'fact',
      mentionedPlayers: [],
      requestedSourceAttributes: [keeper],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'shot', outcome: 'saved' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
          {
            filters: {
              type: 'recovery',
              recoveryKind: 'goalkeeper-hold',
              linkedShotOutcome: 'saved',
            },
            aggregate: 'list',
            order: 'asc',
            limit: 20,
          },
        ],
      },
    },
    (packet) => {
      keeperId = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-goalkeeper-hold',
      )?.id;
      assert.ok(keeperId);
      const shot = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'savedShots',
      );
      assert.ok(shot);
      return { scope: 'match', composition: { mode: 'facts', factIds: [shot.id] }, followUp: '' };
    },
    review,
    (packet) => {
      assert.ok(packet.feedback.requestAdequacy.some((issue) => issue.requestedSourceAttribute));
      return { scope: 'match', composition: { mode: 'facts', factIds: [keeperId] }, followUp: '' };
    },
    review,
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.match(answer.answer, /Laurent/);
  assert.match(answer.answer, /Demir/);
  assert.equal(answer.execution.modelCalls, 5);
  assert.equal(answer.claims[0].evidence.filter((ref) => ref.type === 'event').length, 2);
});

test('missing roster attribute is a specific limitation, not an unrelated reception list', async () => {
  const input = {
    kind: 'quiet',
    seed: 1007,
    time: 72,
    question: "Can you identify Northbridge's captain from the information available here?",
  };
  const demand = {
    requestSpan: input.question,
    source: 'roster',
    sourceField: 'captain',
    actorRole: 'none',
    linkage: 'none',
  };
  const review = {
    decision: 'approve',
    requestCheck: {
      status: 'useful-limitation',
      requestedInformation: input.question,
      reason: 'Mock captain metadata absence.',
      coverage: [
        {
          requestSpan: input.question,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'other',
          temporalRelation: 'none',
          requestedSourceAttributes: [demand],
        },
      ],
    },
  };
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: [demand],
      answerFocus: 'other',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'receive', team: 'home' },
            aggregate: 'list',
            order: 'asc',
            limit: 20,
          },
        ],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'event' && f.selection.eventType === 'receive',
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    review,
    () => ({
      scope: 'match',
      composition: {
        mode: 'limitation',
        factIds: [],
        claim: {
          text: 'The available information does not identify Northbridge’s captain.',
          kind: 'limitation',
          evidence: [],
          dependsOn: [],
        },
      },
      followUp: '',
    }),
    review,
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.claims.length, 1);
  assert.equal(answer.claims[0].kind, 'limitation');
  assert.equal(answer.claimProvenance[0].modelGenerated, true);
  assert.equal(answer.provenance.modelGenerated, true);
  assert.doesNotMatch(answer.answer, /receives|no captain/);
  assert.equal(answer.execution.modelCalls, 5);
});

test('planner source-attribute contract can produce an immediate useful missing-metadata limitation', async () => {
  const input = {
      kind: 'quiet',
      seed: 1007,
      time: 72,
      question: "Can you identify Northbridge's captain from the information available here?",
    },
    span = requestComponents(input.question)[0];
  const demand = {
    requestSpan: span,
    source: 'roster',
    sourceField: 'captain',
    actorRole: 'none',
    linkage: 'none',
  };
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: [demand],
      answerFocus: 'other',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: { kind: 'queries', queries: [] },
    },
    (packet, body) => {
      assert.ok(packet.sourceAttributeCapabilities);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.ok(
        modes.every((mode) =>
          mode.properties.mode.enum.some((name) =>
            ['limitation', 'unavailable-roster-attribute'].includes(name),
          ),
        ),
      );
      return {
        scope: 'match',
        composition: {
          mode: 'limitation',
          factIds: [],
          claim: {
            text: 'The available information does not identify Northbridge’s captain.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    {
      decision: 'approve',
      requestCheck: {
        status: 'useful-limitation',
        requestedInformation: input.question,
        reason: 'Unknown role, not no captain.',
        coverage: [
          {
            requestSpan: span,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'other',
            requestedSourceAttributes: [demand],
          },
        ],
      },
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.claims[0].kind, 'limitation');
});

test('missing requested role records use one planning repair before writing, without guessing an identity', async () => {
  const input = {
      kind: 'duel',
      seed: 1004,
      time: 30,
      question: 'Which goalkeeper collected a saved attempt?',
    },
    span = requestComponents(input.question)[0];
  const demand = {
    requestSpan: span,
    source: 'event',
    sourceField: 'playerId',
    actorRole: 'goalkeeper',
    linkage: 'saved-shot-hold',
  };
  const plan = (queries) => ({
    requestedSourceAttributes: [demand],
    answerFocus: 'event-actor',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: { kind: 'queries', queries },
  });
  const mock = sequenceTransport([
    plan([]),
    (packet) => {
      assert.equal(packet.planningCorrection.kind, 'missing-source-role-evidence');
      return plan([
        {
          filters: {
            type: 'recovery',
            recoveryKind: 'goalkeeper-hold',
            linkedShotOutcome: 'saved',
          },
          aggregate: 'list',
          order: 'asc',
          limit: 20,
        },
      ]);
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-goalkeeper-hold',
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    {
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Explicit holder, never a jersey guess.',
        coverage: [
          {
            requestSpan: span,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'recovery',
            requestedSourceAttributes: [demand],
          },
        ],
      },
    },
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.match(answer.answer, /Laurent/);
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.execution.planningRepairs, 1);
});

test('roster number needs rendered attribute proof', () => {
  const question = 'What number does Ali wear?',
    span = 'What number',
    row = { id: 'home-2', name: 'Ali', number: 7, team: 'home' };
  const packet = { question, roster: [row] },
    claim = {
      kind: 'observation',
      text: 'Ali wears number 7.',
      evidence: [{ type: 'scope', id: 'player', revision: 1 }],
    },
    answer = { scope: 'match', claims: [claim] };
  const demand = {
      requestSpan: span,
      source: 'roster',
      sourceField: 'number',
      actorRole: 'none',
      linkage: 'none',
    },
    part = {
      requestSpan: question,
      requestedAction: 'other',
      answerForm: 'fact',
      claimIndices: [0],
      requestedSourceAttributes: [demand],
    };
  assert.ok(
    requestedSourceAttributeIssues(part, answer, packet, {
      proofs: [{ kind: 'roster', playerId: row.id }],
    }).length,
  );
  assert.ok(
    requestedSourceAttributeIssues(part, answer, packet, {
      proofs: [{ kind: 'roster', playerId: row.id, attributes: { number: 1 } }],
    }).length,
  );
  assert.deepEqual(
    requestedSourceAttributeIssues(part, answer, packet, {
      proofs: [{ kind: 'roster', playerId: row.id, attributes: { number: 7 } }],
    }),
    [],
  );
});

test('recorded shirt number remains answerable through its exact canonical roster attribute', async () => {
  const input = { kind: 'quiet', seed: 1007, time: 72 },
    player = matchState(input).frames.at(-1).players[0];
  input.question = `What shirt number does ${player.name} wear?`;
  const span = requestComponents(input.question)[0],
    demand = {
      requestSpan: span,
      source: 'roster',
      sourceField: 'number',
      actorRole: 'none',
      linkage: 'none',
    };
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: [demand],
      answerFocus: 'other',
      requestedForm: 'fact',
      mentionedPlayers: [player.name],
      decision: {
        kind: 'queries',
        queries: [{ filters: { player: player.id }, aggregate: 'count' }],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'roster' && f.selection.attributes?.number === player.number,
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    {
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Exact rendered roster number.',
        coverage: [
          {
            requestSpan: span,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'other',
            requestedSourceAttributes: [demand],
          },
        ],
      },
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.canonicalFactSelection.proofs[0].attributes.number, player.number);
});

test('attribute review allowance is conditional and bounded at 1600 without changing ordinary single-part reviews', () => {
  assert.equal(sourceAttributeReviewBudget(530, 1, 0), 530);
  assert.equal(sourceAttributeReviewBudget(530, 2, 2), 1290);
  assert.equal(sourceAttributeReviewBudget(530, 1, 2), 1110);
  assert.equal(sourceAttributeReviewBudget(530, 8, 4), 1600);
});

test('native role-plan mismatch repairs once and review schema permits only literal question spans with compact bounded output', async () => {
  const input = {
      kind: 'duel',
      seed: 1004,
      time: 30,
      question:
        'Which goalkeeper has actually gathered a saved shot so far, and whose attempt was it?',
    },
    parts = requestComponents(input.question);
  const keeper = {
      requestSpan: parts[0],
      source: 'event',
      sourceField: 'playerId',
      actorRole: 'goalkeeper',
      linkage: 'saved-shot-hold',
    },
    shooter = {
      requestSpan: parts[1],
      source: 'event',
      sourceField: 'playerId',
      actorRole: 'shooter',
      linkage: 'none',
    };
  const plan = {
    requestedSourceAttributes: [keeper],
    answerFocus: 'event-actor',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: {
            type: 'recovery',
            recoveryKind: 'goalkeeper-hold',
            linkedShotOutcome: 'saved',
          },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
        },
      ],
    },
  };
  const bad = structuredClone(plan);
  bad.requestedSourceAttributes[0].sourceField = 'recoveryKind';
  const mock = sequenceTransport([
    (_packet, body) => {
      const variants =
        resolvedWireSchema(body).properties.requestedSourceAttributes.anyOf[1].items.anyOf;
      const role = variants.find((item) => item.properties.actorRole.enum.includes('goalkeeper'));
      assert.deepEqual(role.properties.sourceField.enum, ['playerId']);
      assert.deepEqual(role.properties.linkage.enum, ['saved-shot-hold']);
      return bad;
    },
    (packet) => {
      assert.match(packet.planningError, /playerId/);
      return plan;
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-goalkeeper-hold',
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet, body) => {
      assert.equal(body.max_completion_tokens, 1150);
      const schema = resolvedWireSchema(body),
        variants =
          schema.properties.requestCheck.properties.coverage.items.properties
            .requestedSourceAttributes.anyOf[1].items.anyOf;
      for (const variant of variants) {
        assert.ok(variant.properties.requestSpan.enum.includes(keeper.requestSpan));
        assert.ok(!variant.properties.requestSpan.enum.includes(parts[1]));
        assert.ok(!variant.properties.requestSpan.enum.includes('shooter'));
      }
      assert.match(body.messages[0].content, /compact JSON/);
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Both roles answered.',
          coverage: parts.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: index ? 'shot' : 'recovery',
            requestedSourceAttributes: index ? null : [{ ...keeper, requestSpan }],
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.match(answer.answer, /Laurent/);
  assert.match(answer.answer, /Demir/);
});

test('ordinal dependent entity scope repairs an invented team restriction together with wrong ordinal', async () => {
  const input = {
    kind: 'counter',
    seed: 1002,
    time: 118,
    question:
      "After W. Walker's second saved attempt, whose next pass reached a teammate, and at what time?",
  };
  const state = matchState(input),
    teams = state.metadata.teams,
    roster = state.frames.at(-1).players;
  const permission = ordinalDependentScope(input.question, teams, roster);
  assert.equal(permission.sameTeam, false);
  assert.deepEqual(permission.teams, []);
  assert.deepEqual(permission.players, []);
  for (const phrase of ['the same team', 'his team', 'her side', 'their team'])
    assert.equal(
      ordinalDependentScope(
        'After the second shot, who made the next pass for ' + phrase + '?',
        teams,
        roster,
      ).sameTeam,
      true,
    );
  assert.deepEqual(
    ordinalDependentScope(
      'After the second shot, who made the next Northbridge pass?',
      teams,
      roster,
    ).teams,
    ['home'],
  );
  assert.deepEqual(
    ordinalDependentScope("After the second shot, when was Q. Blake's next pass?", teams, roster)
      .players,
    ['home-1'],
  );
  assert.equal(
    ordinalDependentScope('After the second shot, when did the same player pass?', teams, roster)
      .samePlayer,
    true,
  );
  assert.equal(
    ordinalDependentScope(
      'After the second shot whose next pass reached a teammate?',
      teams,
      roster,
    ).requestSpan,
    null,
    'Ambiguous clause boundary supplies no license',
  );
  const anchor = {
    filters: { type: 'shot', player: 'W. Walker', outcome: 'saved' },
    aggregate: 'list',
    order: 'asc',
    limit: 2,
  };
  const dependent = {
    filters: { type: 'pass', result: true },
    aggregate: 'list',
    order: 'asc',
    limit: 1,
    relativeTo: {
      queryIndex: 0,
      relation: 'after',
      sameTeam: false,
      samePlayer: false,
      anchorOrdinal: 2,
    },
  };
  for (const restriction of [
    { relativeTo: { ...dependent.relativeTo, sameTeam: true, anchorOrdinal: 1 } },
    { filters: { ...dependent.filters, team: 'away' } },
    { filters: { ...dependent.filters, player: 'away-10' } },
  ]) {
    const plan = {
      answerFocus: 'event-actor',
      requestedForm: 'fact',
      mentionedPlayers: ['W. Walker'],
      decision: { kind: 'queries', queries: [anchor, { ...dependent, ...restriction }] },
    };
    const mock = sequenceTransport([
      plan,
      (packet) => {
        assert.equal(packet.planningCorrection.kind, 'unlicensed-ordinal-entity-scope');
        assert.equal(packet.planningCorrection.requiredOrdinal, 2);
        assert.equal(packet.planningCorrection.requiredRelation, 'after');
        return { ...plan, decision: { kind: 'queries', queries: [anchor, dependent] } };
      },
      (packet) => {
        const fact = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'ordered-event' &&
            f.selection.metric === 'completedPasses' &&
            f.selection.timeFrom === 87,
        );
        assert.ok(fact);
        return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
      },
      (packet) => ({
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Unrestricted next pass after independently requested second saved attempt.',
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'after-requested-event',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            requestedAnchorOrdinal: 2,
          })),
        },
      }),
    ]);
    const answer = await answerMatchQuestionAI(input, {
      config,
      fetcher: mock.fetcher,
      canRepair: () => true,
    });
    assert.equal(answer.execution.modelCalls, 4);
    assert.equal(answer.execution.planningRepairs, 1);
    assert.match(answer.answer, /Q\. Blake/);
    assert.match(answer.answer, /01:31/);
  }
});

test('assessment quantity coverage uses only explicit backward canonical observation dependencies', () => {
  const input = { kind: 'counter', seed: 1002, time: 118 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'shot' },
      aggregate: 'by-team',
      timeFrom: 88,
      timeTo: 118,
    });
  const packet = {
    question:
      'Over the last half-minute, which side produced more shots, and is that enough to say they were the fitter side?',
    observedAt: 118,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedEvidence: [source],
    queryResults: [source],
  };
  const facts = buildQuestionFacts(packet).facts,
    comparison = facts.find(
      (f) =>
        f.proof.kind === 'team-comparison' &&
        f.proof.metric === 'attempts' &&
        f.proof.timeFrom === 88,
    );
  assert.ok(comparison);
  const answer = {
      scope: 'match',
      claims: [
        comparison.claim,
        {
          kind: 'interpretation',
          text: 'Northbridge produced more shots. Those counts do not establish which side was fitter.',
          evidence: [...comparison.claim.evidence],
        },
      ],
      claimDependencies: [{ claimIndex: 1, observationIndices: [0] }],
    },
    selection = { proofs: [comparison.proof] };
  const part = {
    requestSpan: 'which side produced more shots',
    claimIndices: [1],
    answerForm: 'assessment',
    requestedAction: 'shot',
    requestedQuantity: [
      {
        requestSpan: 'which side produced more shots',
        action: 'shot',
        state: 'any',
        grouping: 'by-team',
        subjectIds: [],
        timeFrom: 88,
        timeTo: 118,
      },
    ],
    requestedSourceAttributes: null,
  };
  assert.deepEqual(requestedQuantityIssues(part, answer, packet, selection), []);
  assert.deepEqual(
    requestedSourceAttributeIssues(part, answer, packet, selection),
    [],
    'Ordinary team quantity has no additional actor-attribute obligation',
  );
  for (const links of [
    [],
    [{ claimIndex: 0, observationIndices: [0] }],
    [{ claimIndex: 1, observationIndices: [1] }],
    [{ claimIndex: 1, observationIndices: [2] }],
    [{ claimIndex: 1, observationIndices: ['0'] }],
  ])
    assert.ok(
      requestedQuantityIssues(part, { ...answer, claimDependencies: links }, packet, selection)
        .length,
    );
  const wrong = structuredClone(selection);
  wrong.proofs[0].timeFrom = 0;
  assert.ok(requestedQuantityIssues(part, answer, packet, wrong).length);
  const generated = structuredClone(selection);
  generated.proofs[0].modelGenerated = true;
  assert.ok(requestedQuantityIssues(part, answer, packet, generated).length);
  const missingScope = structuredClone(answer);
  missingScope.claims[0].evidence = [];
  assert.ok(requestedQuantityIssues(part, missingScope, packet, selection).length);
  const oneSide = structuredClone(selection);
  oneSide.proofs[0].values = { home: 2 };
  assert.ok(requestedQuantityIssues(part, answer, packet, oneSide).length);
});

test('source attribute wire and runtime are restricted to keeper linkage and roster metadata', async () => {
  const input = {
      kind: 'counter',
      seed: 1002,
      time: 118,
      question: 'Which side produced more shots?',
    },
    ordinary = {
      requestSpan: input.question,
      source: 'event',
      sourceField: 'playerId',
      actorRole: 'shooter',
      linkage: 'none',
    };
  const mock = sequenceTransport(
    [
      {
        requestedSourceAttributes: [ordinary],
        answerFocus: 'team-assessment',
        requestedForm: 'fact',
        mentionedPlayers: [],
        decision: { kind: 'queries', queries: [] },
      },
    ],
    (packet, index, body) => {
      if (index) return;
      const schema = resolvedWireSchema(body).properties.requestedSourceAttributes;
      const variants = schema.anyOf.find((v) => v.type === 'array').items.anyOf;
      assert.equal(variants.length, 2);
      assert.deepEqual(
        variants.map((v) => v.properties.source.enum),
        [['roster'], ['event']],
      );
      assert.deepEqual(variants[1].properties.actorRole.enum, ['goalkeeper']);
      assert.deepEqual(variants[1].properties.sourceField.enum, ['playerId']);
      assert.deepEqual(variants[1].properties.linkage.enum, ['saved-shot-hold']);
    },
  );
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher, canRepair: () => false }),
    /Requested source attributes/,
  );
  assert.equal(mock.count(), 1);
  assert.ok(
    requestedSourceAttributeIssues(
      { requestSpan: input.question, claimIndices: [], requestedSourceAttributes: [ordinary] },
      { scope: 'match', claims: [] },
      { question: input.question },
      null,
    ).length,
  );
});

test('team assessment operation recovery selects only the requested canonical measure plus a pure limitation', async () => {
  const input = {
    kind: 'counter',
    seed: 1002,
    time: 118,
    question:
      'Over the last half-minute, which side produced more shots, and is that enough to say they were the fitter side?',
  };
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: null,
      answerFocus: 'team-assessment',
      requestedForm: 'assessment',
      mentionedPlayers: [],
      decision: {
        kind: 'operation',
        plan: {
          version: 1,
          obligations: [
            {
              id: 'shots',
              requestSpan: 'which side produced more shots',
              operator: 'difference',
              metric: 'attempts',
              subjects: ['home', 'away'],
              timeFrom: 88,
              timeTo: 118,
            },
          ],
        },
      },
    },
    (packet, body) => {
      assert.equal(packet.planningCorrection.kind, 'operation-assessment-incomplete');
      assert.ok(packet.planningCorrection.verifiedFacts.length);
      assert.deepEqual(
        resolvedWireSchema(body).properties.decision.anyOf.map(
          (mode) => mode.properties.kind.enum[0],
        ),
        ['queries'],
      );
      return {
        requestedSourceAttributes: null,
        answerFocus: 'team-assessment',
        requestedForm: 'assessment',
        mentionedPlayers: [],
        decision: {
          kind: 'queries',
          queries: [{ filters: { type: 'shot' }, aggregate: 'by-team', timeFrom: 88, timeTo: 118 }],
        },
      };
    },
    (packet, body) => {
      const facts = packet.matchFacts.facts;
      assert.equal(facts.length, 1);
      assert.equal(facts[0].selection.metric, 'attempts');
      assert.equal(facts[0].selection.timeFrom, 88);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.equal(modes.length, 1);
      assert.deepEqual(modes[0].properties.claim.properties.kind.enum, ['limitation']);
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: [facts[0].id],
          claim: {
            kind: 'limitation',
            text: 'However, this alone is not enough to conclude that Northbridge was the fitter side, as shot count does not directly measure fitness or overall team performance.',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'useful-limitation',
        requestedInformation: input.question,
        reason: 'Exact measured comparison plus explicit limits.',
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: [i],
          answerForm: i ? 'unavailable-measurement' : 'fact',
          requestedAction: i ? 'other' : 'shot',
          requestedSourceAttributes: null,
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.match(answer.answer, /not enough to conclude/);
  assert.doesNotMatch(answer.answer, /on.target/i);
  assert.equal(answer.claims.length, 2);
});

test('writer inventory limitation answers a missed roster demand without unrelated event facts', async () => {
  const input = {
      kind: 'quiet',
      seed: 1007,
      time: 72,
      question: "Can you identify Northbridge's captain from the information available here?",
    },
    span = requestComponents(input.question)[0];
  const plan = {
    requestedSourceAttributes: null,
    answerFocus: 'other',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', team: 'home', result: true },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 72,
        },
      ],
    },
  };
  const inventory = {
    mode: 'unavailable-roster-attribute',
    requestSpan: span,
    sourceField: 'captain',
  };
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      const wire = body.response_format.json_schema.schema;
      assert.ok(wire.$defs, 'canonical writer shares repeated constraints');
      const { $defs, ...expanded } = resolvedWireSchema(body);
      assert.ok(
        JSON.stringify(wire).length < JSON.stringify(expanded).length,
        'wire schema is smaller without dropping composition modes',
      );
      assert.ok(
        expanded.properties.composition.anyOf.some((mode) =>
          mode.properties.mode.enum.includes('unavailable-roster-attribute'),
        ),
      );
      return { scope: 'match', composition: inventory, followUp: '' };
    },
    (packet) => {
      assert.equal(packet.answer.claims.length, 1);
      assert.equal(packet.answer.claims[0].kind, 'limitation');
      assert.deepEqual(packet.answer.claims[0].evidence, []);
      return {
        decision: 'approve',
        requestCheck: {
          status: 'useful-limitation',
          requestedInformation: input.question,
          reason:
            'Roster does not supply the requested attribute, rather than no captain existing.',
          coverage: [
            {
              requestSpan: span,
              claimIndices: [0],
              answerForm: 'fact',
              requestedAction: 'other',
              requestedSourceAttributes: [
                {
                  requestSpan: span,
                  source: 'roster',
                  sourceField: 'captain',
                  actorRole: 'none',
                  linkage: 'none',
                },
              ],
            },
          ],
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 1);
  assert.match(result.answer, /captain information is not recorded/);
  assert.doesNotMatch(result.answer, /pass|no captain/i);
  assert.equal(result.sourceInventoryLimitation.sourceField, 'captain');
  assert.equal(result.sourceInventoryLimitation.modelGenerated, false);
  assert.equal(result.claimProvenance[0].source, 'verified-source-inventory-limitation');
  assert.equal(result.claimProvenance[0].modelGenerated, false);
  assert.equal(result.provenance.modelGenerated, false);
  for (const bad of [
    { ...inventory, sourceField: 'number' },
    { ...inventory, requestSpan: 'unrelated question' },
    { ...inventory, text: 'Northbridge has no captain.' },
  ]) {
    const invalid = sequenceTransport([plan, { scope: 'match', composition: bad, followUp: '' }]);
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: invalid.fetcher, canRepair: () => false }),
      /bounded composition/,
    );
    assert.equal(invalid.count(), 2);
  }
  const mixed = { ...input, question: input.question + ' Who made the last pass?' },
    mixedPlan = structuredClone(plan);
  delete mixedPlan.decision.queries[0].filters.result;
  const invalid = sequenceTransport([
    mixedPlan,
    (packet, body) => {
      assert.ok(
        !resolvedWireSchema(body).properties.composition.anyOf.some((mode) =>
          mode.properties.mode.enum.includes('unavailable-roster-attribute'),
        ),
      );
      return { scope: 'match', composition: inventory, followUp: '' };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(mixed, { config, fetcher: invalid.fetcher, canRepair: () => false }),
    /bounded composition/,
  );
});

test('planning and its one repair constrain role spans to literal question text without inventing shooter requirements', async () => {
  const input = {
      kind: 'duel',
      seed: 1004,
      time: 30,
      question:
        'Which goalkeeper has actually gathered a saved shot so far, and whose attempt was it?',
    },
    parts = requestComponents(input.question);
  const bad = {
    requestedSourceAttributes: [
      {
        requestSpan: 'goalkeeper who gathered a saved shot',
        source: 'event',
        sourceField: 'playerId',
        actorRole: 'goalkeeper',
        linkage: 'saved-shot-hold',
      },
      {
        requestSpan: 'player who attempted the saved shot',
        source: 'event',
        sourceField: 'playerId',
        actorRole: 'goalkeeper',
        linkage: 'saved-shot-hold',
      },
    ],
    answerFocus: 'event-actor',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: {
            type: 'recovery',
            recoveryKind: 'goalkeeper-hold',
            linkedShotOutcome: 'saved',
          },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
        },
      ],
    },
  };
  const good = {
    ...bad,
    requestedSourceAttributes: [{ ...bad.requestedSourceAttributes[0], requestSpan: parts[0] }],
  };
  const inspect = (_packet, index, body) => {
    if (index > 1) return;
    const variants =
      resolvedWireSchema(body).properties.requestedSourceAttributes.anyOf[1].items.anyOf;
    for (const variant of variants) {
      assert.deepEqual(variant.properties.requestSpan.enum, parts);
      assert.ok(
        !variant.properties.requestSpan.enum.includes(bad.requestedSourceAttributes[0].requestSpan),
      );
    }
    assert.match(body.messages[0].content, /omit the ordinary shooter/);
  };
  const mock = sequenceTransport(
    [
      bad,
      (packet) => {
        assert.equal(packet.planningCorrection.kind, 'invalid-source-attribute-span-or-role');
        assert.deepEqual(packet.planningCorrection.allowedRequestSpans, parts);
        return good;
      },
      (packet) => {
        const fact = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'linked-goalkeeper-hold',
        );
        return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
      },
      (packet) => ({
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'The explicit linked fact names both actual actors.',
          coverage: parts.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: index ? 'shot' : 'recovery',
            requestedSourceAttributes: index ? null : [good.requestedSourceAttributes[0]],
          })),
        },
      }),
    ],
    inspect,
  );
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.planningRepairs, 1);
  assert.match(result.answer, /Laurent/);
  assert.match(result.answer, /Demir/);
  const repeat = sequenceTransport([bad, bad]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: repeat.fetcher, canRepair: () => true }),
    /Requested source attributes/,
  );
  assert.equal(repeat.count(), 2);
});

test('ordinary foot review cannot invent keeper or roster requirements after canonical composition', async () => {
  const input = {
      kind: 'duel',
      seed: 1004,
      time: 15,
      language: 'en',
      question:
        'Who played the outside-of-the-foot pass in this opening spell, and was it with the left or right foot?',
    },
    parts = requestComponents(input.question);
  let selection;
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: null,
      answerFocus: 'event-actor',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', technique: 'trivela' },
            aggregate: 'list',
            order: 'asc',
            limit: 1,
            timeFrom: 0,
            timeTo: 15,
          },
        ],
      },
    },
    (packet) => {
      const candidates = packet.matchFacts.facts.filter(
        (f) => f.selection.eventType === 'pass' && f.selection.time === 6,
      );
      const base = candidates.find((f) => !f.selection.attributes),
        foot = candidates.find((f) => f.selection.attributes?.bodyPart === 'right-foot'),
        technique = candidates.find((f) => f.selection.attributes?.technique === 'trivela');
      assert.ok(base && foot && technique);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [base.id, foot.id, technique.id] },
        followUp: '',
      };
    },
    (packet, body) => {
      assert.equal(
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.properties
          .sourceInventoryDependency.type,
        'null',
      );
      assert.equal(
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.properties
          .requestedSourceAttributes.type,
        'null',
      );
      selection = packet.canonicalFactSelection;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'The actual canonical actor, technique and foot answer both parts.',
          coverage: parts.map((requestSpan, i) => ({
            requestSpan,
            claimIndices: i ? [1] : [0, 2],
            answerForm: 'fact',
            requestedAction: 'pass',
            requestedSourceAttributes: null,
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /Ali/);
  assert.match(answer.answer, /right foot/);
  assert.match(answer.answer, /outside-of-the-foot/);
  for (const demand of [
    {
      source: 'event',
      sourceField: 'playerId',
      actorRole: 'goalkeeper',
      linkage: 'saved-shot-hold',
    },
    { source: 'roster', sourceField: 'captain', actorRole: 'none', linkage: 'none' },
  ]) {
    const issues = requestedSourceAttributeIssues(
      {
        requestSpan: parts[0],
        claimIndices: [0, 2],
        requestedSourceAttributes: [{ requestSpan: parts[0], ...demand }],
      },
      answer,
      { question: input.question, requestedSourceAttributes: [] },
      selection,
    );
    assert.ok(issues.some((issue) => /cannot introduce/.test(issue.reason)));
  }
});

test('multipart keeper requirements use the owned clause, never the entire two-part question', async () => {
  const input = {
      kind: 'duel',
      seed: 1004,
      time: 30,
      question:
        'Which goalkeeper has actually gathered a saved shot so far, and whose attempt was it?',
    },
    parts = requestComponents(input.question);
  const demand = {
    requestSpan: parts[0],
    source: 'event',
    sourceField: 'playerId',
    actorRole: 'goalkeeper',
    linkage: 'saved-shot-hold',
  };
  const plan = {
    requestedSourceAttributes: [demand],
    answerFocus: 'event-actor',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: {
            type: 'recovery',
            recoveryKind: 'goalkeeper-hold',
            linkedShotOutcome: 'saved',
          },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
        },
      ],
    },
  };
  const write = (packet) => {
    const fact = packet.matchFacts.facts.find((f) => f.selection.kind === 'linked-goalkeeper-hold');
    assert.ok(fact);
    return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
  };
  const review = (packet) => ({
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      requestedInformation: input.question,
      reason: 'The cited explicit hold link names both actors.',
      coverage: parts.map((requestSpan, i) => ({
        requestSpan,
        claimIndices: [0],
        answerForm: 'fact',
        requestedAction: i ? 'shot' : 'recovery',
        requestedSourceAttributes: i ? null : [demand],
      })),
    },
  });
  const inspect = (_packet, index, body) => {
    if (index) return;
    for (const variant of resolvedWireSchema(body).properties.requestedSourceAttributes.anyOf[1]
      .items.anyOf) {
      assert.deepEqual(variant.properties.requestSpan.enum, parts);
      assert.ok(!variant.properties.requestSpan.enum.includes(input.question));
    }
  };
  const mock = sequenceTransport([plan, write, review], inspect),
    answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /Laurent/);
  assert.match(answer.answer, /Demir/);
  const invalid = {
    ...plan,
    requestedSourceAttributes: [{ ...demand, requestSpan: input.question }],
  };
  const repaired = sequenceTransport([
    invalid,
    (packet) => {
      assert.deepEqual(packet.planningCorrection.allowedRequestSpans, parts);
      return plan;
    },
    write,
    review,
  ]);
  const fixed = await answerMatchQuestionAI(input, {
    config,
    fetcher: repaired.fetcher,
    canRepair: () => true,
  });
  assert.equal(fixed.execution.modelCalls, 4);
  assert.equal(fixed.execution.planningRepairs, 1);
});

test('outcome explanation facts cannot replace the complete requested breakdown with a partial list', async () => {
  const input = {
    kind: 'duel',
    seed: 1012,
    time: 118,
    question:
      "A. Blake's three attempts were all kept out by the goalkeeper, right? Break down how they actually ended.",
  };
  for (const limit of [2, 3]) {
    const mock = sequenceTransport([
      {
        answerFocus: 'event-sequence',
        explanationTarget: 'observed-sequence',
        requestedForm: 'explanation',
        mentionedPlayers: ['A. Blake'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'shot', team: 'away', player: 'A. Blake' },
              aggregate: 'list',
              order: 'asc',
              limit,
              timeFrom: 0,
              timeTo: 118,
            },
          ],
        },
      },
      (packet) => {
        const facts = packet.matchFacts.facts
          .filter(
            (f) =>
              f.selection.kind === 'event' &&
              f.selection.eventType === 'shot' &&
              f.selection.playerId === 'away-10' &&
              !f.selection.attributes,
          )
          .slice(0, 2);
        return {
          scope: 'match',
          composition: { mode: 'facts', factIds: facts.map((f) => f.id) },
          followUp: '',
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: mock.fetcher, canRepair: () => false }),
      /explanation in facts mode/,
    );
    assert.equal(mock.count(), 2);
  }
});

test('rejected outcome prose repairs to the exact complete current breakdown instead of one adjacent delivery', async () => {
  const input = {
    kind: 'duel',
    seed: 1012,
    time: 118,
    question:
      "A. Blake's three attempts were all kept out by the goalkeeper, right? Break down how they actually ended.",
  };
  const plan = {
    answerFocus: 'event-sequence',
    explanationTarget: 'observed-sequence',
    requestedForm: 'explanation',
    mentionedPlayers: ['A. Blake'],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'shot', team: 'away', player: 'A. Blake' },
          aggregate: 'list',
          order: 'asc',
          limit: 3,
          timeFrom: 0,
          timeTo: 118,
        },
      ],
    },
  };
  let selected;
  const writer = (packet) => {
    selected = packet.matchFacts.facts
      .filter(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'shot' &&
          f.selection.playerId === 'away-10' &&
          !f.selection.attributes,
      )
      .map((f) => f.id);
    assert.equal(selected.length, 3);
    return {
      premiseCheck: {
        questionAssumption: 'All kept out by the goalkeeper.',
        recordedAction: 'Three shots.',
        conclusion: 'contradicted',
      },
      scope: 'match',
      composition: {
        mode: 'explanation',
        factIds: selected,
        claim: {
          text: 'A. Blake took three shots: the first was blocked by a defender, the second went off target, and only the third was saved by the goalkeeper. Therefore, not all three attempts were kept out by the goalkeeper.',
          kind: 'interpretation',
          evidence: [],
          dependsOn: [0, 1, 2],
        },
      },
      followUp: '',
    };
  };
  const review = (packet) => ({
    decision: 'approve',
    requestCheck: {
      status: 'corrected-premise',
      requestedInformation: input.question,
      reason: 'All exact current outcomes explicitly distinguish saved and non-saved attempts.',
      coverage: packet.requestComponents.map((requestSpan) => ({
        requestSpan,
        claimIndices: [0, 1, 2],
        answerForm: 'explanation',
        requestedAction: 'shot',
        requestedSourceAttributes: null,
        requestedQuantity: null,
      })),
    },
  });
  const mock = sequenceTransport([
    plan,
    writer,
    (packet, body) => {
      assert.ok(packet.feedback.issues.length);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.equal(modes.length, 1);
      assert.deepEqual(modes[0].properties.mode.enum, ['facts']);
      assert.deepEqual(modes[0].properties.factIds.items.enum, selected);
      assert.equal(modes[0].properties.factIds.minItems, 3);
      return { scope: 'match', composition: { mode: 'facts', factIds: selected }, followUp: '' };
    },
    review,
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.claims.length, 3);
  assert.match(result.answer, /blocked/);
  assert.match(result.answer, /off target/);
  assert.match(result.answer, /saved/);
  assert.doesNotMatch(result.answer, /defender|three shots/);
  const bad = sequenceTransport([
    plan,
    writer,
    (packet) => {
      const supply = packet.evidence.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-shot-supply',
      );
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [supply?.id || selected[0]] },
        followUp: '',
      };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: bad.fetcher, canRepair: () => true }),
    /outcome repair must preserve/,
  );
  assert.equal(bad.count(), 3);
});

test('current canonical pending target answers reception status without asserting an actual reception', async () => {
  const input = {
    kind: 'duel',
    seed: 2041,
    time: 118,
    question: 'Hang on, who was that ball meant for, and has it got there yet?',
    conversation: [
      {
        question: 'Who played that pass at 01:56?',
        answer: 'J. Cole played the pass at 01:56.',
        time: 118,
      },
    ],
  };
  const query = {
    filters: { type: 'pass', team: 'home', player: 'J. Cole' },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
    timeFrom: 0,
    timeTo: 118,
  };
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: null,
      answerFocus: 'event-actor',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: { kind: 'queries', queries: [query] },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'ordered-event' &&
          f.selection.metric === 'passes' &&
          f.selection.subjectId === 'home-7',
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Current target and explicitly pending outcome.',
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: i ? 'receive' : 'pass',
          requestedSourceAttributes: null,
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Mensah/);
  assert.match(result.answer, /pending/);
  const source = executeMatchQuery({ kind: input.kind, seed: input.seed, time: input.time }, query),
    packet = { observedAt: 118, requestedEvidence: [source], queryResults: [source] },
    selection = result.canonicalFactSelection;
  assert.equal(canonicalPendingReception(0, result, packet, selection), true);
  for (const mutate of [
    (s) => s.proofs[0].event.revision++,
    (s) => (s.proofs[0].event.actionOutcome.status = 'completed'),
    (s) => (s.proofs[0].event.actionOutcome.status = 'unknown'),
    (s) => (s.proofs[0].event.eventId = 'comparison-duel-2041-pass-110'),
    (s) => (s.proofs[0].event.playerId = 'away-1'),
    (s) => (s.proofs[0].timeFrom = 100),
  ]) {
    const bad = structuredClone(selection);
    mutate(bad);
    assert.equal(canonicalPendingReception(0, result, packet, bad), false);
  }
  for (const value of [true, false, undefined]) {
    const bad = structuredClone(packet);
    bad.requestedEvidence[0].rows[0].result = value;
    assert.equal(canonicalPendingReception(0, result, bad, selection), false);
  }
  const stale = structuredClone(packet);
  stale.queryResults[0].rows.push({ ...source.rows[0], revision: 2 });
  assert.equal(canonicalPendingReception(0, result, stale, selection), false);
});

test('canonical inventory absence fulfills a retained identity field only through explicit reviewed prerequisite', async () => {
  const input = {
      kind: 'quiet',
      seed: 1007,
      time: 72,
      question: "Can you identify Northbridge's captain from the information available here?",
    },
    span = requestComponents(input.question)[0];
  for (const field of ['name', 'number']) {
    const demand = {
      requestSpan: span,
      source: 'roster',
      sourceField: field,
      actorRole: 'none',
      linkage: 'none',
    };
    const plan = {
      requestedSourceAttributes: [demand],
      answerFocus: 'other',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass', team: 'home' }, aggregate: 'list', order: 'asc', limit: 1 },
        ],
      },
    };
    const writer = {
      scope: 'match',
      composition: {
        mode: 'unavailable-roster-attribute',
        sourceField: 'captain',
        requestSpan: span,
      },
      followUp: '',
    };
    const dependency = {
      requestSpan: span,
      missingSourceField: 'captain',
      requiredForFields: [field],
      required: true,
      reason:
        'The requested identity is the holder of the captain role. That role is absent, so the known roster field cannot identify its holder.',
    };
    let captured;
    const review = (packet, body) => {
      captured = packet;
      const schema =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.properties
          .sourceInventoryDependency;
      assert.deepEqual(schema.anyOf[1].properties.requiredForFields.items.enum, [field]);
      assert.equal(packet.answer.sourceInventoryLimitation.sourceField, 'captain');
      return {
        decision: 'approve',
        requestCheck: {
          status: 'useful-limitation',
          requestedInformation: input.question,
          reason: 'Specific role prerequisite unavailable; no holder inferred.',
          coverage: [
            {
              requestSpan: span,
              claimIndices: [0],
              answerForm: 'unavailable-measurement',
              requestedAction: 'other',
              requestedSourceAttributes: null,
              sourceInventoryDependency: dependency,
            },
          ],
        },
      };
    };
    const mock = sequenceTransport([plan, writer, review]);
    const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 3);
    assert.match(result.answer, /captain information is not recorded/);
    assert.ok(
      result.sourceAttributeDependency.retainedSourceAttributes.some(
        (item) => item.sourceField === field,
      ),
    );
    assert.equal(result.sourceAttributeDependency.method, 'independent-model-prerequisite-review');
    const packet = {
      ...captured.evidence,
      question: input.question,
      requestedSourceAttributes: result.sourceAttributeDependency.retainedSourceAttributes,
    };
    const part = { requestSpan: span, claimIndices: [0], sourceInventoryDependency: dependency };
    assert.equal(inventoryDependencyCovers(part, result, packet, demand), true);
    for (const change of [
      null,
      { ...dependency, required: false },
      { ...dependency, requiredForFields: [] },
      { ...dependency, missingSourceField: 'unrelated' },
      { ...dependency, requestSpan: 'unrelated' },
      { ...dependency, reason: '' },
    ])
      assert.equal(
        inventoryDependencyCovers(
          { ...part, sourceInventoryDependency: change },
          result,
          packet,
          demand,
        ),
        false,
      );
    for (const change of [
      {
        ...packet,
        question: input.question.replace(/\?$/, '') + ', and what shirt number does Ali wear?',
      },
      { ...packet, roster: [{ id: 'home-1', captain: true }] },
      { ...packet, requestedSourceAttributes: [{ ...demand, source: 'event' }] },
    ])
      assert.equal(inventoryDependencyCovers(part, result, change, demand), false);
    const known = {
      ...result,
      sourceInventoryLimitation: { ...result.sourceInventoryLimitation, sourceField: 'number' },
    };
    assert.equal(
      inventoryDependencyCovers(
        { ...part, sourceInventoryDependency: { ...dependency, missingSourceField: 'number' } },
        known,
        packet,
        demand,
      ),
      false,
    );
    const denied = sequenceTransport([
      plan,
      writer,
      (packet, body) => {
        const response = review(packet, body);
        response.requestCheck.coverage[0].sourceInventoryDependency = null;
        return response;
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: denied.fetcher, canRepair: () => false }),
      /could not support/,
    );
  }
});

test('an unrelated missing roster field cannot override an available identity when independent review rejects the dependency', async () => {
  const input = {
      kind: 'duel',
      seed: 2041,
      time: 118,
      question: 'What shirt number does J. Cole wear?',
    },
    span = requestComponents(input.question)[0];
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: [
        {
          requestSpan: span,
          source: 'roster',
          sourceField: 'number',
          actorRole: 'none',
          linkage: 'none',
        },
      ],
      answerFocus: 'other',
      requestedForm: 'fact',
      mentionedPlayers: ['J. Cole'],
      decision: { kind: 'queries', queries: [] },
    },
    {
      scope: 'match',
      composition: {
        mode: 'unavailable-roster-attribute',
        sourceField: 'academyAffiliation',
        requestSpan: span,
      },
      followUp: '',
    },
    {
      decision: 'withhold',
      requestCheck: {
        status: 'not-answered',
        requestedInformation: input.question,
        reason: 'Academy affiliation is irrelevant to the explicitly named player jersey.',
        coverage: [
          {
            requestSpan: span,
            claimIndices: [],
            answerForm: 'fact',
            requestedAction: 'other',
            requestedSourceAttributes: null,
            sourceInventoryDependency: null,
          },
        ],
      },
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher, canRepair: () => false }),
    /could not support/,
  );
  assert.equal(mock.count(), 3);
});

test('component quantity schema requires typed counts but preserves genuine unavailable measurements', () => {
  const spans = ['How many collections did the keeper make', 'who took the shots'];
  const template = {
    type: 'object',
    properties: {
      requestSpan: { type: 'string', enum: spans },
      answerForm: { type: 'string', enum: ['fact', 'assessment', 'unavailable-measurement'] },
      requestedQuantity: {
        anyOf: [
          { type: 'null' },
          { type: 'array', items: requestedQuantitySchema(spans, [{ id: 'home-1' }]) },
        ],
      },
    },
    required: ['requestSpan', 'answerForm', 'requestedQuantity'],
  };
  const variants = componentQuantityCoverageSchema(template, spans).anyOf;
  const count = variants.find(
    (v) =>
      v.properties.requestSpan.enum[0] === spans[0] &&
      v.properties.answerForm.enum.includes('fact'),
  );
  assert.ok(!count.properties.requestedQuantity.anyOf.some((v) => v.type === 'null'));
  assert.ok(
    variants
      .find(
        (v) =>
          v.properties.answerForm.enum.length === 1 &&
          v.properties.answerForm.enum[0] === 'unavailable-measurement',
      )
      .properties.requestedQuantity.anyOf.some((v) => v.type === 'null'),
  );
  assert.ok(
    variants
      .find((v) => v.properties.requestSpan.enum[0] === spans[1])
      .properties.requestedQuantity.anyOf.some((v) => v.type === 'null'),
  );
  for (const v of variants)
    for (const q of v.properties.requestedQuantity.anyOf)
      if (q.type === 'array')
        for (const branch of q.items.anyOf)
          assert.deepEqual(branch.properties.requestSpan.enum, v.properties.requestSpan.enum);
  assert.equal(template.properties.requestedQuantity.anyOf.length, 2, 'input template unchanged');
});

test('actual X keeper sequence with a compliant repair requires a typed collection count in final review', async () => {
  const trace = {
    input: {
      kind: 'counter',
      seed: 2063,
      time: 90,
      language: 'en',
      question:
        'At 01:30, how many saved shots has I. Kerr collected for Northbridge so far, and who took those shots? Is that enough evidence to call his saves difficult?',
    },
    calls: [
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestedSourceAttributes\\":null,\\"answerFocus\\":\\"player-performance\\",\\"explanationTarget\\":\\"other\\",\\"requestedForm\\":\\"assessment\\",\\"mentionedPlayers\\":[\\"I. Kerr\\"],\\"decision\\":{\\"kind\\":\\"queries\\",\\"queries\\":[{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":\\"home-1\\",\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"saved\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"asc\\",\\"limit\\":1,\\"aggregate\\":\\"count\\",\\"timeFrom\\":0,\\"timeTo\\":90,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null},{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"saved\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"asc\\",\\"limit\\":10,\\"aggregate\\":\\"list\\",\\"timeFrom\\":0,\\"timeTo\\":90,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null},{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":\\"home-1\\",\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"saved\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":\\"goalkeeper-hold\\",\\"recoveryClass\\":null,\\"linkedShotOutcome\\":\\"saved\\"},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"desc\\",\\"limit\\":1,\\"aggregate\\":\\"list\\",\\"timeFrom\\":0,\\"timeTo\\":90,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null}]}}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"I. Kerr has collected saved shots for Northbridge by 01:30.\\",\\"recordedAction\\":\\"I. Kerr has collected saved shots for Northbridge by 01:30.\\",\\"conclusion\\":\\"contradicted\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"explanation\\",\\"factIds\\":[\\"fact-778c8ee8084662d9\\",\\"fact-7a01d1c39a432eab\\",\\"fact-7c5a8af91a5d5d94\\"],\\"claim\\":{\\"text\\":\\"I. Kerr has collected 2 saved shots for Northbridge so far, both from D. Silva of Harbour Athletic. However, the data shows I. Kerr has 0 shots saved credited to him, indicating no recorded saves by 01:30. Therefore, there is no evidence to assess the difficulty of his saves at this time.\\",\\"kind\\":\\"interpretation\\",\\"evidence\\":[\\n\\n],\\"dependsOn\\":[0,1,2]}},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"I. Kerr has collected saved shots for Northbridge by 01:30.\\",\\"recordedAction\\":\\"I. Kerr has collected saved shots for Northbridge by 01:30.\\",\\"conclusion\\":\\"supported\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"explanation\\",\\"factIds\\":[\\"fact-778c8ee8084662d9\\",\\"fact-73d2d522ddd474af\\",\\"fact-14f18ed163406aa3\\"],\\"claim\\":{\\"text\\":\\"I. Kerr has collected 2 saved shots for Northbridge so far, both shots taken by D. Silva of Harbour Athletic. These two saved shots are recorded at 00:26 and 01:26, with I. Kerr collecting the saves at 00:28 and 01:28 respectively. However, there is no direct evidence here to assess the difficulty of these saves.\\",\\"kind\\":\\"interpretation\\",\\"evidence\\":[],\\"dependsOn\\":[0,1,2]}},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestCheck\\":{\\"requestedInformation\\":\\"Number of saved shots collected by I. Kerr for Northbridge so far, identity of the shooters of those shots, and whether there is enough evidence to call his saves difficult.\\",\\"responseIntent\\":{\\"purpose\\":\\"assessment\\",\\"needsAssessment\\":true,\\"needsExplicitCorrection\\":false,\\"needsMeasurementLimitation\\":true,\\"reason\\":\\"The user wants to know the count of saved shots collected by I. Kerr, who took those shots, and an assessment of the difficulty of those saves.\\"},\\"status\\":\\"answered\\",\\"coverage\\":[{\\"requestSpan\\":\\"how many saved shots has I. Kerr collected for Northbridge so far\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"other\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"who took those shots\\",\\"claimIndices\\":[1,2],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"shot\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"Is that enough evidence to call his saves difficult\\",\\"claimIndices\\":[3],\\"answerForm\\":\\"assessment\\",\\"requestedAction\\":\\"other\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null}],\\"reason\\":\\"The answer provides the exact count of saved shots collected by I. Kerr, identifies the shooter for those shots, and clearly states the lack of evidence to assess the difficulty of the saves, fulfilling all parts of the question.\\"},\\"checks\\":[{\\"claimIndex\\":0,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[],\\"reason\\":\\"Claim 0 is supported by the saved collections scope query showing I. Kerr collected 2 saved shots.\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[\\"bucket-count\\"]},{\\"claimIndex\\":1,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[],\\"reason\\":\\"Claim 1 is supported by the linked recovery and shot events showing I. Kerr collected a saved shot by D. Silva at 01:28 (shot at 01:26).\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[\\"bucket-count\\"]},{\\"claimIndex\\":2,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[],\\"reason\\":\\"Claim 2 is supported by the linked recovery and shot events showing I. Kerr collected a saved shot by D. Silva at 00:28 (shot at 00:26).\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[\\"bucket-count\\"]},{\\"claimIndex\\":3,\\"actors\\":[{\\"name\\":\\"I. Kerr\\",\\"action\\":\\"other\\",\\"individualAction\\":true}],\\"inventedFacts\\":[],\\"counts\\":[],\\"reason\\":\\"Claim 3 correctly states there is no direct evidence to assess the difficulty of the saves, supported by the available event and scope data.\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[]}],\\"reason\\":\\"All claims are supported by the provided evidence and correctly address the question components.\\",\\"decision\\":\\"approve\\",\\"numericBindingMode\\":\\"assertion-index-v1\\"}"}}]}',
      },
    ],
  };
  const responses = trace.calls.map((c) =>
    JSON.parse(JSON.parse(c.response).choices[0].message.content),
  );
  const review = responses.pop();
  // This is a labelled offline repair retune, not a changed historical trace.
  // Repeated quantitative prose now stays intact for numeric verification.
  responses.at(-1).composition.claim.text =
    "I. Kerr's save difficulty cannot be established from the recorded actions.";
  const mock = sequenceTransport([
    ...responses,
    (packet, body) => {
      const variants =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
      const span = review.requestCheck.coverage[0].requestSpan;
      const owner = variants.find(
        (v) =>
          v.properties.requestSpan.enum[0] === span &&
          v.properties.answerForm.enum.includes('fact'),
      );
      assert.ok(owner);
      assert.ok(owner.properties.requestedQuantity.anyOf.every((v) => v.type !== 'null'));
      review.requestCheck.coverage[0].requestedQuantity = [
        {
          requestSpan: span,
          action: 'recovery',
          state: 'any',
          grouping: 'named-entity',
          subjectIds: ['home-1'],
          timeFrom: 0,
          timeTo: 90,
          timeFromExclusive: false,
          timeToExclusive: false,
          qualifiers: {
            bodyPart: null,
            passType: null,
            technique: null,
            recoveryKind: 'goalkeeper-hold',
            linkedShotOutcome: 'saved',
          },
        },
      ];
      return review;
    },
  ]);
  const result = await answerMatchQuestionAI(trace.input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(mock.count(), 4);
  assert.equal(result.execution.modelCalls, 4);
  assert.match(result.answer, /2/);
  assert.match(result.answer, /Silva/);
  assert.match(result.answer, /difficulty/);
});

test('actual X mixed blocked-count path can select the trusted definition instead of inventing numeric prose', async () => {
  const trace = {
    input: {
      kind: 'sustained',
      seed: 2063,
      time: 108,
      language: 'en',
      question:
        'At 01:48, should Northbridge’s blocked shots count as shots on target in this feed? Tell me how many blocked shots they have and how many shots on target they actually have so far, and explain the distinction.',
    },
    calls: [
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestedSourceAttributes\\":null,\\"answerFocus\\":\\"other\\",\\"explanationTarget\\":\\"statistic-definition\\",\\"requestedForm\\":\\"explanation\\",\\"mentionedPlayers\\":[],\\"decision\\":{\\"kind\\":\\"queries\\",\\"queries\\":[{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"blocked\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"asc\\",\\"limit\\":1,\\"aggregate\\":\\"count\\",\\"timeFrom\\":0,\\"timeTo\\":108,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null},{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"on-target\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"asc\\",\\"limit\\":1,\\"aggregate\\":\\"count\\",\\"timeFrom\\":0,\\"timeTo\\":108,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null}]}}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestedSourceAttributes\\":null,\\"answerFocus\\":\\"other\\",\\"explanationTarget\\":\\"other\\",\\"requestedForm\\":\\"fact\\",\\"mentionedPlayers\\":[],\\"decision\\":{\\"kind\\":\\"queries\\",\\"queries\\":[{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"blocked\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"desc\\",\\"limit\\":1,\\"aggregate\\":\\"count\\",\\"timeFrom\\":0,\\"timeTo\\":108,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null},{\\"filters\\":{\\"id\\":null,\\"type\\":\\"shot\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":null,\\"outcome\\":\\"on-target\\",\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"desc\\",\\"limit\\":1,\\"aggregate\\":\\"count\\",\\"timeFrom\\":0,\\"timeTo\\":108,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null}]}}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"Northbridge\\u2019s blocked shots might count as shots on target in this feed\\",\\"recordedAction\\":\\"Northbridge has 2 blocked shots and 1 shot on target\\",\\"conclusion\\":\\"contradicted\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"facts\\",\\"factIds\\":[\\"fact-1a4b85334b1a93b7\\",\\"fact-d6989e10182530b3\\",\\"fact-cdca404463685de5\\"]},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"Northbridge\\u2019s blocked shots might count as shots on target in this feed\\",\\"recordedAction\\":\\"Northbridge has 2 blocked shots and 1 shot on target\\",\\"conclusion\\":\\"contradicted\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"explanation\\",\\"factIds\\":[\\"fact-1a4b85334b1a93b7\\",\\"fact-d6989e10182530b3\\"],\\"claim\\":{\\"text\\":\\"In this feed, Northbridge\'s blocked shots do not count as shots on target. They have 2 blocked shots and 1 shot on target. The distinction is that blocked shots are attempts stopped by defenders before reaching the goal, so they are not counted as shots on target, which are shots that would have gone into the goal if not saved by the goalkeeper or hitting the frame.\\",\\"kind\\":\\"interpretation\\",\\"evidence\\":[\\n \\t\\t\\t\\n \\t],\\"dependsOn\\":[0,1]}},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestCheck\\":{\\"requestedInformation\\":\\"Should Northbridge\'s blocked shots count as shots on target in this feed? How many blocked shots do they have? How many shots on target do they have so far? Explain the distinction between blocked shots and shots on target.\\",\\"responseIntent\\":{\\"purpose\\":\\"mixed\\",\\"needsAssessment\\":false,\\"needsExplicitCorrection\\":false,\\"needsMeasurementLimitation\\":false,\\"reason\\":\\"The user wants factual counts of blocked shots and shots on target for Northbridge, and an explanation of whether blocked shots count as shots on target in this feed and the difference between these categories.\\"},\\"status\\":\\"answered\\",\\"coverage\\":[{\\"requestSpan\\":\\"should Northbridge\\u2019s blocked shots count as shots on target in this feed\\",\\"claimIndices\\":[2],\\"answerForm\\":\\"explanation\\",\\"requestedAction\\":\\"shot\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"Tell me how many blocked shots they have\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"shot\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":[{\\"requestSpan\\":\\"Tell me how many blocked shots they have\\",\\"action\\":\\"shot\\",\\"state\\":\\"blocked\\",\\"grouping\\":\\"by-team\\",\\"subjectIds\\":[\\"home\\"],\\"timeFrom\\":0,\\"timeTo\\":108,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"qualifiers\\":null}],\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"how many shots on target they actually have so far, and explain the distinction\\",\\"claimIndices\\":[1,2],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"shot\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":[{\\"requestSpan\\":\\"how many shots on target they actually have so far, and explain the distinction\\",\\"action\\":\\"shot\\",\\"state\\":\\"on-target\\",\\"grouping\\":\\"by-team\\",\\"subjectIds\\":[\\"home\\"],\\"timeFrom\\":0,\\"timeTo\\":108,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"qualifiers\\":null}],\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null}],\\"reason\\":\\"The answer provides the exact counts of blocked shots (2) and shots on target (1) for Northbridge, clarifies that blocked shots do not count as shots on target in this feed, and explains the distinction between these two shot outcome categories clearly and accurately.\\"},\\"checks\\":[{\\"claimIndex\\":0,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[\\n \\t\\t\\t\\n \\t\\t] ,\\"reason\\":\\"Claim 0 is supported by the scope query counting blocked shots for Northbridge (home team).\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[\\"bucket-count\\"]},{\\"claimIndex\\":1,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[\\n \\t] ,\\"reason\\":\\"Claim 1 is supported by the scope query counting shots on target for Northbridge (home team).\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[\\"bucket-count\\"]},{\\"claimIndex\\":2,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[{\\"assertionIndex\\":0,\\"scopeReference\\":{\\"type\\":\\"scope\\",\\"id\\":\\"scope-shots-on-target-count-home-full-21\\",\\"revision\\":1},\\"groupKey\\":null}],\\"reason\\":\\"Claim 2 is an interpretation supported by the counts of blocked shots and shots on target, explaining the distinction and confirming that blocked shots do not count as shots on target in this feed.\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[]}],\\"reason\\":\\"The answer fully addresses the user\'s question with supported facts and a clear explanation of the distinction between blocked shots and shots on target, including the counting rules in this feed.\\" ,\\"decision\\":\\"approve\\",\\"numericBindingMode\\":\\"assertion-index-v1\\"}"}}]}',
      },
    ],
  };
  const original = trace.calls.map((c) =>
    JSON.parse(JSON.parse(c.response).choices[0].message.content),
  );
  const mock = sequenceTransport([
    original[0],
    original[1],
    (packet) => {
      const facts = packet.matchFacts.facts;
      const selected = ['blockedShots', 'shotsOnTarget'].map((metric) =>
        facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === metric &&
            f.selection.subjectId === 'home',
        ),
      );
      selected.push(facts.find((f) => f.selection.kind === 'shot-outcome-definition'));
      assert.ok(selected.every(Boolean));
      return { ...original[2], composition: { mode: 'facts', factIds: selected.map((f) => f.id) } };
    },
    (packet, body) => {
      const r = structuredClone(original[4]);
      r.checks = r.checks.map((c) => ({ ...c, counts: [] }));
      const variants =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
      for (const part of r.requestCheck.coverage) {
        const v = variants.find(
          (v) =>
            v.properties.requestSpan.enum[0] === part.requestSpan &&
            v.properties.answerForm.enum.includes(part.answerForm),
        );
        assert.ok(v);
        if (part.requestedQuantity)
          assert.ok(v.properties.requestedQuantity.anyOf.every((q) => q.type !== 'null'));
      }
      return r;
    },
  ]);
  const result = await answerMatchQuestionAI(trace.input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.planningRepairs, 1);
  assert.ok(result.canonicalFactSelection.proofs.some((p) => p.kind === 'shot-outcome-definition'));
  assert.match(result.answer, /2 shots blocked/);
  assert.match(result.answer, /1 shot on target/);
  assert.doesNotMatch(result.answer, /hitting the frame|stopped by defenders/);
  assert.ok(result.claimProvenance.every((p) => p.modelGenerated === false));
});

test('actual X tie question forbids a quantity span copied from the other component', () => {
  const trace = {
    input: {
      kind: 'quiet',
      seed: 2063,
      time: 42,
      language: 'en',
      question:
        "Who's leading Northbridge for completed passes right now, and how many have they made?",
    },
    calls: [
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestedSourceAttributes\\":null,\\"answerFocus\\":\\"player-performance\\",\\"explanationTarget\\":\\"none\\",\\"requestedForm\\":\\"fact\\",\\"mentionedPlayers\\":[],\\"decision\\":{\\"kind\\":\\"queries\\",\\"queries\\":[{\\"filters\\":{\\"id\\":null,\\"type\\":\\"pass\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":true,\\"outcome\\":null,\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":\\"count-desc\\",\\"order\\":\\"desc\\",\\"limit\\":1,\\"aggregate\\":\\"by-player\\",\\"timeFrom\\":0,\\"timeTo\\":42,\\"timeFromExclusive\\":false,\\"timeToExclusive\\":false,\\"relativeTo\\":null}]}}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"There is a leading player for Northbridge in completed passes at the current time.\\",\\"recordedAction\\":\\"completed passes by Northbridge players\\",\\"conclusion\\":\\"supported\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"facts\\",\\"factIds\\":[\\"fact-911b1fac98db22d9\\"]},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestCheck\\":{\\"requestedInformation\\":\\"Who is leading Northbridge for completed passes right now, and how many have they made?\\",\\"responseIntent\\":{\\"purpose\\":\\"fact-retrieval\\",\\"needsAssessment\\":false,\\"needsExplicitCorrection\\":false,\\"needsMeasurementLimitation\\":false,\\"reason\\":\\"The user wants to know the current leader in completed passes for Northbridge and the number of passes completed by that player.\\"},\\"status\\":\\"answered\\",\\"coverage\\":[{\\"requestSpan\\":\\"Who\'s leading Northbridge for completed passes right now\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"pass\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"how many have they made\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"pass\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":[{\\"requestSpan\\":\\"Who\'s leading Northbridge for completed passes right now\\",\\"action\\":\\"pass\\",\\"state\\":\\"completed\\",\\"grouping\\":\\"by-player\\",\\"subjectIds\\":[\\"home-6\\"],\\"timeFrom\\":0,\\"timeTo\\":42,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"qualifiers\\":null}],\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null}],\\"reason\\":\\"The answer identifies the player leading Northbridge in completed passes and the exact number of passes completed, fulfilling the user\'s request.\\"},\\"checks\\":[{\\"claimIndex\\":0,\\"actors\\":[\\n] ,\\"inventedFacts\\":[],\\"counts\\":[\\n  ] ,\\"reason\\":\\"The claim is supported by the query result showing E. Costa with 1 completed pass for Northbridge within the observed time frame.\\" ,\\"supported\\":true,\\"shotOutcomeAssertions\\":[] }],\\"reason\\":\\"The answer correctly identifies E. Costa as the leader in completed passes for Northbridge with 1 completed pass, based on the recorded data up to 42 seconds into the match.\\",\\"decision\\":\\"approve\\",\\"numericBindingMode\\":\\"assertion-index-v1\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"There is a leading player for Northbridge in completed passes at the current time.\\",\\"recordedAction\\":\\"completed passes by Northbridge players\\",\\"conclusion\\":\\"supported\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"facts\\",\\"factIds\\":[\\"fact-911b1fac98db22d9\\"]},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestCheck\\":{\\"requestedInformation\\":\\"Who is leading Northbridge for completed passes right now, and how many have they made?\\",\\"responseIntent\\":{\\"purpose\\":\\"fact-retrieval\\",\\"needsAssessment\\":false,\\"needsExplicitCorrection\\":false,\\"needsMeasurementLimitation\\":false,\\"reason\\":\\"The user wants to know the current leader in completed passes for Northbridge and the number of passes completed by that player.\\"},\\"status\\":\\"answered\\",\\"coverage\\":[{\\"requestSpan\\":\\"Who\'s leading Northbridge for completed passes right now\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"pass\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"how many have they made\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"pass\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":[{\\"requestSpan\\":\\"Who\'s leading Northbridge for completed passes right now\\",\\"action\\":\\"pass\\",\\"state\\":\\"completed\\",\\"grouping\\":\\"by-player\\",\\"subjectIds\\":[\\"home-6\\"],\\"timeFrom\\":0,\\"timeTo\\":42,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"qualifiers\\":null}],\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null}],\\"reason\\":\\"The answer identifies the player leading Northbridge in completed passes and the exact number of passes completed, fulfilling the user\'s request.\\"},\\"checks\\":[{\\"claimIndex\\":0,\\"actors\\":[\\n] ,\\"inventedFacts\\":[],\\"counts\\":[\\n \\t\\t\\t\\n\\t\\t],\\"reason\\":\\"The claim is supported by the query result showing E. Costa with 1 completed pass for Northbridge within the observed time frame.\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[]}],\\"reason\\":\\"The answer correctly identifies E. Costa as the current leader for completed passes for Northbridge with 1 completed pass, based on the available data.\\",\\"decision\\":\\"approve\\",\\"numericBindingMode\\":\\"assertion-index-v1\\"}"}}]}',
      },
    ],
  };
  const review = JSON.parse(JSON.parse(trace.calls.at(-1).response).choices[0].message.content),
    parts = requestComponents(trace.input.question),
    wrong = review.requestCheck.coverage[1].requestedQuantity[0];
  assert.equal(wrong.requestSpan, parts[0]);
  const template = {
    properties: {
      requestSpan: { enum: parts },
      answerForm: { enum: ['fact', 'unavailable-measurement'] },
      requestedQuantity: {
        anyOf: [
          { type: 'null' },
          { type: 'array', items: requestedQuantitySchema(parts, [{ id: 'home-6' }]) },
        ],
      },
    },
  };
  const owner = componentQuantityCoverageSchema(template, parts).anyOf.find(
    (v) =>
      v.properties.requestSpan.enum[0] === parts[1] &&
      v.properties.answerForm.enum.includes('fact'),
  );
  for (const q of owner.properties.requestedQuantity.anyOf[0].items.anyOf)
    assert.deepEqual(q.properties.requestSpan.enum, [parts[1]]);
  assert.ok(
    requestedQuantityIssues(
      review.requestCheck.coverage[1],
      { claims: [] },
      { question: trace.input.question },
      { proofs: [] },
    ).length,
  );
});
test('actual X possession operation recovery can retain known count without invented numeric extras', async () => {
  const trace = {
    input: {
      kind: 'interrupted',
      seed: 2063,
      time: 90,
      language: 'en',
      question:
        "Do we know Northbridge's possession percentage yet, and how many passes have they completed?",
    },
    calls: [
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestedSourceAttributes\\":null,\\"answerFocus\\":\\"team-assessment\\",\\"explanationTarget\\":\\"other\\",\\"requestedForm\\":\\"fact\\",\\"mentionedPlayers\\":[],\\"decision\\":{\\"kind\\":\\"operation\\",\\"plan\\":{\\"version\\":1,\\"obligations\\":[{\\"id\\":\\"passCompletionRate-home\\",\\"requestSpan\\":\\"Do we know Northbridge\'s possession percentage yet\\",\\"operator\\":\\"ratio\\",\\"metric\\":\\"passCompletionRate\\",\\"subjects\\":[\\"home\\"],\\"timeFrom\\":0,\\"timeTo\\":90}]} } }"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestCheck\\":{\\"requestedInformation\\":\\"Do we know Northbridge\'s possession percentage yet, and how many passes have they completed?\\",\\"status\\":\\"answered\\",\\"coverage\\":[{\\"requestSpan\\":\\"Do we know Northbridge\'s possession percentage yet\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"other\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":null,\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null},{\\"requestSpan\\":\\"how many passes have they completed\\",\\"claimIndices\\":[0],\\"answerForm\\":\\"fact\\",\\"requestedAction\\":\\"pass\\",\\"temporalRelation\\":\\"none\\",\\"relationAnchorClaimIndex\\":null,\\"relationEntityBinding\\":\\"none\\",\\"relationSourceLinkIndex\\":null,\\"requestedQuantity\\":[{\\"requestSpan\\":\\"how many passes have they completed\\",\\"action\\":\\"pass\\",\\"state\\":\\"completed\\",\\"grouping\\":\\"by-team\\",\\"subjectIds\\":[\\"home\\"],\\"timeFrom\\":0,\\"timeTo\\":90,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"qualifiers\\":null}],\\"requestedSourceAttributes\\":null,\\"sourceInventoryDependency\\":null}],\\"reason\\":\\"Both possession percentage and completed passes for Northbridge are explicitly answered with supporting evidence.\\"},\\"checks\\":[{\\"claimIndex\\":0,\\"actors\\":[],\\"inventedFacts\\":[],\\"counts\\":[\\n\\n] ,\\"reason\\":\\"Claim 0 correctly reports 8 completed passes for Northbridge with 100% completion rate, supported by cited scopes.\\",\\"supported\\":true,\\"shotOutcomeAssertions\\":[]}],\\"reason\\":\\"The answer fully covers the requested possession percentage and completed passes for Northbridge with correct evidence and no invented facts.\\",\\"decision\\":\\"approve\\",\\"numericBindingMode\\":\\"assertion-index-v1\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"requestedSourceAttributes\\":null,\\"answerFocus\\":\\"team-assessment\\",\\"explanationTarget\\":\\"other\\",\\"requestedForm\\":\\"fact\\",\\"mentionedPlayers\\":[],\\"decision\\":{\\"kind\\":\\"queries\\",\\"queries\\":[{\\"filters\\":{\\"id\\":null,\\"type\\":\\"pass\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":true,\\"outcome\\":null,\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"asc\\",\\"limit\\":20,\\"aggregate\\":\\"count\\",\\"timeFrom\\":0,\\"timeTo\\":90,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"relativeTo\\":null},{\\"filters\\":{\\"id\\":null,\\"type\\":\\"pass\\",\\"team\\":\\"home\\",\\"player\\":null,\\"receiver\\":null,\\"assistPlayer\\":null,\\"result\\":true,\\"outcome\\":null,\\"bodyPart\\":null,\\"passType\\":null,\\"technique\\":null,\\"recoveryKind\\":null,\\"recoveryClass\\":null,\\"linkedShotOutcome\\":null},\\"groupCount\\":null,\\"groupOrder\\":null,\\"order\\":\\"asc\\",\\"limit\\":1,\\"aggregate\\":\\"list\\",\\"timeFrom\\":0,\\"timeTo\\":90,\\"timeFromExclusive\\":null,\\"timeToExclusive\\":null,\\"relativeTo\\":null}]}}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"We have recorded data on Northbridge\'s possession percentage and completed passes.\\",\\"recordedAction\\":\\"pass completion counts and pass attempts for Northbridge\\",\\"conclusion\\":\\"contradicted\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"facts\\",\\"factIds\\":[\\"fact-e4de87b420216aaf\\",\\"fact-f952ffc6af769341\\",\\"fact-940cfc6488d65fd6\\"]},\\"followUp\\":\\"\\"}"}}]}',
      },
      {
        response:
          '{"choices": [{"message": {"content": "{\\"premiseCheck\\":{\\"questionAssumption\\":\\"We have recorded data on Northbridge\'s possession percentage.\\",\\"recordedAction\\":\\"pass completion counts and pass attempts for Northbridge\\",\\"conclusion\\":\\"contradicted\\"},\\"scope\\":\\"match\\",\\"composition\\":{\\"mode\\":\\"explanation\\",\\"factIds\\":[\\"fact-e4de87b420216aaf\\",\\"fact-f952ffc6af769341\\",\\"fact-940cfc6488d65fd6\\"],\\"claim\\":{\\"text\\":\\"We do not have recorded data on Northbridge\'s possession percentage yet. However, Northbridge has completed 8 passes out of 8 attempts with no unsuccessful or pending passes.\\",\\"kind\\":\\"interpretation\\",\\"evidence\\":[\\n \\t\\t\\t\\n \\t],\\"dependsOn\\":[0,1,2]}},\\"followUp\\":\\"\\"}"}}]}',
      },
    ],
  };
  const original = trace.calls.map((c) =>
    JSON.parse(JSON.parse(c.response).choices[0].message.content),
  );
  const choose = (packet, explain) => {
    packet = packet.evidence || packet;
    const fact = packet.matchFacts.facts.find(
      (f) =>
        f.selection.kind === 'count' &&
        f.selection.metric === 'completedPasses' &&
        f.selection.subjectId === 'home',
    );
    assert.ok(fact);
    return {
      scope: 'match',
      composition: {
        mode: 'facts',
        factIds: explain
          ? [
              fact.id,
              packet.matchFacts.facts.find(
                (f) => f.selection.kind === 'source-measurement-limitation',
              ).id,
            ]
          : [fact.id],
      },
      followUp: '',
    };
  };
  const mock = sequenceTransport([
    original[0],
    original[2],
    (packet) => choose(packet, false),
    (packet) => choose(packet, true),
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: trace.input.question,
        reason: 'Known total and unavailable possession are distinct.',
        responseIntent: {
          purpose: 'mixed',
          needsAssessment: false,
          needsExplicitCorrection: false,
          needsMeasurementLimitation: true,
          reason: 'The percentage is unavailable.',
        },
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: [i ? 0 : 1],
          answerForm: i ? 'fact' : 'unavailable-measurement',
          requestedAction: i ? 'pass' : 'other',
          requestedQuantity: i
            ? [
                {
                  requestSpan,
                  action: 'pass',
                  state: 'completed',
                  grouping: 'by-team',
                  subjectIds: ['home'],
                  timeFrom: 0,
                  timeTo: 90,
                  qualifiers: null,
                },
              ]
            : null,
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(trace.input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 5);
  assert.match(result.answer, /8 completed passes/);
  assert.match(result.answer, /does not establish possession percentage/);
  assert.doesNotMatch(result.answer, /8 attempts|100%/);
});

test('ranking counterpart requires explicit top-one grouping and preserves exact executed filters and bounds', () => {
  const input = { kind: 'quiet', seed: 2063, time: 42 },
    query = {
      filters: { type: 'pass', team: 'home', result: true },
      aggregate: 'by-player',
      groupOrder: 'count-desc',
      limit: 1,
      timeFrom: 0,
      timeTo: 42,
      timeToExclusive: true,
    };
  const limited = executeMatchQuery(input, query);
  let executed;
  const [full] = requestedPlayerRankings(
    [query],
    (q) => {
      executed = q;
      return executeMatchQuery(input, q);
    },
    [limited],
  );
  assert.equal(executed.limit, 20);
  assert.deepEqual(executed.filters, limited.query.filters);
  assert.equal(executed.timeToExclusive, true);
  assert.equal(full.truncated, false);
  const defaultOrdered = { ...query, groupOrder: undefined };
  const canonicalDefault = executeMatchQuery(input, defaultOrdered);
  assert.equal(canonicalDefault.query.groupOrder, 'count-desc');
  assert.equal(
    requestedPlayerRankings([defaultOrdered], (q) => executeMatchQuery(input, q), [
      canonicalDefault,
    ])[0].truncated,
    false,
    'Only the executed canonical default, not an assumed planner order, licenses complete ranking augmentation',
  );
  const nameOrdered = { ...query, groupOrder: 'name' };
  assert.deepEqual(
    requestedPlayerRankings([nameOrdered], () => assert.fail('Name order is not a ranking'), [
      executeMatchQuery(input, nameOrdered),
    ]),
    [],
  );
  for (const changes of [
    { groupOrder: undefined },
    { limit: 3 },
    { groupCount: { min: 1 } },
    { filters: { ...query.filters, player: 'home-6' } },
    { filters: { ...query.filters, receiver: 'home-7' } },
    { filters: { ...query.filters, assistPlayer: 'home-7' } },
  ])
    assert.deepEqual(
      requestedPlayerRankings([{ ...query, ...changes }], () =>
        assert.fail('Ordinary inventory/restricted participant is not ranking augmentation'),
      ),
      [],
    );
});
test('actual frozen top-one completed-pass query answers with all three source-proved joint leaders', async () => {
  const input = {
    kind: 'quiet',
    seed: 2063,
    time: 42,
    question:
      "Who's leading Northbridge for completed passes right now, and how many have they made?",
  };
  let finalPacket;
  const plan = {
    answerFocus: 'event-actor',
    explanationTarget: 'none',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', team: 'home', result: true },
          aggregate: 'by-player',
          groupOrder: 'count-desc',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 42,
          timeFromExclusive: false,
          timeToExclusive: false,
        },
      ],
    },
  };
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      const facts = packet.matchFacts.facts.filter(
        (f) => f.selection.kind === 'player-count-ranking' && f.selection.filters?.team === 'home',
      );
      assert.equal(facts.length, 1);
      const schema = resolvedWireSchema(body).properties.composition.anyOf[0];
      assert.equal(schema.properties.factIds.minItems, 1);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [facts[0].id] },
        followUp: '',
      };
    },
    (packet) => {
      finalPacket = packet;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'All tied leaders and counts are stated.',
          coverage: packet.requestComponents.map((requestSpan, i) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
            requestedQuantity: i
              ? [
                  {
                    requestSpan,
                    action: 'pass',
                    state: 'completed',
                    grouping: 'by-player',
                    subjectIds: ['home-6', 'home-7', 'home-8'],
                    timeFrom: 0,
                    timeTo: 42,
                    qualifiers: null,
                  },
                ]
              : null,
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  for (const name of ['Costa', 'Cole', 'Mensah']) assert.match(answer.answer, new RegExp(name));
  const proof = answer.canonicalFactSelection.proofs[0];
  assert.equal(proof.leaders.length, 3);
  assert.ok(proof.leaders.every((l) => l.count === 1));
  assert.equal(proof.matchedGroupCount, proof.groups.length);
  assert.equal(proof.groups.length, 3);
  const part = {
    requestSpan: requestComponents(input.question)[1],
    claimIndices: [0],
    answerForm: 'fact',
    requestedQuantity: [
      {
        requestSpan: requestComponents(input.question)[1],
        action: 'pass',
        state: 'completed',
        grouping: 'by-player',
        subjectIds: proof.leaders.map((l) => l.id),
        timeFrom: 0,
        timeTo: 42,
        qualifiers: null,
      },
    ],
  };
  assert.deepEqual(
    requestedQuantityIssues(
      part,
      finalPacket.answer,
      finalPacket.evidence,
      finalPacket.canonicalFactSelection,
    ),
    [],
  );
  for (const change of [
    { state: 'pending' },
    { timeTo: 41 },
    { qualifiers: { passType: 'cross' } },
    { subjectIds: ['away-6'] },
  ])
    assert.ok(
      requestedQuantityIssues(
        { ...part, requestedQuantity: [{ ...part.requestedQuantity[0], ...change }] },
        finalPacket.answer,
        finalPacket.evidence,
        finalPacket.canonicalFactSelection,
      ).length,
    );
});

test('a single tied player count cannot bypass the required complete ranking fact', async () => {
  const input = {
    kind: 'quiet',
    seed: 2063,
    time: 42,
    question:
      "Who's leading Northbridge for completed passes right now, and how many have they made?",
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', team: 'home', result: true },
            aggregate: 'by-player',
            groupOrder: 'count-desc',
            limit: 1,
            timeFrom: 0,
            timeTo: 42,
          },
        ],
      },
    },
    (packet) => {
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === 'home-6',
      );
      assert.ok(fact);
      return { scope: 'match', composition: { mode: 'facts', factIds: [fact.id] }, followUp: '' };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    (error) =>
      error.code === 'question-invalid-fact-selection' && /joint leader/.test(error.message),
  );
  assert.equal(mock.count(), 2);
});

test('actual Z possession proxy is rejected at planning and cannot satisfy independent component coverage', async () => {
  const input = {
    kind: 'interrupted',
    seed: 2063,
    time: 90,
    question:
      "Do we know Northbridge's possession percentage yet, and how many passes have they completed?",
  };
  let reviewed;
  const plan = {
    answerFocus: 'player-performance',
    explanationTarget: 'other',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', team: 'home', result: true },
          aggregate: 'count',
          timeFrom: 0,
          timeTo: 90,
        },
      ],
    },
  };
  const mock = sequenceTransport([
    {
      ...plan,
      decision: {
        kind: 'operation',
        plan: {
          version: 1,
          obligations: [
            {
              id: 'wrong-proxy',
              requestSpan: requestComponents(input.question)[0],
              operator: 'ratio',
              metric: 'passCompletionRate',
              subjects: ['home'],
              timeFrom: 0,
              timeTo: 90,
            },
          ],
        },
      },
    },
    plan,
    (packet, body) => {
      assert.match(body.messages[0].content, /Mandatory original response obligations/);
      assert.ok(
        resolvedWireSchema(body).properties.composition.anyOf.every((mode) =>
          mode.properties.mode.enum.includes('facts'),
        ),
      );
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'completedPasses' &&
          f.selection.subjectId === 'home',
      );
      assert.ok(fact);
      return {
        scope: 'match',
        composition: {
          mode: 'facts',
          factIds: [
            fact.id,
            packet.matchFacts.facts.find(
              (f) => f.selection.kind === 'source-measurement-limitation',
            ).id,
          ],
        },
        followUp: '',
      };
    },
    (packet, body) => {
      reviewed = packet;
      const spans = packet.requestComponents;
      const variants =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
      assert.ok(
        variants
          .filter((v) => v.properties.requestSpan.enum[0] === spans[0])
          .every((v) => v.properties.answerForm.enum.join() === 'unavailable-measurement'),
      );
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Unknown requested share and known count are distinguished.',
          responseIntent: {
            purpose: 'mixed',
            needsAssessment: false,
            needsExplicitCorrection: false,
            needsMeasurementLimitation: true,
            reason: 'Possession is unmeasured.',
          },
          coverage: spans.map((requestSpan, i) => ({
            requestSpan,
            claimIndices: [i ? 0 : 1],
            answerForm: i ? 'fact' : 'unavailable-measurement',
            requestedAction: i ? 'pass' : 'other',
            requestedQuantity: i
              ? [
                  {
                    requestSpan,
                    action: 'pass',
                    state: 'completed',
                    grouping: 'by-team',
                    subjectIds: ['home'],
                    timeFrom: 0,
                    timeTo: 90,
                    qualifiers: null,
                  },
                ]
              : null,
          })),
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.match(result.answer, /8 completed passes/);
  assert.match(result.answer, /does not establish possession percentage/);
  assert.doesNotMatch(result.answer, /100%/);
  const bad = {
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      coverage: requestComponents(input.question).map((requestSpan) => ({
        requestSpan,
        claimIndices: [0],
        answerForm: 'fact',
        requestedAction: 'other',
        requestedQuantity: null,
      })),
    },
    checks: [{ claimIndex: 0, supported: true, actors: [], counts: [], shotOutcomeAssertions: [] }],
  };
  assert.ok(
    reviewRequestAdequacy(
      bad,
      { scope: 'match', claims: [reviewed.answer.claims[0]] },
      reviewed.evidence,
      reviewed.canonicalFactSelection,
    ).some((issue) => /not a substitute/.test(issue.reason)),
    'reviewer approval of closest proxy cannot erase the measurement',
  );
});

test('mixed known-count and unavailable-measurement replies preserve exact requested facts through repair', async () => {
  const cases = [
    {
      input: {
        kind: 'interrupted',
        seed: 2063,
        time: 90,
        question:
          "Do we know Northbridge's possession percentage yet, and how many passes have they completed?",
      },
      query: {
        filters: { type: 'pass', team: 'home', result: true },
        aggregate: 'count',
        timeFrom: 0,
        timeTo: 90,
      },
      metric: 'completedPasses',
      action: 'pass',
      state: 'completed',
      subject: 'home',
      from: 0,
      value: 8,
      unknown:
        'Possession percentage is not available in the recorded data. However, Northbridge have completed 8 passes so far in the match.',
      unknownIndex: 0,
    },
    {
      input: {
        kind: 'duel',
        seed: 2071,
        time: 108,
        question:
          'Since 00:30, how many shots has D. Silva taken, and what is his xG for that spell?',
      },
      query: {
        filters: { type: 'shot', player: 'D. Silva' },
        aggregate: 'list',
        limit: 10,
        timeFrom: 30,
        timeTo: 108,
      },
      metric: 'attempts',
      action: 'shot',
      state: 'any',
      subject: 'away-10',
      from: 30,
      value: 3,
      unknown:
        'His expected goals for this period are not available in the recorded data. D. Silva has taken 3 shots from 00:30 to 01:48.',
      unknownIndex: 1,
    },
  ];
  for (const c of cases.flatMap((c) => [c, { ...c, bad: true }])) {
    let captured;
    const mock = sequenceTransport([
      {
        answerFocus: 'other',
        explanationTarget: 'other',
        requestedForm: 'fact',
        mentionedPlayers: c.subject === 'away-10' ? ['D. Silva'] : [],
        decision: { kind: 'queries', queries: [c.query] },
      },
      () => ({
        scope: 'match',
        composition: {
          mode: 'limitation',
          factIds: [],
          claim: { text: c.unknown, kind: 'limitation', evidence: [], dependsOn: [] },
        },
        followUp: '',
      }),
      (packet, body) => {
        assert.match(packet.feedback.reason, /known.count|complete count|source measurement/);
        const schema = resolvedWireSchema(body).properties.composition.anyOf;
        assert.ok(schema.every((v) => v.properties.mode.enum[0] === 'facts'));
        const ids = schema[0].properties.factIds.items.enum;
        assert.equal(ids.length, 2);
        const fact = packet.evidence.matchFacts.facts.find((f) => f.id === ids[0]);
        assert.equal(fact.selection.metric, c.metric);
        assert.equal(fact.selection.subjectId, c.subject);
        assert.equal(fact.selection.timeFrom, c.from);
        return {
          premiseCheck: {
            questionAssumption: 'Requested measurement is available',
            recordedAction: 'Source count plus unavailable measurement',
            conclusion: 'contradicted',
          },
          scope: 'match',
          composition: { mode: 'facts', factIds: c.bad ? ids.slice(0, 1) : ids },
          followUp: '',
        };
      },
      (packet, body) => {
        captured = packet;
        const variants =
          resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
        const unavailableSpan = packet.requestComponents[c.unknownIndex],
          knownSpan = packet.requestComponents[1 - c.unknownIndex];
        assert.ok(
          variants
            .filter((v) => v.properties.requestSpan.enum[0] === unavailableSpan)
            .every(
              (v) =>
                v.properties.requestedQuantity.type === 'null' &&
                v.properties.answerForm.enum.join() === 'unavailable-measurement',
            ),
        );
        assert.ok(
          variants
            .filter((v) => v.properties.requestSpan.enum[0] === knownSpan)
            .every((v) => v.properties.requestedQuantity.type !== 'null'),
        );
        return {
          decision: 'approve',
          reason: 'Exact known count plus measurement limitation.',
          numericBindingMode: 'assertion-index-v1',
          checks: packet.answer.claims.map((_claim, claimIndex) => ({
            claimIndex,
            actors: [],
            inventedFacts: [],
            supported: true,
            reason: 'Exact source count.',
            shotOutcomeAssertions: [],
            counts: [],
          })),
          requestCheck: {
            status: 'answered',
            requestedInformation: c.input.question,
            reason: 'Known count and specifically unavailable measure both stated.',
            responseIntent: {
              purpose: 'mixed',
              needsAssessment: false,
              needsExplicitCorrection: false,
              needsMeasurementLimitation: true,
              reason: 'Specific measurement is unavailable.',
            },
            coverage: packet.requestComponents.map((requestSpan, i) => ({
              requestSpan,
              claimIndices: [i === c.unknownIndex ? 1 : 0],
              answerForm: i === c.unknownIndex ? 'unavailable-measurement' : 'fact',
              requestedAction: i === c.unknownIndex ? 'other' : c.action,
              requestedQuantity:
                i === c.unknownIndex
                  ? null
                  : [
                      {
                        requestSpan,
                        action: c.action,
                        state: c.state,
                        grouping: c.subject === 'home' ? 'by-team' : 'named-entity',
                        subjectIds: [c.subject],
                        timeFrom: c.from,
                        timeTo: c.input.time,
                        timeFromExclusive: false,
                        timeToExclusive: false,
                        qualifiers: null,
                      },
                    ],
            })),
          },
        };
      },
    ]);
    if (c.bad) {
      await assert.rejects(
        answerMatchQuestionAI(c.input, { config, fetcher: mock.fetcher, canRepair: () => true }),
        (error) => error.code === 'question-invalid-fact-selection',
      );
      continue;
    }
    const result = await answerMatchQuestionAI(c.input, {
      config,
      fetcher: mock.fetcher,
      canRepair: () => true,
    });
    assert.equal(result.execution.modelCalls, 4);
    assert.equal(result.canonicalFactSelection.proofs[0].value, c.value);
    assert.match(result.answer, /not (?:available|recorded|measured|establish)/);
    assert.equal(result.canonicalFactSelection.proofs[0].timeFrom, c.from);
    const manifest = buildQuestionFacts({ ...captured.evidence, requestedEvidence: [] });
    assert.deepEqual(
      mixedKnownQuantityFacts(manifest, { ...captured.evidence, requestedEvidence: [] }),
      [],
      'unrequested background scope cannot be forced as known answer',
    );
  }
});

test('actual AB ratio review rejects an invented total obligation without crashing and accepts exact pending proof', async () => {
  const input = {
    kind: 'counter',
    seed: 2063,
    time: 19,
    language: 'en',
    question:
      "At 00:19, what's Northbridge's pass completion percentage, and how many passes are still waiting for an outcome?",
  };
  const values = [
    {
      requestedSourceAttributes: null,
      answerFocus: 'team-assessment',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'operation',
        plan: {
          version: 1,
          obligations: [
            {
              id: 'passCompletionRate-home',
              requestSpan: "what's Northbridge's pass completion percentage",
              operator: 'ratio',
              metric: 'passCompletionRate',
              subjects: ['home'],
              timeFrom: 0,
              timeTo: 19,
            },
            {
              id: 'pendingPasses-home',
              requestSpan: 'how many passes are still waiting for an outcome',
              operator: 'ratio',
              metric: 'passCompletionRate',
              subjects: ['home'],
              timeFrom: 0,
              timeTo: 19,
            },
          ],
        },
      },
    },
    {
      requestCheck: {
        requestedInformation:
          "what's Northbridge's pass completion percentage; how many passes are still waiting for an outcome",
        status: 'answered',
        coverage: [
          {
            requestSpan: "what's Northbridge's pass completion percentage",
            claimIndices: [0, 1],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            relationSourceLinkIndex: null,
            requestedQuantity: [
              {
                requestSpan: "what's Northbridge's pass completion percentage",
                action: 'pass',
                state: 'any',
                grouping: 'by-team',
                subjectIds: ['home'],
                timeFrom: 0,
                timeTo: 19,
                timeFromExclusive: null,
                timeToExclusive: null,
                qualifiers: null,
              },
            ],
            requestedSourceAttributes: null,
            sourceInventoryDependency: null,
          },
          {
            requestSpan: 'how many passes are still waiting for an outcome',
            claimIndices: [0, 1],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'none',
            relationAnchorClaimIndex: null,
            relationEntityBinding: 'none',
            relationSourceLinkIndex: null,
            requestedQuantity: [
              {
                requestSpan: 'how many passes are still waiting for an outcome',
                action: 'pass',
                state: 'pending',
                grouping: 'by-team',
                subjectIds: ['home'],
                timeFrom: 0,
                timeTo: 19,
                timeFromExclusive: null,
                timeToExclusive: null,
                qualifiers: null,
              },
            ],
            requestedSourceAttributes: null,
            sourceInventoryDependency: null,
          },
        ],
        reason:
          'Both requested metrics are explicitly answered with correct scope, subject, and time window.',
      },
      checks: [
        {
          claimIndex: 0,
          actors: [],
          inventedFacts: [],
          counts: [],
          reason:
            "Claim 0 correctly reports Northbridge's pass completion percentage and pending passes within 0-19 seconds.",
          supported: true,
          shotOutcomeAssertions: [],
        },
        {
          claimIndex: 1,
          actors: [],
          inventedFacts: [],
          counts: [],
          reason:
            'Claim 1 duplicates claim 0 but is also correct and supported by the same evidence.',
          supported: true,
          shotOutcomeAssertions: [],
        },
      ],
      reason:
        "The answer fully satisfies the user's request for Northbridge's pass completion percentage and the count of passes still pending outcome within the specified time window.",
      decision: 'approve',
      numericBindingMode: 'assertion-index-v1',
    },
  ];
  const raw = sequenceTransport(values);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: raw.fetcher }),
    (error) => error.code === 'question-withheld',
  );
  const valid = structuredClone(values);
  valid[1].requestCheck.coverage[0].requestedQuantity = null;
  valid[1].requestCheck.coverage.forEach((part) => (part.claimIndices = [0]));
  valid[1].checks = valid[1].checks.slice(0, 1);
  const mock = sequenceTransport(valid, (_packet, index, body) => {
    if (index === 1) {
      const variants =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
      const spans = requestComponents(input.question);
      assert.ok(
        variants
          .filter((v) => v.properties.requestSpan.enum[0] === spans[0])
          .every((v) => v.properties.requestedQuantity.type === 'null'),
      );
      assert.ok(
        variants
          .filter((v) => v.properties.requestSpan.enum[0] === spans[1])
          .every((v) => v.properties.requestedQuantity.type !== 'null'),
      );
    }
  });
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 2);
  assert.match(answer.answer, /100%/);
  assert.match(answer.answer, /1/);
  assert.equal(answer.claims.length, 1);
  assert.equal(answer.proofs[0].requestOwnership.length, 2);
  assert.deepEqual(answer.operationDeduplication.originalToSelectedIndex, [0, 0]);
  for (const patch of [{ qualifiers: { passType: 'cross' } }, { timeFromExclusive: true }]) {
    const bad = structuredClone(valid);
    Object.assign(bad[1].requestCheck.coverage[1].requestedQuantity[0], patch);
    const reject = sequenceTransport(bad);
    await assert.rejects(
      answerMatchQuestionAI(input, { config, fetcher: reject.fetcher }),
      (error) => error.code === 'question-withheld',
    );
  }
});

test('component-owned windows reject wrong bounds then repair reversed query order without scope guessing', async () => {
  const input = {
    kind: 'interrupted',
    seed: 2071,
    time: 108,
    question:
      'How many passes did Northbridge complete before 00:55, and how many shots has Harbour taken since 01:30?',
  };
  const spans = requestComponents(input.question),
    windows = [
      { timeFrom: 0, timeTo: 55, timeFromExclusive: false, timeToExclusive: true },
      { timeFrom: 90, timeTo: 108, timeFromExclusive: false, timeToExclusive: false },
    ];
  const bindings = spans.map((requestSpan, index) => ({ requestSpan, window: windows[index] }));
  const queries = spans.map((requestSpan, index) => ({
    requestSpan,
    query: {
      filters: index
        ? { type: 'shot', team: 'away' }
        : { type: 'pass', team: 'home', result: true },
      aggregate: 'count',
      ...windows[index],
      relativeTo: null,
    },
  }));
  const plan = (queries) => ({
    answerFocus: 'other',
    explanationTarget: 'none',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: { kind: 'queries', queries },
  });
  const bad = structuredClone(queries);
  bad[0].query.timeToExclusive = false;
  for (const value of [
    bad,
    queries.map((x) => x.query),
    [{ ...queries[0], requestSpan: 'invented' }, queries[1]],
    queries.slice(0, 1),
  ])
    assert.throws(
      () => bindComponentWindowQueries(value, bindings),
      (e) => e.code === 'question-invalid-operation',
    );
  assert.deepEqual(bindComponentWindowQueries([...queries].reverse(), bindings).queries, [
    queries[1].query,
    queries[0].query,
  ]);
  let selected;
  const mock = sequenceTransport([
    plan(bad),
    (_packet, body) => {
      const wire = resolvedWireSchema(body);
      const branch = wire.properties.decision.anyOf.find((b) =>
        b.properties.kind.enum.includes('queries'),
      );
      assert.ok(
        wire.properties.decision.anyOf.every((b) => !b.properties.kind.enum.includes('operation')),
      );
      for (const binding of bindings)
        assert.ok(
          branch.properties.queries.items.anyOf.some(
            (v) =>
              v.properties.requestSpan.enum[0] === binding.requestSpan &&
              v.properties.query.properties.timeTo.enum[0] === binding.window.timeTo,
          ),
        );
      return plan([...queries].reverse());
    },
    (packet) => {
      selected = bindings.map((binding, index) =>
        packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === (index ? 'attempts' : 'completedPasses') &&
            f.selection.subjectId === (index ? 'away' : 'home') &&
            f.selection.timeFrom === binding.window.timeFrom &&
            f.selection.timeTo === binding.window.timeTo,
        ),
      );
      assert.ok(selected.every(Boolean));
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: selected.map((f) => f.id) },
        followUp: '',
      };
    },
    (packet, body) => {
      const variants =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
      for (const [index, span] of spans.entries())
        for (const v of variants.filter((v) => v.properties.requestSpan.enum[0] === span))
          for (const option of v.properties.requestedQuantity.anyOf || [])
            if (option.type === 'array')
              assert.ok(
                option.items.anyOf.every(
                  (q) => q.properties.timeToExclusive.enum[0] === windows[index].timeToExclusive,
                ),
              );
      return {
        decision: 'approve',
        reason: 'Both independently scoped quantities supplied.',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Exact component windows.',
          coverage: spans.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: 'fact',
            requestedAction: index ? 'shot' : 'pass',
            requestedQuantity: [
              {
                requestSpan,
                action: index ? 'shot' : 'pass',
                state: index ? 'any' : 'completed',
                grouping: 'by-team',
                subjectIds: [index ? 'away' : 'home'],
                ...windows[index],
                qualifiers: null,
              },
            ],
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(answer.execution.modelCalls, 4);
  assert.equal(answer.execution.planningRepairs, 1);
  assert.deepEqual(
    answer.canonicalFactSelection.proofs.map((p) => p.value),
    [5, 2],
  );
  assert.equal(answer.execution.componentQueryBindings[0].requestSpan, spans[1]);
  assert.equal(answer.canonicalFactSelection.proofs[0].timeToExclusive, true);
  assert.equal(!!answer.canonicalFactSelection.proofs[1].timeFromExclusive, false);
});

test('fronted temporal relation clocks stay attached only to their own request component', () => {
  assert.deepEqual(
    requestComponents(
      'Since 01:30, how many shots were taken, and before 00:55, how many passes were completed?',
    ),
    ['Since 01:30, how many shots were taken', 'before 00:55, how many passes were completed'],
  );
  for (const prefix of [
    'Before',
    'After',
    'Since',
    'Avant',
    'Après',
    'Depuis',
    'Antes de',
    'Después de',
    'Desde',
    'Após',
    'Depois de',
  ])
    assert.deepEqual(
      requestComponents(prefix + ' 00:30, how many shots were taken, and who scored?'),
      [prefix + ' 00:30, how many shots were taken', 'who scored'],
    );
  assert.deepEqual(requestComponents('Since 00:30, Cole played a pass, and who scored?'), [
    'who scored',
  ]);
  assert.deepEqual(requestComponents('Cole scored, did he not, and who assisted?'), [
    'Cole scored, did he not',
    'who assisted',
  ]);
  assert.deepEqual(
    requestComponents('At 00:19, what is the passing accuracy, and how many passes are pending?'),
    ['what is the passing accuracy', 'how many passes are pending'],
  );
});

test('all-canonical operation review requires literal empty actor/count arrays without weakening coverage', async () => {
  const input = {
    kind: 'counter',
    seed: 2063,
    time: 90,
    question:
      "Since 00:18, how many of Northbridge's passes are still unresolved, and what's their pass completion percentage?",
  };
  const plan = {
    answerFocus: 'other',
    explanationTarget: 'none',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision: {
      kind: 'operation',
      plan: {
        version: 1,
        obligations: [
          {
            id: 'rate',
            requestSpan: input.question,
            operator: 'ratio',
            metric: 'passCompletionRate',
            subjects: ['home'],
            timeFrom: 18,
            timeTo: 90,
          },
        ],
      },
    },
  };
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      const schema = resolvedWireSchema(body),
        checks = schema.properties.checks.items.anyOf;
      assert.ok(
        checks.every((v) =>
          ['actors', 'counts'].every(
            (field) =>
              v.properties[field].items.type === 'string' && v.properties[field].maxItems === 0,
          ),
        ),
      );
      assert.ok(schema.properties.requestCheck.properties.coverage.items);
      const variants = schema.properties.requestCheck.properties.coverage.items.anyOf;
      const rateVariant = variants.find(
        (variant) => variant.properties.requestSpan.enum[0] === packet.requestComponents[1],
      );
      assert.equal(
        rateVariant.properties.requestedQuantity.type,
        'null',
        'pure ratio is not a count-state obligation',
      );
      const countVariant = variants.find(
        (variant) =>
          variant.properties.requestSpan.enum[0] === packet.requestComponents[0] &&
          variant.properties.answerForm.enum.includes('fact'),
      );
      for (const option of countVariant.properties.requestedQuantity.anyOf || [])
        if (option.type === 'array')
          for (const quantity of option.items.anyOf) {
            assert.deepEqual(quantity.properties.action.enum, ['pass']);
            assert.deepEqual(quantity.properties.state.enum, ['pending']);
          }
      for (const variant of variants)
        for (const option of variant.properties.requestedQuantity.anyOf || [])
          if (option.type === 'array')
            for (const quantity of option.items.anyOf)
              for (const [key, value] of Object.entries({
                timeFrom: 18,
                timeTo: 90,
                timeFromExclusive: false,
                timeToExclusive: false,
              }))
                assert.deepEqual(quantity.properties[key].enum, [value], key);
      assert.match(body.messages[0].content, /EVERY requested component/);
      return {
        decision: 'approve',
        reason: 'Exact ratio and pending count.',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Both requested components.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [0],
            answerForm: 'fact',
            requestedAction: 'pass',
            requestedQuantity: index
              ? null
              : [
                  {
                    requestSpan,
                    action: 'pass',
                    state: 'pending',
                    grouping: 'by-team',
                    subjectIds: ['home'],
                    timeFrom: 18,
                    timeTo: 90,
                    timeFromExclusive: false,
                    timeToExclusive: false,
                    qualifiers: null,
                  },
                ],
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 2);
  assert.match(answer.answer, /75%/);
  assert.match(answer.answer, /1 awaiting/);
});

test('actual AH truncated canonical review remains a failed response without salvage or retry', async () => {
  const input = {
    kind: 'counter',
    seed: 2063,
    time: 90,
    language: 'en',
    question:
      "Since 00:18, how many of Northbridge's passes are still unresolved, and what's their pass completion percentage?",
  };
  const responses = [
    {
      choices: [
        {
          content_filter_results: {
            hate: { filtered: false, severity: 'safe' },
            protected_material_code: { detected: false, filtered: false },
            protected_material_text: { detected: false, filtered: false },
            self_harm: { filtered: false, severity: 'safe' },
            sexual: { filtered: false, severity: 'safe' },
            violence: { filtered: false, severity: 'safe' },
          },
          finish_reason: 'stop',
          index: 0,
          logprobs: null,
          message: {
            annotations: [],
            content:
              '{"requestedSourceAttributes":null,"answerFocus":"team-assessment","explanationTarget":"other","requestedForm":"fact","mentionedPlayers":[],"decision":{"kind":"operation","plan":{"version":1,"obligations":[{"id":"passCompletionRate-home-00:18-01:30","requestSpan":"Since 00:18, how many of Northbridge\'s passes are still unresolved","operator":"ratio","metric":"passCompletionRate","subjects":["home"],"timeFrom":18,"timeTo":90}]} } }',
            refusal: null,
            role: 'assistant',
          },
        },
      ],
      created: 1792445390,
      id: 'chatcmpl-EapDS309azwOJ5uREquipPqHDn4gO',
      model: 'gpt-4.1-mini-2025-04-14',
      object: 'chat.completion',
      prompt_filter_results: [
        {
          prompt_index: 0,
          content_filter_results: {
            hate: { filtered: false, severity: 'safe' },
            jailbreak: { detected: false, filtered: false },
            self_harm: { filtered: false, severity: 'safe' },
            sexual: { filtered: false, severity: 'safe' },
            violence: { filtered: false, severity: 'safe' },
          },
        },
      ],
      routing: { serving_pipereplica: 'd20260928213240-060f2aac-default-r0-dp0-default' },
      service_tier: 'default',
      system_fingerprint: 'fp_8957c4f4dd',
      usage: {
        completion_tokens: 109,
        completion_tokens_details: {
          accepted_prediction_tokens: 0,
          audio_tokens: 0,
          reasoning_tokens: 0,
          rejected_prediction_tokens: 0,
        },
        latency_checkpoint: {
          engine_tbt_ms: 8,
          engine_ttft_ms: 81,
          engine_ttlt_ms: 978,
          pre_inference_ms: 259,
          service_tbt_ms: 8,
          service_ttft_ms: 409,
          service_ttlt_ms: 1300,
          user_visible_ttft_ms: 150,
        },
        prompt_tokens: 9622,
        prompt_tokens_details: { audio_tokens: 0, cached_tokens: 8064 },
        total_tokens: 9731,
      },
    },
    {
      choices: [
        {
          content_filter_results: {
            hate: { filtered: false, severity: 'safe' },
            protected_material_code: { detected: false, filtered: false },
            protected_material_text: { detected: false, filtered: false },
            self_harm: { filtered: false, severity: 'safe' },
            sexual: { filtered: false, severity: 'safe' },
            violence: { filtered: false, severity: 'safe' },
          },
          finish_reason: 'length',
          index: 0,
          logprobs: null,
          message: {
            annotations: [],
            content:
              '{"requestCheck":{"requestedInformation":"Since 00:18, how many of Northbridge\'s passes are still unresolved, and what\'s their pass completion percentage?","status":"answered","coverage":[{"requestSpan":"Since 00:18, how many of Northbridge\'s passes are still unresolved","claimIndices":[0],"answerForm":"fact","requestedAction":"pass","temporalRelation":"none","relationAnchorClaimIndex":null,"relationEntityBinding":"none","relationSourceLinkIndex":null,"requestedQuantity":[{"requestSpan":"Since 00:18, how many of Northbridge\'s passes are still unresolved","action":"pass","state":"pending","grouping":"by-team","subjectIds":["home"],"timeFrom":18,"timeTo":90,"timeFromExclusive":null,"timeToExclusive":null,"qualifiers":null}],"requestedSourceAttributes":null,"sourceInventoryDependency":null},{"requestSpan":"what\'s their pass completion percentage","claimIndices":[0],"answerForm":"fact","requestedAction":"pass","temporalRelation":"none","relationAnchorClaimIndex":null,"relationEntityBinding":"none","relationSourceLinkIndex":null,"requestedQuantity":[{"requestSpan":"what\'s their pass completion percentage","action":"pass","state":"completed","grouping":"by-team","subjectIds":["home"],"timeFrom":18,"timeTo":90,"timeFromExclusive":null,"timeToExclusive":null,"qualifiers":null},{"requestSpan":"what\'s their pass completion percentage","action":"pass","state":"unsuccessful","grouping":"by-team","subjectIds":["home"],"timeFrom":18,"timeTo":90,"timeFromExclusive":null,"timeToExclusive":null,"qualifiers":null}],"requestedSourceAttributes":null,"sourceInventoryDependency":null}],"reason":"The answer provides the count of unresolved passes and the pass completion percentage for Northbridge since 00:18, fully covering the user\'s question."},"checks":[{"claimIndex":0,"actors":[],"inventedFacts":[],"counts":[\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n \t\n',
            refusal: null,
            role: 'assistant',
          },
        },
      ],
      created: 1792445399,
      id: 'chatcmpl-EapDb28FKeHbkrXxeom7KLWLv8XpJ',
      model: 'gpt-4.1-mini-2025-04-14',
      object: 'chat.completion',
      prompt_filter_results: [
        {
          prompt_index: 0,
          content_filter_results: {
            hate: { filtered: false, severity: 'safe' },
            jailbreak: { detected: false, filtered: false },
            self_harm: { filtered: false, severity: 'safe' },
            sexual: { filtered: false, severity: 'safe' },
            violence: { filtered: false, severity: 'safe' },
          },
        },
      ],
      routing: { serving_pipereplica: 'd20261004084924-624bb2ab-default-r2-dp0-default' },
      service_tier: 'default',
      system_fingerprint: 'fp_92f9364fa2',
      usage: {
        completion_tokens: 1010,
        completion_tokens_details: {
          accepted_prediction_tokens: 0,
          audio_tokens: 0,
          reasoning_tokens: 0,
          rejected_prediction_tokens: 0,
        },
        latency_checkpoint: {
          engine_tbt_ms: 9,
          engine_ttft_ms: 772,
          engine_ttlt_ms: 10168,
          pre_inference_ms: 632,
          service_tbt_ms: 9,
          service_ttft_ms: 1857,
          service_ttlt_ms: 11247,
          user_visible_ttft_ms: 1224,
        },
        prompt_tokens: 15673,
        prompt_tokens_details: { audio_tokens: 0, cached_tokens: 1664 },
        total_tokens: 16683,
      },
    },
  ];
  let calls = 0;
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (calls === 1) {
      const checks = resolvedWireSchema(body).properties.checks.items.anyOf;
      assert.ok(
        checks.every(
          (v) => v.properties.counts.maxItems === 0 && v.properties.counts.items.type === 'string',
        ),
      );
    }
    assert.ok(calls < 2);
    return { ok: true, json: async () => responses[calls++] };
  };
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher, canRepair: () => true }),
    (error) => error.code === 'azure-incomplete-response',
  );
  assert.equal(calls, 2);
});

test('shared since review cannot approve an exclusive count even if its source count is correct', () => {
  const question =
      'Since 00:18, how many passes are unresolved, and what is their completion percentage?',
    span = requestComponents(question)[0];
  const demand = {
    requestSpan: span,
    action: 'pass',
    state: 'pending',
    grouping: 'by-team',
    subjectIds: ['home'],
    timeFrom: 18,
    timeTo: 90,
    timeFromExclusive: true,
    timeToExclusive: false,
    qualifiers: null,
  };
  const issues = requestedQuantityIssues(
    { requestSpan: span, claimIndices: [0], requestedQuantity: [demand] },
    { claims: [] },
    { question, observedAt: 90, roster: [] },
    { proofs: [] },
  );
  assert.ok(issues.some((issue) => /exact elapsed-second window/.test(issue.reason)));
});

test('explicit pending count classification keeps action and state without classifying ambiguous compound requests', () => {
  for (const question of [
    'How many passes are unresolved',
    'How many passes are still waiting for an outcome',
    'Combien de passes sont encore sans resultat',
    'Cuantos pases estan pendientes',
    'Quantas passes estao pendentes',
  ])
    assert.equal(explicitPendingCountAction(question), 'pass', question);
  assert.equal(explicitPendingCountAction('How many shots are pending'), 'shot');
  for (const question of [
    'How many passes are not unresolved',
    'How many passes are without a pending outcome',
    'How many passes are anything but pending',
    'Combien de passes de Northbridge sont tout sauf en attente',
    'Quantas passes de Northbridge estao sem estarem pendentes',
    'How many passes are free of pending outcomes',
    'How many passes are completed instead of pending',
    "How many passes aren't pending",
    'How many passes are no longer pending',
    'How many passes are no longer unresolved',
    'Cuantos pases no estan pendientes',
    'How many completed or pending passes',
    'How many passes including pending',
    'How many pending passes and shots',
    'What is their pending-pass percentage',
    'How many incidents are unresolved',
  ])
    assert.equal(explicitPendingCountAction(question), null, question);
});

test('review cannot relabel explicitly unresolved passes as completed even with a matching count source', () => {
  const span = 'How many passes are still unresolved';
  const demand = {
    requestSpan: span,
    action: 'pass',
    state: 'completed',
    grouping: 'by-team',
    subjectIds: ['home'],
    timeFrom: 0,
    timeTo: 90,
    timeFromExclusive: false,
    timeToExclusive: false,
    qualifiers: null,
  };
  const issues = requestedQuantityIssues(
    { requestSpan: span, claimIndices: [0], requestedQuantity: [demand] },
    { claims: [] },
    { question: span, observedAt: 90, roster: [] },
    { proofs: [] },
  );
  assert.ok(issues.some((issue) => /pending outcome state/.test(issue.reason)));
});

test('anaphoric completion percentage uses a proved query ratio without count-state repair', async () => {
  const input = {
    kind: 'counter',
    seed: 2099,
    time: 90,
    question:
      'Since 00:10, how many Northbridge passes are still waiting for an outcome, and what is their completion percentage?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: { type: 'pass', team: 'home' }, aggregate: 'count', timeFrom: 10, timeTo: 90 },
        ],
      },
    },
    (packet) => {
      const facts = packet.matchFacts.facts;
      const pending = facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'pendingPasses' &&
          f.selection.subjectId === 'home',
      );
      const ratio = facts.find(
        (f) => f.selection.kind === 'pass-completion-profile' && f.selection.subjectId === 'home',
      );
      assert.ok(pending && ratio);
      return {
        scope: 'match',
        composition: {
          mode: 'facts',
          factIds: [
            pending.id,
            ...facts
              .filter(
                (f) =>
                  f.selection.kind === 'count' &&
                  ['passes', 'completedPasses'].includes(f.selection.metric) &&
                  f.selection.subjectId === 'home',
              )
              .slice(0, 2)
              .map((f) => f.id),
            ratio.id,
          ],
        },
        followUp: '',
      };
    },
    (packet, body) => {
      const variants =
        resolvedWireSchema(body).properties.requestCheck.properties.coverage.items.anyOf;
      assert.equal(
        variants.find((v) => v.properties.requestSpan.enum[0] === packet.requestComponents[1])
          .properties.requestedQuantity.type,
        'null',
      );
      return {
        decision: 'approve',
        reason: 'Pending count and source ratio.',
        requestCheck: {
          status: 'answered',
          requestedInformation: input.question,
          reason: 'Both requested facts.',
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index ? packet.answer.claims.length - 1 : 0],
            answerForm: 'fact',
            requestedAction: 'pass',
            requestedQuantity: index
              ? null
              : [
                  {
                    requestSpan,
                    action: 'pass',
                    state: 'pending',
                    grouping: 'by-team',
                    subjectIds: ['home'],
                    timeFrom: 10,
                    timeTo: 90,
                    timeFromExclusive: false,
                    timeToExclusive: false,
                    qualifiers: null,
                  },
                ],
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.execution.planningRepairs, 0);
  assert.equal(answer.claims.length, 2);
  assert.match(answer.answer, /80%/);
  assert.match(answer.answer, /1 pass awaiting/);
});

test('requested passing percentage cannot be credited to raw counts when no ratio claim was selected', () => {
  const question = 'Quel est leur pourcentage de passes reussies';
  const answer = {
    scope: 'match',
    claims: [{ kind: 'observation', text: 'Two completed passes.', evidence: [] }],
  };
  const review = {
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      requestedInformation: question,
      coverage: [
        {
          requestSpan: question,
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'pass',
          requestedQuantity: null,
        },
      ],
    },
    checks: [{ claimIndex: 0, actors: [], counts: [], inventedFacts: [], supported: true }],
  };
  const issues = reviewRequestAdequacy(
    review,
    answer,
    { question, observedAt: 90, answerFocus: 'other' },
    {
      canonicalFactSelection: {
        proofs: [{ kind: 'count', metric: 'completedPasses', value: 2, modelGenerated: false }],
      },
    },
  );
  assert.ok(issues.some((issue) => /source-backed ratio claim/.test(issue.reason)));
});

test('a source-proved attacking comparison does not replace why an attack improved', () => {
  const input = { kind: 'counter', seed: 2119, time: 118 };
  const state = matchState(input),
    sources = ['home', 'away'].map((team) =>
      executeMatchQuery(input, {
        filters: { type: 'shot', team },
        aggregate: 'count',
        timeFrom: 0,
        timeTo: 118,
      }),
    );
  const question = 'Why did the home attack improve?';
  const packet = {
    question,
    observedAt: 118,
    answerFocus: 'team-attacking-assessment',
    requestedForm: 'explanation',
    explanationTarget: 'other',
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    queryResults: sources,
    requestedEvidence: sources,
  };
  const fact = buildQuestionFacts(packet).facts.find(
    (f) => f.proof.kind === 'team-comparison' && f.proof.metric === 'attempts',
  );
  assert.ok(fact);
  const answer = { scope: 'match', claims: [fact.claim] },
    selection = { proofs: [fact.proof] };
  const review = {
    requestCheck: {
      status: 'answered',
      requestedInformation: question,
      responseIntent: {
        purpose: 'explanation',
        needsAssessment: false,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
      },
      coverage: [
        {
          requestSpan: question,
          claimIndices: [0],
          answerForm: 'explanation',
          requestedAction: 'other',
        },
      ],
    },
  };
  assert.ok(
    reviewRequestAdequacy(review, answer, packet, { canonicalFactSelection: selection }).some(
      (issue) => /explanation/.test(issue.reason),
    ),
  );
  assert.ok(
    reviewRequestAdequacy(
      review,
      answer,
      { ...packet, requestedForm: 'assessment' },
      { canonicalFactSelection: selection },
    ).some((issue) => /explanation/.test(issue.reason)),
    'independent explanatory intent wins over a mistaken planner assessment',
  );
  const plain = 'Which side has more shot attempts?',
    comparison = structuredClone(review);
  comparison.requestCheck.responseIntent.purpose = 'assessment';
  comparison.requestCheck.coverage[0] = {
    requestSpan: plain,
    claimIndices: [0],
    answerForm: 'assessment',
    requestedAction: 'other',
  };
  assert.deepEqual(
    reviewRequestAdequacy(
      comparison,
      answer,
      { ...packet, question: plain, requestedForm: 'assessment' },
      { canonicalFactSelection: selection },
    ),
    [],
    'ordinary measured comparison remains valid',
  );
  const qualified = {
    ...answer,
    claims: [
      ...answer.claims,
      {
        kind: 'limitation',
        text: 'These attempt totals do not establish why the attack improved.',
        evidence: [],
      },
    ],
  };
  const complete = structuredClone(review);
  complete.requestCheck.coverage[0].claimIndices = [0, 1];
  assert.deepEqual(
    reviewRequestAdequacy(complete, qualified, packet, { canonicalFactSelection: selection }),
    [],
    'a relevant covered qualification remains possible',
  );
});

test('ambiguous conversation player clarifies after routing without querying an arbitrary actor', async () => {
  const conversation = [
    {
      question: 'Who has taken the shots for the two sides?',
      answer: 'A. Reed has taken Northbridge shots, and D. Silva has taken Harbour shots.',
      time: 108,
    },
  ];
  for (const [language, question] of [
    ['en', 'How many shots has he had?'],
    ['fr', 'Combien de tirs a-t-il tentes ?'],
    ['es', 'Cuantos tiros ha hecho el?'],
    ['pt', 'Quantos remates fez ele?'],
  ]) {
    const input = { kind: 'duel', seed: 2217, time: 108, conversation, language, question };
    const mock = sequenceTransport([
      {
        answerFocus: 'other',
        explanationTarget: 'none',
        requestedForm: 'fact',
        mentionedPlayers: ['A. Reed'],
        decision: { kind: 'queries', queries: [] },
      },
    ]);
    const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.equal(answer.scope, 'clarify');
    assert.equal(answer.execution.modelCalls, 1);
    assert.deepEqual(answer.evidence, []);
    assert.match(answer.answer, /Reed/);
    assert.match(answer.answer, /Silva/);
  }
});

test('explicit player, anchor and sole antecedent do not trigger multi-player clarification', () => {
  const roster = [
    { id: 'home-9', name: 'A. Reed', team: 'home' },
    { id: 'away-9', name: 'D. Silva', team: 'away' },
  ];
  const base = {
    question: 'How many shots has he had?',
    conversation: [{ answer: 'A. Reed and D. Silva have taken shots.' }],
  };
  assert.equal(ambiguousConversationPlayers(base, roster).length, 2);
  assert.deepEqual(
    ambiguousConversationPlayers(
      { ...base, language: 'es', question: 'Como va el partido?' },
      roster,
    ),
    [],
  );
  assert.deepEqual(
    ambiguousConversationPlayers({ ...base, question: 'How many shots has Reed had?' }, roster),
    [],
  );
  assert.deepEqual(ambiguousConversationPlayers({ ...base, anchorId: 'source-event' }, roster), []);
  assert.deepEqual(
    ambiguousConversationPlayers(
      { ...base, conversation: [{ answer: 'A. Reed has taken shots.' }] },
      roster,
    ),
    [],
  );
  assert.deepEqual(
    ambiguousConversationPlayers(
      { ...base, question: 'How many shots has he had for Northbridge?' },
      roster,
      { home: 'Northbridge', away: 'Harbour' },
    ),
    [],
  );
});

test('two prior players do not block an identity-independent football rule question', async () => {
  const question = {
    kind: 'duel',
    seed: 2217,
    time: 108,
    question: 'Can he be offside in his own half?',
    conversation: [
      { question: 'Who shot?', answer: 'A. Reed and D. Silva have taken shots.', time: 108 },
    ],
  };
  const mock = sequenceTransport([
    (_packet, body) => {
      assert.ok(
        decisionBranch(body, 'general'),
        'General must be offered by the actual wire schema',
      );
      return {
        answerFocus: 'other',
        explanationTarget: 'other',
        requestedForm: 'explanation',
        mentionedPlayers: [],
        decision: { kind: 'general' },
      };
    },
    {
      scope: 'general',
      claims: [
        {
          text: 'A player cannot be in an offside position in their own half.',
          kind: 'general',
          evidence: [],
        },
      ],
      followUp: '',
    },
    { decision: 'approve' },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.scope, 'general');
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /own half/);
});

test('multipart explanation can select and depend on an application-proved linked sequence', async () => {
  const input = {
    kind: 'sustained',
    seed: 2207,
    time: 118,
    question: 'Does Cole look like a provider here? Give a buildup example and confirm the assist.',
    language: 'en',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'player-performance',
      requestedForm: 'explanation',
      explanationTarget: 'observed-sequence',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', player: 'J. Cole', result: true },
            aggregate: 'list',
            limit: 10,
          },
        ],
      },
    },
    (packet, body) => {
      const story = packet.matchFacts.facts.find((f) => f.selection.kind === 'linked-shot-supply'),
        assist = packet.matchFacts.facts.find((f) => f.selection.kind === 'credited-goal-assist');
      assert.ok(story && assist);
      const wire = resolvedWireSchema(body);
      assert.ok(
        wire.$defs.canonicalFactId.enum.includes(story.id),
        'A sequence must be selectable alongside observations, not only as a standalone story',
      );
      assert.ok(
        wire.properties.composition.anyOf.every((mode) =>
          mode.properties.mode.enum.includes('sequence-explanation'),
        ),
      );
      return {
        scope: 'match',
        composition: {
          mode: 'sequence-explanation',
          sequenceFactId: story.id,
          factIds: [assist.id],
          claim: {
            text: 'He contributed as a provider in this passage, though that does not establish his overall role.',
            kind: 'interpretation',
            evidence: [],
            dependsOn: [0, 1],
          },
        },
        followUp: '',
      };
    },
    { decision: 'approve' },
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.ok(
    result.canonicalFactSelection.proofs.some((proof) => proof.kind === 'linked-shot-supply'),
  );
  assert.match(result.answer, /supplied/);
  assert.match(result.answer, /credited/);
  assert.match(result.answer, /provider/);
});

test('forced sequence candidates need matching requested source rows, revisions and inclusive window', () => {
  const input = { kind: 'sustained', seed: 2207, time: 118 },
    state = matchState(input);
  const source = executeMatchQuery(input, {
    filters: { type: 'pass', player: 'J. Cole' },
    aggregate: 'list',
    limit: 20,
    timeFrom: 0,
    timeTo: 118,
  });
  const packet = {
    question: 'Show a buildup',
    roster: state.frames.at(-1).players,
    teams: state.metadata.teams,
    observedAt: 118,
    requestedEvidence: [source],
    queryResults: [source],
  };
  packet.linkedContext = {
    rows: state.events.filter(
      (event) => event.type === 'shot' && source.rows.some((row) => event.passId === row.id),
    ),
  };
  const manifest = buildQuestionFacts(packet),
    selected = sourceScopedSequenceFacts(manifest, [source]);
  assert.ok(selected.length);
  const time = selected[0].proof.time;
  for (const bad of [
    { ...source, query: { ...source.query, timeFrom: time + 1 } },
    { ...source, query: { ...source.query, timeTo: time - 1 } },
    { ...source, query: { ...source.query, timeFrom: time, timeFromExclusive: true } },
    { ...source, rows: source.rows.map((row) => ({ ...row, revision: row.revision + 1 })) },
    executeMatchQuery(input, {
      filters: { type: 'pass', team: 'away' },
      aggregate: 'list',
      limit: 20,
      timeFrom: 0,
      timeTo: 118,
    }),
  ])
    assert.ok(!sourceScopedSequenceFacts(manifest, [bad]).some((f) => f.id === selected[0].id));
  assert.ok(
    sourceScopedSequenceFacts(manifest, [
      { ...source, query: { ...source.query, timeFrom: time, timeTo: time } },
    ]).some((f) => f.id === selected[0].id),
  );
});

test('a scoped factual sequence can explain buildup but cannot satisfy a mixed intention or role request alone', () => {
  const input = { kind: 'sustained', seed: 2305, time: 118 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'pass', player: 'J. Cole' },
      aggregate: 'list',
      limit: 20,
    });
  const packet = {
    question: 'Describe the buildup',
    observedAt: 118,
    requestedForm: 'explanation',
    explanationTarget: 'observed-sequence',
    roster: state.frames.at(-1).players,
    teams: state.metadata.teams,
    requestedEvidence: [source],
    queryResults: [source],
    linkedContext: {
      rows: state.events.filter(
        (event) => event.type === 'shot' && source.rows.some((row) => event.passId === row.id),
      ),
    },
  };
  const manifest = buildQuestionFacts(packet),
    story = manifest.facts.find((f) => f.proof.kind === 'linked-shot-supply'),
    selection = selectQuestionFacts(manifest, [story.id]),
    answer = { scope: 'match', claims: selection.claims };
  const review = {
    requestCheck: {
      status: 'answered',
      requestedInformation: packet.question,
      responseIntent: {
        purpose: 'explanation',
        needsAssessment: false,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
      },
      coverage: [
        {
          requestSpan: packet.question,
          claimIndices: [0],
          answerForm: 'explanation',
          requestedAction: 'other',
          explanationTarget: 'observed-sequence',
        },
      ],
    },
  };
  const check = (r = review, p = packet) =>
    reviewRequestAdequacy(r, answer, p, { canonicalFactSelection: selection });
  assert.deepEqual(check(), []);
  assert.ok(
    check(review, { ...packet, explanationTarget: 'decision-rationale' }).some((issue) =>
      /explanation/.test(issue.reason),
    ),
  );
  const mixed = { ...packet, question: 'Describe the buildup? Why did he choose that pass?' };
  const r = structuredClone(review);
  r.requestCheck.requestedInformation = mixed.question;
  r.requestCheck.responseIntent.purpose = 'mixed';
  r.requestCheck.coverage = requestComponents(mixed.question).map((requestSpan, i) => ({
    requestSpan,
    claimIndices: [0],
    answerForm: 'explanation',
    requestedAction: 'other',
    explanationTarget: i ? 'decision-rationale' : 'observed-sequence',
  }));
  assert.ok(
    check(r, mixed).some((issue) => issue.requestSpan === requestComponents(mixed.question)[1]),
  );
  const assessment = structuredClone(review);
  assessment.requestCheck.responseIntent.needsAssessment = true;
  assert.ok(check(assessment).some((issue) => /assessment/.test(issue.reason)));
  const late = { ...source, query: { ...source.query, timeFrom: 117 } };
  assert.ok(
    check(review, { ...packet, requestedEvidence: [late] }).some((issue) =>
      /explanation/.test(issue.reason),
    ),
  );
});

test('independent scoreline intent distinguishes goal identity from the two-team score requirement', () => {
  const input = { kind: 'sustained', seed: 2501, time: 118 },
    state = matchState(input),
    source = executeMatchQuery(input, {
      filters: { type: 'shot', result: true },
      aggregate: 'list',
      order: 'desc',
      limit: 1,
    });
  const packet = {
    question: 'Who scored the latest goal and who assisted?',
    answerFocus: 'score',
    observedAt: 118,
    roster: state.frames.at(-1).players,
    teams: state.metadata.teams,
    requestedEvidence: [source],
    queryResults: [source],
  };
  const manifest = buildQuestionFacts(packet),
    goal = manifest.facts.find(
      (f) =>
        f.proof.kind === 'event' && f.proof.actionOutcome?.status === 'goal' && !f.proof.attributes,
    ),
    assist = manifest.facts.find((f) => f.proof.kind === 'credited-goal-assist');
  assert.ok(goal && assist);
  const selection = selectQuestionFacts(manifest, [goal.id, assist.id]),
    answer = { scope: 'match', claims: selection.claims };
  const review = {
    requestCheck: {
      status: 'answered',
      requestedInformation: packet.question,
      responseIntent: {
        purpose: 'fact-retrieval',
        needsAssessment: false,
        needsExplicitCorrection: false,
        needsMeasurementLimitation: false,
        needsScoreline: false,
      },
      coverage: [
        {
          requestSpan: packet.question,
          claimIndices: [0, 1],
          answerForm: 'fact',
          requestedAction: 'other',
        },
      ],
    },
  };
  const check = (r = review, p = packet) =>
    reviewRequestAdequacy(r, answer, p, { canonicalFactSelection: selection });
  assert.deepEqual(check(), []);
  const wantsBoth = structuredClone(review);
  wantsBoth.requestCheck.responseIntent.needsScoreline = true;
  assert.ok(
    check(wantsBoth, { ...packet, answerFocus: 'event-actor' }).some((issue) =>
      /scoreline/.test(issue.reason),
    ),
    'review requirement also protects against a missed planner score classification',
  );
  const legacy = structuredClone(review);
  delete legacy.requestCheck.responseIntent.needsScoreline;
  assert.ok(
    check(legacy).some((issue) => /scoreline/.test(issue.reason)),
    'legacy recorded reviews preserve the previous conservative fallback',
  );
  const malformed = structuredClone(review);
  malformed.requestCheck.responseIntent.needsScoreline = 'false';
  assert.ok(check(malformed).some((issue) => /boolean/.test(issue.reason)));
});

test('a readiness limitation can retain the requested recorded action and next ball winner', async () => {
  const input = {
    kind: 'counter',
    seed: 2403,
    time: 28,
    question:
      "Did Mensah's pass fail because Cole wasn't ready, and who actually got the ball next?",
  };
  const plan = {
    answerFocus: 'event-sequence',
    explanationTarget: 'decision-rationale',
    requestedForm: 'explanation',
    mentionedPlayers: ['R. Mensah', 'J. Cole'],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'pass', player: 'R. Mensah', result: false },
          aggregate: 'list',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 28,
        },
        {
          filters: { type: 'recovery' },
          aggregate: 'list',
          order: 'asc',
          limit: 1,
          relativeTo: { queryIndex: 0, relation: 'after', sameTeam: false, samePlayer: false },
        },
      ],
    },
  };
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      const facts = packet.matchFacts.facts;
      const limitation = facts.find((f) => f.selection.dimension === 'readiness'),
        pass = facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'pass' &&
            f.selection.time === 18 &&
            !f.selection.attributes,
        ),
        winner = facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'recovery' &&
            f.selection.time === 20,
        );
      assert.ok(limitation && pass && winner);
      const mode = resolvedWireSchema(body).properties.composition.anyOf[0];
      assert.equal(mode.properties.factIds.maxItems, 4);
      assert.ok(mode.properties.factIds.items.enum.includes(winner.id));
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [limitation.id, pass.id, winner.id] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'useful-limitation',
        requestedInformation: input.question,
        responseIntent: {
          purpose: 'mixed',
          needsAssessment: false,
          needsExplicitCorrection: false,
          needsScoreline: false,
          needsMeasurementLimitation: true,
          reason: 'Separate unrecorded readiness from the known action sequence.',
        },
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: i ? [2] : [0, 1],
          answerForm: i ? 'fact' : 'unavailable-measurement',
          requestedAction: i ? 'recovery' : 'pass',
          temporalRelation: i ? 'after-requested-event' : 'none',
          relationAnchorClaimIndex: null,
          relationEntityBinding: 'none',
          relationSourceLinkIndex: i ? 0 : null,
          explanationTarget: i ? 'none' : 'decision-rationale',
          requestedQuantity: null,
          requestedSourceAttributes: null,
          sourceInventoryDependency: null,
        })),
        reason: 'Both the missing cause and recorded subsequent actor are covered.',
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => false,
  });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.execution.repairs, 0);
  assert.match(result.answer, /ready/);
  assert.match(result.answer, /M\. Costa/);
  assert.match(result.answer, /unsuccessful/);
  assert.ok(result.claims.some((c) => c.kind === 'limitation'));
});

test('quoted conversational event clocks are source validated and stay distinct from observation pins', () => {
  const state = matchState({ kind: 'duel', seed: 2401, time: 60 }),
    input = {
      question: 'What happened with his next attempt?',
      conversation: [
        {
          question: 'What was the first shot?',
          answer: "D. Silva's attempt at 00:42 was blocked.",
          time: 44,
        },
      ],
    };
  const anchor = sourceConversationActionAnchor(input, state);
  assert.ok(anchor);
  for (const question of [
    "What happened after A. Reed's shot?",
    'What happened after the shot by A. Reed?',
    'What happened after that saved shot?',
    'What happened after the attempt at 00:58?',
    'What happened after his pass?',
    'What did Reed do next?',
  ])
    assert.equal(sourceConversationActionAnchor({ ...input, question }, state), null, question);
  assert.ok(
    sourceConversationActionAnchor(
      { ...input, question: 'How many Reed shots were there before that attempt?' },
      state,
    ),
  );
  assert.equal(anchor.time, 42);
  assert.equal(anchor.conversationObservedAt, 44);
  assert.equal(anchor.reference.id, 'comparison-duel-2401-shot-42');
  assert.equal(anchor.reference.revision, 1);
  for (const change of [
    (i) => (i.anchorId = anchor.id),
    (i) => (i.conversation[0].answer += ' The next shot was at 00:58.'),
    (i) => (i.conversation[0].answer = i.conversation[0].answer.replace('blocked', 'saved')),
    (i) => (i.conversation[0].answer = i.conversation[0].answer.replace('D. Silva', 'A. Reed')),
    (i) => (i.conversation[0].time = 40),
  ]) {
    const bad = structuredClone(input);
    change(bad);
    assert.equal(sourceConversationActionAnchor(bad, state), null);
  }
  const duplicate = structuredClone(state);
  duplicate.events.push({ ...duplicate.events.find((e) => e.id === anchor.id), id: 'other-shot' });
  assert.equal(sourceConversationActionAnchor(input, duplicate), null);
  const deleted = structuredClone(state);
  deleted.events.find((e) => e.id === anchor.id).operation = 'delete';
  assert.equal(sourceConversationActionAnchor(input, deleted), null);
  const future = structuredClone(state);
  future.events.find((e) => e.id === anchor.id).arrivedAt = 61;
  assert.equal(sourceConversationActionAnchor(input, future), null);
});

test('complete roster and future-result requests use reviewed source context without event substitutions', async () => {
  const approval = {
    requestedTask: 'roster-inventory',
    requiresOtherInformation: false,
    rosterScope: 'all',
    rosterFields: ['name'],
    reason: 'The request asks for the complete player roster.',
  };
  for (const [question, decision] of [
    ['names of the players', { kind: 'roster-inventory', scope: 'all', fields: ['name'] }],
    ['who will win the match', { kind: 'future-result-limitation' }],
  ]) {
    const input = { kind: 'sustained', seed: 17, time: 0, question },
      plan = {
        answerFocus: 'other',
        explanationTarget: 'none',
        requestedForm: 'fact',
        mentionedPlayers: [],
        decision,
      };
    const mock = sequenceTransport([
      plan,
      (packet) => {
        assert.equal(packet.question, question);
        assert.ok(packet.source);
        return decision.kind === 'roster-inventory'
          ? approval
          : {
              requestedTask: 'future-result',
              requiresOtherInformation: false,
              rosterScope: null,
              rosterFields: [],
              reason: 'The request asks for a prediction, whose honest response is a limitation.',
            };
      },
    ]);
    const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 2);
    assert.equal(result.lookups.length, 0);
    assert.equal(result.moments.length, 0);
    assert.equal(result.provenance.modelGenerated, false);
    if (decision.kind === 'roster-inventory')
      for (const player of matchState(input).frames.at(-1).players)
        assert.ok(result.answer.includes(player.name));
    else {
      assert.match(result.answer, /too early/);
      assert.doesNotMatch(result.answer, /goals|shots|0/);
    }
  }
  const bad = sequenceTransport([
    {
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: { kind: 'roster-inventory', scope: 'all', fields: ['name'] },
    },
    { ...approval, requestedTask: 'mixed', requiresOtherInformation: true },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(
      {
        kind: 'sustained',
        seed: 17,
        time: 120,
        question: 'Who scored, and give me all player names?',
      },
      { config, fetcher: bad.fetcher },
    ),
    (error) => error.code === 'question-context-coverage',
  );
});

test('repeat intent reuses a prior user question at the current time and never an old answer as facts', async () => {
  const input = {
    kind: 'duel',
    seed: 1001,
    time: 102,
    question: 'I would like to revisit my earlier request.',
    conversation: [
      { question: 'who will win the match', answer: 'Harbour will certainly win 9-0.', time: 0 },
    ],
  };
  const plan = (decision) => ({
    answerFocus: 'other',
    explanationTarget: 'none',
    requestedForm: 'fact',
    mentionedPlayers: [],
    decision,
  });
  const mock = sequenceTransport([
    plan({ kind: 'repeat-question', conversationIndex: 0 }),
    (packet) => {
      assert.equal(packet.question, 'who will win the match');
      assert.equal(packet.currentTime, 102);
      return plan({ kind: 'future-result-limitation' });
    },
    {
      requestedTask: 'future-result',
      requiresOtherInformation: false,
      rosterScope: null,
      rosterFields: [],
      reason:
        'The user repeated a prediction request, not a request to repeat the previous answer.',
    },
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.question, input.question);
  assert.equal(result.observedAt, 102);
  assert.equal(result.questionResolution.resolvedQuestion, 'who will win the match');
  assert.equal(result.execution.modelCalls, 3);
  assert.doesNotMatch(result.answer, /9-0|certainly/);
  assert.match(result.answer, /cannot reliably predict/);
  const missing = sequenceTransport([plan({ kind: 'repeat-question', conversationIndex: null })]);
  const clarification = await answerMatchQuestionAI(
    { ...input, conversation: [] },
    { config, fetcher: missing.fetcher },
  );
  assert.equal(clarification.scope, 'clarify');
  assert.equal(clarification.execution.modelCalls, 1);
});

test('relative requests require the actual next-action query and exact earlier-count boundary', () => {
  const input = { kind: 'duel', seed: 2401, time: 60 },
    state = matchState(input),
    anchor = sourceConversationActionAnchor(
      {
        ...input,
        question: 'What happened with his next attempt?',
        conversation: [
          {
            question: 'First attempt?',
            answer: 'D. Silva’s attempt at 00:42 was blocked.',
            time: 44,
          },
        ],
      },
      state,
    );
  const sources = [
    executeMatchQuery(input, { filters: { id: anchor.id }, aggregate: 'list', limit: 1 }),
    executeMatchQuery(input, {
      filters: { type: 'shot', player: anchor.actorId },
      aggregate: 'list',
      order: 'asc',
      limit: 1,
      timeFrom: 42,
      timeFromExclusive: true,
    }),
    executeMatchQuery(input, {
      filters: { type: 'shot', team: 'home' },
      aggregate: 'count',
      timeFrom: 0,
      timeTo: 42,
      timeToExclusive: true,
    }),
  ];
  const question =
      'What happened with his next attempt, and how many shots had Northbridge taken before that blocked effort?',
    binding = { queryIndex: 1, anchor: anchor.reference, relation: 'after', samePlayer: true };
  assert.deepEqual(
    sourceAnchoredPlanIssues(question, anchor, sources, [binding], state.events),
    [],
  );
  assert.ok(
    sourceAnchoredPlanIssues(question, anchor, sources, [], state.events).some(
      (issue) => issue.kind === 'missing-dependent-action-query',
    ),
  );
  const bad = structuredClone(sources);
  bad[2].query.timeFromExclusive = true;
  assert.ok(
    sourceAnchoredPlanIssues(question, anchor, bad, [binding], state.events).some(
      (issue) => issue.kind === 'missing-strict-before-count',
    ),
  );
  assert.ok(
    sourceAnchoredPlanIssues(
      question,
      anchor,
      sources,
      [{ ...binding, anchor: { ...anchor.reference, id: 'another-shot' } }],
      state.events,
    ).length,
  );
  const passInput = {
      kind: 'counter',
      seed: 2403,
      time: 28,
      question:
        "Did Mensah's pass fail because Cole wasn't ready, and who actually got the ball next?",
    },
    passState = matchState(passInput),
    pass = sourceExplicitActionAnchor(passInput, passState);
  assert.ok(pass);
  assert.equal(pass.time, 18);
  const recovery = executeMatchQuery(
    { kind: passInput.kind, seed: passInput.seed, time: passInput.time },
    {
      filters: { type: 'recovery' },
      aggregate: 'list',
      order: 'asc',
      limit: 1,
      timeFrom: 18,
      timeFromExclusive: true,
    },
  );
  assert.equal(recovery.rows[0].player, 'M. Costa');
  assert.deepEqual(
    sourceAnchoredPlanIssues(
      passInput.question,
      pass,
      [recovery],
      [{ queryIndex: 0, anchor: pass.reference, relation: 'after', samePlayer: false }],
      passState.events,
    ),
    [],
  );
  assert.ok(
    sourceAnchoredPlanIssues(passInput.question, pass, [recovery], [], passState.events).length,
  );
  const duplicate = structuredClone(passState);
  duplicate.events.push({ ...duplicate.events.find((e) => e.id === pass.id), id: 'other-pass' });
  assert.equal(sourceExplicitActionAnchor(passInput, duplicate), null);
  assert.equal(
    sourceExplicitActionAnchor({ ...passInput, question: 'Was there a pass?' }, passState),
    null,
  );
  assert.equal(
    sourceExplicitActionAnchor(
      { ...passInput, question: "Who got the ball next after Mensah's pass at 00:25?" },
      passState,
    ),
    null,
  );
  const wrongActor = structuredClone(sources);
  wrongActor[1].query.filters.player = 'home-1';
  assert.ok(sourceAnchoredPlanIssues(question, anchor, wrongActor, [binding], state.events).length);
});

test('source-derived relative queries prove the actual next action without rewriting model filters', () => {
  const input = {
      kind: 'counter',
      seed: 2403,
      time: 28,
      question:
        "Did Mensah's pass fail because Cole wasn't ready, and who actually got the ball next?",
    },
    state = matchState(input),
    anchor = sourceExplicitActionAnchor(input, state),
    run = (query) =>
      executeMatchQuery({ kind: input.kind, seed: input.seed, time: input.time }, query);
  const sources = [run({ filters: { id: anchor.id }, aggregate: 'list', limit: 1 })],
    original = structuredClone(sources[0]),
    relations = [];
  const added = augmentSourceRelativeQueries(input, anchor, sources, relations, state, run);
  assert.equal(added.length, 1);
  assert.deepEqual(sources[0], original);
  assert.equal(sources[1].rows[0].player, 'M. Costa');
  assert.equal(sources[1].rows[0].time, 20);
  assert.equal(relations[0].origin, 'source-derived-relative-obligation');
  assert.equal(relations[0].anchorIdentifiedBy, 'requested-moment');
  assert.deepEqual(augmentSourceRelativeQueries(input, anchor, sources, relations, state, run), []);
  for (const badAnchor of [
    { ...anchor, time: 19 },
    { ...anchor, reference: { ...anchor.reference, revision: 1 } },
  ])
    assert.deepEqual(
      augmentSourceRelativeQueries(input, badAnchor, [original], [], state, run),
      [],
    );
  assert.deepEqual(
    augmentSourceRelativeQueries(
      { ...input, question: input.question.replace('next?', 'next on the left wing?') },
      anchor,
      [original],
      [],
      state,
      run,
    ),
    [],
  );
  const intervening = structuredClone(state);
  intervening.events.push({
    id: 'received-first',
    revision: 1,
    type: 'receive',
    time: 19,
    arrivedAt: 19,
    playerId: 'home-7',
    team: 'home',
  });
  assert.deepEqual(
    augmentSourceRelativeQueries(input, anchor, [original], [], intervening, run),
    [],
  );
});

test('standalone repeats own the prior user intent before score-based evidence planning', async () => {
  const input = {
    kind: 'duel',
    seed: 1001,
    time: 102,
    question: 'same question as last time',
    conversation: [
      {
        question: 'who will win the match',
        answer: 'Both teams have zero goals and zero shots.',
        time: 0,
      },
    ],
  };
  const mock = sequenceTransport([
    (packet) => {
      assert.equal(packet.question, 'who will win the match');
      assert.equal(packet.currentTime, 102);
      return {
        answerFocus: 'other',
        explanationTarget: 'none',
        requestedForm: 'fact',
        mentionedPlayers: [],
        decision: { kind: 'future-result-limitation' },
      };
    },
    {
      requestedTask: 'future-result',
      requiresOtherInformation: false,
      rosterScope: null,
      rosterFields: [],
      reason: 'A standalone forecast request.',
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 2);
  assert.equal(answer.question, input.question);
  assert.equal(answer.questionResolution.answeredAt, 102);
  assert.match(answer.answer, /cannot reliably predict/);
  assert.doesNotMatch(answer.answer, /goals|shots/);
  for (const question of [
    'Please answer my previous question again',
    'same question as last time',
    'la misma pregunta',
    'la même question',
    'a mesma pergunta',
  ])
    assert.equal(
      repeatedUserQuestionReference({ ...input, question }).question,
      'who will win the match',
    );
  for (const question of [
    'same question but for Cole',
    'repeat the last pass',
    'who scored again?',
  ])
    assert.equal(repeatedUserQuestionReference({ ...input, question }), null);
  assert.equal(repeatedUserQuestionReference({ ...input, conversation: [] }).question, null);
  const noCall = await answerMatchQuestionAI(
    { ...input, conversation: [] },
    {
      config,
      fetcher: () => {
        throw new Error('A missing antecedent must not call a model.');
      },
    },
  );
  assert.equal(noCall.execution.modelCalls, 0);
  assert.equal(noCall.scope, 'clarify');
});

test('an exact before-count query can keep its source-validated action anchor internal', () => {
  const input = { kind: 'duel', seed: 2401, time: 60 },
    state = matchState(input),
    anchor = state.events.find((event) => event.time === 42 && event.type === 'shot'),
    question = 'How many shots had Northbridge taken before that blocked effort?';
  const inspected = executeMatchQuery(input, {
      filters: { id: anchor.id },
      aggregate: 'list',
      limit: 1,
    }),
    count = executeMatchQuery(input, {
      filters: { type: 'shot', team: 'home' },
      aggregate: 'by-team',
      timeFrom: 0,
      timeTo: 42,
      timeToExclusive: true,
    });
  const reference = { type: 'event', id: anchor.id, revision: anchor.revision },
    binding = {
      origin: 'source-derived-count-window',
      anchorIdentifiedBy: 'requested-moment',
      anchor: reference,
      anchorTime: 42,
      anchorScope: inspected.scopeReference,
      relation: 'before',
      sameTeam: false,
      samePlayer: false,
      query: count.query,
      scopeReference: count.scopeReference,
      resultEvents: [],
    };
  const packet = {
    question,
    observedAt: 60,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    requestedMoment: { id: anchor.id, time: 42, reference },
    queryResults: [inspected, count],
    requestedEvidence: [count],
    queryRelations: [binding],
  };
  const manifest = buildQuestionFacts(packet),
    fact = manifest.facts.find(
      (f) =>
        f.proof.kind === 'count' &&
        f.proof.metric === 'attempts' &&
        f.proof.subjectId === 'home' &&
        f.proof.timeTo === 42,
    );
  assert.ok(fact);
  const answer = { scope: 'match', claims: [fact.claim] },
    part = {
      requestSpan: question,
      claimIndices: [0],
      answerForm: 'fact',
      requestedAction: 'shot',
      temporalRelation: 'before-requested-event',
      relationAnchorClaimIndex: null,
      relationEntityBinding: 'none',
      relationSourceLinkIndex: null,
      explanationTarget: 'none',
      requestedSourceAttributes: null,
      sourceInventoryDependency: null,
      requestedQuantity: [
        {
          requestSpan: question,
          action: 'shot',
          state: 'any',
          grouping: 'by-team',
          subjectIds: ['home'],
          timeFrom: 0,
          timeTo: 42,
          timeFromExclusive: false,
          timeToExclusive: true,
          qualifiers: null,
        },
      ],
    };
  const review = {
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question,
        responseIntent: {
          purpose: 'fact-retrieval',
          needsAssessment: false,
          needsExplicitCorrection: false,
          needsScoreline: false,
          needsMeasurementLimitation: false,
          reason: 'A strict earlier attempt count.',
        },
        coverage: [part],
      },
      checks: [
        {
          claimIndex: 0,
          supported: true,
          actors: [],
          inventedFacts: [],
          counts: [],
          shotOutcomeAssertions: [],
        },
      ],
    },
    options = { canonicalFactSelection: { proofs: [fact.proof] } };
  assert.deepEqual(reviewRequestAdequacy(review, answer, packet, options), []);
  for (const change of [
    (p) => (p.queryRelations[0].anchorTime = 43),
    (p) => (p.queryRelations[0].anchor = { ...p.queryRelations[0].anchor, id: 'wrong-anchor' }),
    (p) => (p.queryRelations = []),
  ]) {
    const bad = structuredClone(packet);
    change(bad);
    assert.ok(reviewRequestAdequacy(review, answer, bad, options).length);
  }
  const wrongReview = structuredClone(review);
  wrongReview.requestCheck.coverage[0].requestedQuantity[0].timeTo = 41;
  assert.ok(reviewRequestAdequacy(wrongReview, answer, packet, options).length);
});

test('a source uncertainty cannot be offered as an interpretation dependency in a factual action answer', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 70,
    question: 'Did Cole force the mistake, or do we only know he won the ball?',
  };
  let checked = false,
    reviewed = false;
  const mock = sequenceTransport([
    {
      requestedSourceAttributes: null,
      answerFocus: 'other',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: ['J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'recovery', player: 'home-7' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
        ],
      },
    },
    (packet, body) => {
      const boundary = packet.matchFacts.facts.find(
        (f) => f.claim.kind === 'limitation' && f.claim.text.includes('forced the mistake'),
      );
      const event = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.playerId === 'home-7' &&
          !f.selection.attributes,
      );
      assert.ok(boundary && event);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      const interpretations = modes.filter((m) =>
        m.properties.claim?.anyOf?.some((c) => c.properties?.kind?.enum.includes('interpretation')),
      );
      assert.ok(interpretations.length);
      for (const mode of interpretations) {
        assert.ok(mode.properties.factIds.items.enum.includes(event.id));
        assert.ok(
          !mode.properties.factIds.items.enum.includes(boundary.id),
          'an unknown is not evidence for an interpretation',
        );
      }
      assert.ok(
        modes.some(
          (m) =>
            m.properties.mode.enum.includes('facts') &&
            m.properties.factIds.items.enum.includes(boundary.id),
        ),
        'honest uncertainty remains selectable',
      );
      checked = true;
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [event.id, boundary.id] },
        followUp: '',
      };
    },
    (packet) => {
      reviewed = true;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'useful-limitation',
          requestedInformation: input.question,
          reason: 'Recovery is known and forcing remains unknown.',
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0, 1],
            answerForm: 'fact',
            requestedAction: 'ball-win',
          })),
        },
      };
    },
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.ok(checked && reviewed);
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Cole/);
  assert.match(result.answer, /doesn't establish who forced the mistake/);
  assert.doesNotMatch(result.answer, /1 ball win/);
});

test('a comparative explanation uses measured comparisons and a quality boundary without forcing a buildup', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 110,
    question: 'Who has the attacking edge, and do extra shots establish better chances?',
  };
  const plan = {
    requestedSourceAttributes: null,
    answerFocus: 'team-attacking-assessment',
    explanationTarget: 'observed-sequence',
    requestedForm: 'explanation',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'shot' },
          aggregate: 'list',
          order: 'desc',
          limit: 10,
          timeFrom: 0,
          timeTo: 110,
        },
      ],
    },
  };
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.equal(modes.length, 1);
      assert.deepEqual(modes[0].properties.mode.enum, ['explanation']);
      assert.deepEqual(modes[0].properties.claim.properties.kind.enum, ['limitation']);
      const selected = packet.matchFacts.facts.filter((f) =>
        modes[0].properties.factIds.items.enum.includes(f.id),
      );
      assert.equal(selected.length, 2);
      assert.ok(selected.every((f) => f.selection.kind === 'team-comparison'));
      assert.deepEqual(
        new Set(selected.map((f) => f.selection.metric)),
        new Set(['attempts', 'shotsOnTarget']),
      );
      return {
        scope: 'match',
        composition: {
          mode: 'explanation',
          factIds: selected.map((f) => f.id),
          claim: {
            text: 'More attempts alone do not establish better chances.',
            kind: 'limitation',
            evidence: [],
            dependsOn: [],
          },
        },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        reason: 'Measured edge and unavailable quality are separately answered.',
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: i ? [2] : [0, 1],
          answerForm: i ? 'explanation' : 'assessment',
          requestedAction: 'other',
        })),
      },
    }),
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.claims.length, 3);
  assert.match(answer.answer, /better chances/);
  assert.doesNotMatch(answer.answer, /supplied|assist|buildup/i);
});

test('a source identity clarification restores the original cause question without an extra model stage', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 70,
    language: 'en',
    question: 'M. Costa, the one from Harbour Athletic.',
    clarification: {
      question: 'Did Costa lose the ball to Cole, and do we know who forced the mistake?',
      time: 69,
    },
  };
  const mock = sequenceTransport([
    (packet) => {
      assert.match(packet.question, /Did M\. Costa lose/);
      assert.equal(packet.observedAt, 69, 'clarification resumes the original question pin');
      return {
        requestedSourceAttributes: null,
        answerFocus: 'event-actor',
        explanationTarget: 'causal-attribution',
        requestedForm: 'explanation',
        mentionedPlayers: ['M. Costa', 'J. Cole'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'recovery', player: 'home-7' },
              aggregate: 'list',
              order: 'desc',
              limit: 1,
            },
          ],
        },
      };
    },
    (packet, body) => {
      assert.deepEqual(
        resolvedWireSchema(body).properties.premiseCheck.properties.conclusion.enum,
        ['unknown'],
      );
      const event = packet.matchFacts.facts.find(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.playerId === 'home-7' &&
            !f.selection.attributes,
        ),
        boundary = packet.matchFacts.facts.find(
          (f) => f.claim.kind === 'limitation' && f.claim.text.includes('forced the mistake'),
        );
      assert.ok(event && boundary);
      return {
        scope: 'match',
        composition: {
          mode: 'known-limitation',
          contextFactIds: [event.id],
          limitationFactId: boundary.id,
        },
        followUp: '',
      };
    },
    (packet, body) => {
      assert.ok(body.messages[0].content.includes('relationSourceLinkIndex to that exact'));
      return {
        decision: 'approve',
        requestCheck: {
          status: 'useful-limitation',
          requestedInformation: packet.evidence.question,
          reason: 'Actual recovery and missing causal evidence answer the restored question.',
          coverage: packet.requestComponents.map((requestSpan) => ({
            requestSpan,
            claimIndices: [0, 1],
            answerForm: 'explanation',
            requestedAction: 'other',
          })),
        },
      };
    },
  ]);
  const answer = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(answer.execution.modelCalls, 3);
  assert.equal(answer.question, input.question);
  assert.equal(answer.questionResolution.kind, 'source-lineup-clarification');
  assert.equal(answer.observedAt, 69);
  assert.equal(answer.questionResolution.clarifiedAt, 70);
  assert.match(answer.answer, /Cole/);
  assert.match(answer.answer, /doesn't establish/);
});

test('confirmed pass recipients fulfill reception without accepting a failed target or stale proof', () => {
  const source = executeMatchQuery(
    { kind: 'sustained', seed: 17, time: 120 },
    {
      filters: { type: 'pass', result: true },
      aggregate: 'list',
      order: 'desc',
      limit: 1,
      timeFrom: 90,
      timeTo: 120,
    },
  );
  const row = source.rows[0];
  const eventRef = { type: 'event', id: row.id, revision: row.revision };
  const answer = { claims: [{ kind: 'observation', evidence: [eventRef, source.scopeReference] }] };
  const packet = { observedAt: 120, requestedEvidence: [source], queryResults: [source] };
  const selection = {
    proofs: [
      {
        kind: 'ordered-event',
        modelGenerated: false,
        scope: source.scopeReference,
        timeFrom: 90,
        timeTo: 120,
        event: {
          kind: 'event',
          modelGenerated: false,
          eventType: 'pass',
          eventId: row.id,
          revision: row.revision,
          playerId: row.playerId,
          time: row.time,
          actionOutcome: { status: 'completed' },
          recipientStatus: 'confirmed-recipient',
          recipient: { status: 'confirmed-recipient', playerId: row.receiverId },
        },
      },
    ],
  };
  assert.ok(row.receiverId);
  assert.equal(canonicalCompletedReception(0, answer, packet, selection), true);
  assert.equal(canonicalPendingReception(0, answer, packet, selection), false);
  for (const change of [
    (s) => s.proofs[0].event.revision++,
    (s) => (s.proofs[0].event.recipient.playerId = 'away-1'),
    (s) => (s.proofs[0].event.actionOutcome.status = 'pending'),
    (s) => (s.proofs[0].event.recipientStatus = 'recorded-target'),
    (s) => (s.proofs[0].timeFrom = 100),
  ]) {
    const bad = structuredClone(selection);
    change(bad);
    assert.equal(canonicalCompletedReception(0, answer, packet, bad), false);
  }
  for (const value of [false, null, undefined]) {
    const bad = structuredClone(packet);
    bad.requestedEvidence[0].rows[0].result = value;
    assert.equal(canonicalCompletedReception(0, answer, bad, selection), false);
  }
  const stale = structuredClone(packet);
  stale.queryResults[0].rows.push({ ...row, revision: row.revision + 1 });
  assert.equal(canonicalCompletedReception(0, answer, stale, selection), false);
});

test('unknown distance ranking cannot substitute a latest pass or its recipient', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 120,
    question: 'Who completed the longest pass in the last thirty seconds, and who received it?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-actor',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      requestedSourceAttributes: null,
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', result: true },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
            timeFrom: 90,
            timeTo: 120,
          },
        ],
      },
    },
    (packet, body) => {
      const facts = packet.matchFacts.facts;
      const limitation = facts.find(
        (fact) => fact.selection.kind === 'source-measurement-limitation',
      );
      assert.ok(limitation);
      const schema = resolvedWireSchema(body);
      assert.deepEqual(schema.properties.composition.anyOf[0].properties.factIds.items.enum, [
        limitation.id,
      ]);
      assert.equal(schema.properties.composition.anyOf[0].properties.factIds.maxItems, 1);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [limitation.id] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'useful-limitation',
        requestedInformation: input.question,
        reason: 'The ranked winner and its recipient cannot be established.',
        responseIntent: {
          purpose: 'fact-retrieval',
          needsAssessment: false,
          needsExplicitCorrection: false,
          needsScoreline: false,
          needsMeasurementLimitation: true,
          reason: 'Distance ranking is not supported by the tools.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'unavailable-measurement',
          requestedAction: 'other',
          requestedSourceAttributes: null,
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.match(result.answer, /can't establish/);
  assert.doesNotMatch(result.answer, /Latest|Cole|Reed|01:50/);
  assert.equal(result.execution.modelCalls, 3);
});

test('actual match occurrences cannot use a pure shot-category definition route', () => {
  for (const question of [
    'Has either keeper actually made a save, or did those shots just miss?',
    'Did those shots miss?',
    'Have the keepers saved any shots?',
    'Ha parado el portero algun tiro?',
    'Houve remates defendidos?',
  ])
    assert.equal(asksActualMatchOccurrence(question), true, question);
  for (const question of [
    'Is a blocked shot counted as a save?',
    'What does a shot on target mean?',
    'Explain the definition of a saved shot.',
  ])
    assert.equal(asksActualMatchOccurrence(question), false, question);
});

test('unknown ranked pass keeps independent goal identities but not a guessed recipient', () => {
  assert.equal(
    independentRankingContextRequested('Who completed the longest pass, and who scored the goal?'),
    true,
  );
  assert.equal(
    independentRankingContextRequested('Who completed the longest pass, and who received it?'),
    false,
  );
  assert.equal(
    independentRankingContextRequested(
      'Who completed the longest pass, and how many passes were completed?',
    ),
    false,
    'known counts use their separately required canonical facts',
  );
});

test('named-event temporal prefixes remain in coverage components beside later alternatives', () => {
  for (const prefix of [
    'Before Reed scored, had Carter already collected a saved shot',
    'After Costa lost the ball, did Cole recover it',
    'Avant le but de Reed, qui avait récupéré le ballon',
    'Antes del gol de Reed, quién recuperó el balón',
    'Depois do passe de Cole, quem recebeu a bola',
  ]) {
    assert.deepEqual(requestComponents(prefix + ', or was that later?'), [
      prefix + ', or was that later',
    ]);
  }
  assert.deepEqual(requestComponents('Had Carter already collected a saved shot?'), [
    'Had Carter already collected a saved shot',
  ]);
});

test('an exact linked keeper hold proves positive chronology before an ordered goal anchor', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 120,
    question: 'Before Reed scored, had Carter already collected a saved shot, or was that later?',
  };
  let captured, review;
  const mock = sequenceTransport([
    {
      mentionedPlayers: ['A. Reed', 'M. Carter'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: {
              type: 'recovery',
              player: 'away-1',
              recoveryKind: 'goalkeeper-hold',
              linkedShotOutcome: 'saved',
            },
            aggregate: 'list',
            order: 'asc',
            limit: 1,
          },
          {
            filters: { type: 'shot', player: 'home-10', outcome: 'goal' },
            aggregate: 'list',
            order: 'asc',
            limit: 1,
          },
        ],
      },
    },
    (packet) => {
      const hold = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-goalkeeper-hold',
      );
      const goal = packet.matchFacts.facts.find(
        (f) => f.selection.kind === 'ordered-event' && f.selection.metric === 'goals',
      );
      assert.ok(hold);
      assert.ok(goal);
      return {
        scope: 'match',
        composition: { mode: 'facts', factIds: [hold.id, goal.id] },
        followUp: '',
      };
    },
    (packet) => {
      captured = packet;
      review = {
        decision: 'approve',
        requestCheck: {
          requestedInformation: question.question,
          status: 'answered',
          reason: 'Current keeper collection precedes the identified goal.',
          coverage: [
            {
              requestSpan: packet.requestComponents[0],
              claimIndices: [0, 1],
              answerForm: 'fact',
              requestedAction: 'recovery',
              temporalRelation: 'before-requested-event',
              relationAnchorClaimIndex: 1,
              relationEntityBinding: 'none',
            },
          ],
        },
      };
      return review;
    },
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /Carter.*01:38.*Reed.*01:56/);
  assert.equal(result.relationWitnesses[0].relation, 'before');
  assert.equal(result.relationWitnesses[0].witnessTime, 98);
  assert.equal(result.relationWitnesses[0].anchorTime, 116);
  assert.equal(result.relationWitnesses[0].proves, 'positive-existence');
  const check = (r = review, selection = captured.canonicalFactSelection) =>
    reviewRequestAdequacy(r, captured.answer, captured.evidence, {
      canonicalFactSelection: selection,
    });
  assert.deepEqual(check(), []);
  for (const change of [
    (p) => p.proofs[0].revision++,
    (p) => (p.proofs[0].time = 117),
    (p) => (p.proofs[0].modelGenerated = true),
    (p) => (p.proofs[1] = p.proofs[1].event),
  ]) {
    const bad = structuredClone(captured.canonicalFactSelection);
    change(bad);
    assert.ok(check(review, bad).length);
  }
  for (const change of [
    { temporalRelation: 'after-requested-event' },
    { relationEntityBinding: 'same-player' },
    { requestedAction: 'pass' },
  ]) {
    const bad = structuredClone(review);
    Object.assign(bad.requestCheck.coverage[0], change);
    assert.ok(check(bad).length);
  }
});

test('fronted temporal alternatives stay together without collapsing ordinary multipart requests', () => {
  for (const question of [
    'Before the goal, did Cole pass, or did Reed shoot',
    'Avant le but, qui a tiré, ou qui a récupéré le ballon',
    'Antes del gol, quién disparó, o quién recuperó el balón',
    'Depois do gol, quem rematou, ou quem recuperou a bola',
  ])
    assert.deepEqual(requestComponents(question + '?'), [question]);
  assert.deepEqual(requestComponents('Who scored, and who assisted?'), [
    'Who scored',
    'who assisted',
  ]);
  assert.deepEqual(requestComponents('Did Cole help create the goal, or was he just nearby?'), [
    'Did Cole help create the goal',
    'was he just nearby',
  ]);
});

test('temporal alternatives do not collapse later independent role questions', () => {
  const temporal = 'Before Reed scored, had Carter collected a shot';
  const role = 'Cole scored the goal, did he, or was his role different';
  const expected = [temporal, 'Cole scored the goal, did he', 'was his role different'];
  assert.deepEqual(requestComponents(temporal + '? ' + role + '?'), expected);
  assert.deepEqual(
    requestComponents(temporal + ', and did Cole score, or was his role different?'),
    [temporal, 'did Cole score', 'was his role different'],
  );
});

test('a neutral French zero count reaches independent review without a redundant correction rewrite', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 120,
    language: 'fr',
    question:
      'À qui Cole a-t-il donné son dernier ballon réussi, et combien de passes a-t-il ratées depuis le début ?',
  };
  let reviewed = false;
  const responses = [
    {
      mentionedPlayers: ['J. Cole'],
      requestedForm: 'fact',
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', player: 'home-7' },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
          },
          { filters: { type: 'pass', player: 'home-7' }, aggregate: 'count' },
        ],
      },
    },
    (packet) => {
      const pass = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'ordered-event' &&
          f.selection.metric === 'passes' &&
          f.selection.subjectId === 'home-7',
      );
      const zero = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.metric === 'failedPasses' &&
          f.selection.subjectId === 'home-7',
      );
      assert.ok(pass && zero);
      return {
        premiseCheck: {
          questionAssumption: 'Cole missed passes',
          recordedAction: 'Cole has zero failed passes',
          conclusion: 'contradicted',
        },
        scope: 'match',
        composition: { mode: 'facts', factIds: [pass.id, zero.id] },
        followUp: '',
      };
    },
    (packet, body) => {
      assert.ok(
        body.messages
          .find((message) => message.role === 'system')
          .content.includes(quantityPopulationReviewPolicy),
        'The active canonical review receives the population policy',
      );
      reviewed = true;
      return {
        decision: 'approve',
        requestCheck: {
          status: 'answered',
          requestedInformation: question.question,
          responseIntent: {
            purpose: 'fact-retrieval',
            needsAssessment: false,
            needsExplicitCorrection: false,
            needsScoreline: false,
            needsMeasurementLimitation: false,
            reason: 'Neutral count permits zero.',
          },
          coverage: packet.requestComponents.map((requestSpan, index) => ({
            requestSpan,
            claimIndices: [index],
            answerForm: 'fact',
            requestedAction: 'pass',
            temporalRelation: 'none',
            ...(index
              ? {
                  requestedQuantity: [
                    {
                      requestSpan,
                      action: 'pass',
                      state: 'unsuccessful',
                      grouping: 'named-entity',
                      subjectIds: ['home-7'],
                      timeFrom: 0,
                      timeTo: 120,
                      timeFromExclusive: null,
                      timeToExclusive: null,
                      qualifiers: null,
                    },
                  ],
                }
              : {}),
          })),
          reason: 'Recipient and exact player failed-pass count are proved.',
        },
      };
    },
  ];
  const mock = sequenceTransport(responses);
  const answer = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }).catch(
    (error) => assert.fail(JSON.stringify(error.feedback || { message: error.message })),
  );
  assert.equal(reviewed, true);
  assert.equal(answer.execution.modelCalls, 3);
  assert.match(answer.answer, /Cole.*Reed.*01:50/);
  assert.match(answer.answer, /0 passes manquées/);
  const perPlayer = sequenceTransport([
    ...responses.slice(0, 2),
    (packet, body) => {
      const review = responses[2](packet, body);
      review.requestCheck.coverage[1].requestedQuantity[0].grouping = 'by-player';
      return review;
    },
  ]);
  const perPlayerAnswer = await answerMatchQuestionAI(question, {
    config,
    fetcher: perPlayer.fetcher,
  });
  assert.equal(perPlayerAnswer.execution.modelCalls, 3);
  assert.equal(perPlayerAnswer.answer, answer.answer);
  for (const [name, change] of [
    [
      'all players cannot use one player count',
      (review) => {
        Object.assign(review.requestCheck.coverage[1].requestedQuantity[0], {
          grouping: 'by-player',
          subjectIds: [],
        });
      },
    ],
    [
      'missing second requested player',
      (review) => {
        Object.assign(review.requestCheck.coverage[1].requestedQuantity[0], {
          grouping: 'by-player',
          subjectIds: ['home-7', 'away-7'],
        });
      },
    ],
    [
      'player count cannot use wrong outcome',
      (review) => {
        Object.assign(review.requestCheck.coverage[1].requestedQuantity[0], {
          grouping: 'by-player',
          state: 'pending',
        });
      },
    ],
    [
      'player count cannot use wrong window',
      (review) => {
        Object.assign(review.requestCheck.coverage[1].requestedQuantity[0], {
          grouping: 'by-player',
          timeFrom: 30,
        });
      },
    ],

    [
      'explicit correction still required',
      (review) => {
        review.requestCheck.responseIntent.needsExplicitCorrection = true;
      },
    ],
    [
      'wrong player',
      (review) => {
        review.requestCheck.coverage[1].requestedQuantity[0].subjectIds = ['away-7'];
      },
    ],
    [
      'wrong outcome',
      (review) => {
        review.requestCheck.coverage[1].requestedQuantity[0].state = 'pending';
      },
    ],
    [
      'wrong window',
      (review) => {
        review.requestCheck.coverage[1].requestedQuantity[0].timeFrom = 30;
      },
    ],
  ]) {
    const negative = sequenceTransport([
      ...responses.slice(0, 2),
      (packet, body) => {
        const review = responses[2](packet, body);
        change(review);
        return review;
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, {
        config,
        fetcher: negative.fetcher,
        canRepair: () => false,
      }),
      (error) => error.code === 'question-withheld',
      name,
    );
  }
});

for (const [language, question] of [
  ['fr', 'Comment l’action s’est-elle construite avant le tir de Reed à 01:14 ?'],
  ['en', "How did the action develop before Reed's shot at 01:14?"],
]) {
  test(`clock-bound observed sequence selects the exact endpoint with an exclusive predecessor window (${language})`, async () => {
    const input = { kind: 'sustained', seed: 17, time: 80, language, question };
    const state = matchState(input);
    const endpoint = state.events.find((e) => e.type === 'shot' && e.time === 74);
    assert.ok(endpoint);
    let reviewed = false;
    const mock = sequenceTransport([
      {
        answerFocus: 'event-sequence',
        explanationTarget: 'observed-sequence',
        requestedForm: 'explanation',
        mentionedPlayers: ['A. Reed'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: {},
              aggregate: 'list',
              order: 'asc',
              limit: 20,
              timeFrom: 0,
              timeTo: 74,
              timeToExclusive: true,
            },
          ],
        },
      },
      (packet, body) => {
        const stories = packet.matchFacts.facts.filter((f) =>
          ['linked-shot-supply', 'linked-goal-sequence'].includes(f.selection.kind),
        );
        assert.equal(
          stories.length,
          1,
          'Earlier linked shots must not be offered as the requested buildup',
        );
        assert.match(stories[0].text || JSON.stringify(stories[0]), /01:14/);
        assert.ok(
          packet.requestedEvidence.some(
            (s) => s.query.timeTo === 74 && s.query.timeToExclusive === true,
          ),
        );
        const schema = resolvedWireSchema(body);
        assert.equal(
          schema.properties.composition.anyOf.length,
          1,
          'A single explicit endpoint buildup needs only its canonical story, not unrelated global facts or repeated prose',
        );
        const facts = schema.properties.composition.anyOf.find((m) =>
          m.properties.mode.enum.includes('facts'),
        );
        assert.deepEqual(facts.properties.factIds.items.enum, [stories[0].id]);
        assert.equal(facts.properties.factIds.minItems, 1);
        assert.equal(facts.properties.factIds.maxItems, 1);
        assert.deepEqual(Object.keys(facts.properties).sort(), ['factIds', 'mode']);
        return {
          scope: 'match',
          composition: { mode: 'facts', factIds: [stories[0].id] },
          followUp: '',
        };
      },
      (packet) => {
        reviewed = true;
        return {
          decision: 'approve',
          requestCheck: {
            status: 'answered',
            requestedInformation: question,
            coverage: packet.requestComponents.map((requestSpan) => ({
              requestSpan,
              claimIndices: [0],
              answerForm: 'explanation',
              requestedAction: 'other',
              temporalRelation: 'before-requested-event',
              relationAnchorClaimIndex: 0,
              relationEntityBinding: 'same-player',
              relationSourceLinkIndex: null,
              explanationTarget: 'observed-sequence',
            })),
          },
        };
      },
    ]);
    const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 3);
    assert.equal(reviewed, true, 'A source-proved sequence still requires independent review');
    assert.equal(result.canonicalFactSelection.proofs[0].eventId, endpoint.id);
    assert.equal(result.canonicalFactSelection.proofs[0].revision, endpoint.revision);
    assert.equal(
      result.canonicalFactSelection.proofs[0].sequenceBasis,
      'explicit-recovery-pass-reception-shot',
    );
    assert.deepEqual(
      result.claims[0].evidence.map((ref) => [ref.id.split('-').slice(-2).join('-'), ref.revision]),
      [
        ['recovery-66', 1],
        ['pass-68', 2],
        ['receive-72', 1],
        ['shot-74', 1],
      ],
    );
    const binding = result.queryRelations.find(
      (binding) => binding.anchor.id === endpoint.id && binding.relation === 'before',
    );
    assert.equal(binding.anchor.revision, endpoint.revision);
    assert.equal(binding.anchorIdentifiedBy, 'requested-moment');
    assert.equal(binding.sameTeam, true);
    assert.equal(binding.query.filters.id, endpoint.passId);
    assert.equal(binding.query.timeTo, endpoint.time);
    assert.equal(binding.query.timeToExclusive, true);
    assert.ok(binding.resultEvents.some((ref) => ref.id === endpoint.passId));
    const queryInput = { kind: input.kind, seed: input.seed, time: input.time };
    const sources = [
      executeMatchQuery(queryInput, { filters: { id: endpoint.id }, aggregate: 'list', limit: 1 }),
      executeMatchQuery(queryInput, binding.query),
    ];
    const relationPacket = {
      question,
      observedAt: input.time,
      requestedForm: 'explanation',
      explanationTarget: 'observed-sequence',
      roster: state.frames.at(-1).players,
      teams: state.metadata.teams,
      requestedMoment: { time: endpoint.time, reference: binding.anchor },
      requestedEvidence: sources,
      queryResults: sources,
      queryRelations: [binding],
    };
    const relationReview = {
      requestCheck: {
        status: 'answered',
        responseIntent: { purpose: 'explanation' },
        coverage: [
          {
            requestSpan: requestComponents(question)[0],
            claimIndices: [0],
            answerForm: 'explanation',
            explanationTarget: 'observed-sequence',
            requestedAction: 'other',
            temporalRelation: 'before-requested-event',
            relationAnchorClaimIndex: 0,
            relationEntityBinding: 'same-team',
          },
        ],
      },
    };
    const relationIssues = (bindings, packet = relationPacket) =>
      reviewRequestAdequacy(
        relationReview,
        result,
        { ...packet, queryRelations: bindings },
        { canonicalFactSelection: result.canonicalFactSelection },
      ).filter((issue) => /identified anchor/.test(issue.reason));
    assert.deepEqual(relationIssues([binding]), []);
    for (const bad of [
      [],
      [{ ...binding, relation: 'after' }],
      [{ ...binding, sameTeam: false }],
      [{ ...binding, anchor: { ...binding.anchor, revision: binding.anchor.revision + 1 } }],
      [
        {
          ...binding,
          resultEvents: [],
          scopeReference: { type: 'scope', id: 'wrong', revision: 1 },
        },
      ],
    ])
      assert.equal(relationIssues(bad).length, 1);
    assert.match(result.answer, /01:08/);
    assert.match(result.answer, /01:14/);
    assert.match(result.answer, /01:06/);
    assert.match(result.answer, /01:12/);
    assert.doesNotMatch(result.answer, /00:10|00:14|00:16/);
  });
}

test('explicit named shot clocks do not substitute another actor, time, revision or unreceived event', () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    question: "Describe the buildup before Reed's shot at 01:14",
  };
  const state = matchState(input),
    roster = state.frames.at(-1).players;
  const shot = explicitNamedShotAnchor(input, roster, state.events);
  assert.ok(shot && shot.time === 74);
  for (const question of [
    "Describe Cole's shot at 01:14",
    "Describe Reed's shot at 01:13",
    'Describe the shot at 01:14',
  ])
    assert.equal(explicitNamedShotAnchor({ ...input, question }, roster, state.events), null);
  for (const event of [
    { ...shot, arrivedAt: 81 },
    { ...shot, operation: 'delete' },
    { ...shot, time: 75 },
  ])
    assert.equal(explicitNamedShotAnchor(input, roster, [event]), null);
  assert.equal(
    explicitNamedShotAnchor(input, roster, [shot, { ...shot, revision: shot.revision + 1 }]),
    null,
    'Conflicting revisions must not license a sequence',
  );
});

test('a clock-bound sequence rejects a writer selection for an earlier shot without normalization', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question: "How did the action develop before Reed's shot at 01:14?",
  };
  // This is the actual earlier source-linked story that the original writer
  // selected. Its validity for another shot must not license this question.
  const state = matchState(input);
  const source = executeMatchQuery(
    { kind: input.kind, seed: input.seed, time: input.time },
    { filters: {}, aggregate: 'list', limit: 20, timeFrom: 0, timeTo: 74, timeToExclusive: true },
  );
  const manifest = buildQuestionFacts({
    question: input.question,
    roster: state.frames.at(-1).players,
    teams: state.metadata.teams,
    observedAt: 80,
    queryResults: [source],
    requestedEvidence: [source],
  });
  const wrong = manifest.facts.find(
    (f) => f.proof.kind === 'linked-shot-supply' && f.proof.time === 16,
  );
  assert.ok(wrong);
  const draft = {
    scope: 'match',
    composition: { mode: 'facts', factIds: [wrong.id] },
    followUp: '',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-sequence',
      explanationTarget: 'observed-sequence',
      requestedForm: 'explanation',
      mentionedPlayers: ['A. Reed'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: {},
            aggregate: 'list',
            limit: 20,
            timeFrom: 0,
            timeTo: 74,
            timeToExclusive: true,
          },
        ],
      },
    },
    draft,
    draft,
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }),
    (error) => error.code === 'question-invalid-fact-selection',
  );
  assert.equal(mock.count(), 2);
});

test('a bare clock team buildup keeps source-scoped sequence facts without inventing a named-shot endpoint', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question: 'How did Northbridge build the action after 01:00?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'event-sequence',
      explanationTarget: 'observed-sequence',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { team: 'home' },
            aggregate: 'list',
            order: 'asc',
            limit: 20,
            timeFrom: 60,
            timeTo: 80,
            timeFromExclusive: true,
            timeToExclusive: false,
          },
        ],
      },
    },
    (packet, body) => {
      const story = packet.matchFacts.facts.find((f) => f.selection.kind === 'linked-shot-supply');
      assert.ok(story, 'A window clock alone must not remove otherwise verified buildup stories');
      assert.ok(
        resolvedWireSchema(body).properties.composition.anyOf.length > 1,
        'Team buildup windows retain their broader composition choices',
      );
      assert.ok(
        !packet.queryRelations?.some(
          (binding) => binding.anchorIdentifiedBy === 'requested-moment',
        ),
      );
      return { scope: 'match', composition: { mode: 'facts', factIds: [story.id] }, followUp: '' };
    },
    { decision: 'approve' },
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.match(result.answer, /01:14/);
  assert.match(result.answer, /01:08/);
});

test('failure diagnostics identify a failed claim-support predicate despite reviewer approval without recording prose', async () => {
  const diagnostics = [];
  const mock = directTransport(
    { draft, queries: [] },
    {
      decision: 'approve',
      reason: 'PRIVATE_REVIEW_REASON',
      checks: draft.claims.map((_, claimIndex) => ({
        claimIndex,
        actors: [],
        inventedFacts: [],
        counts: [],
        shotOutcomeAssertions: [],
        supported: false,
        reason: 'PRIVATE_REVIEW_REASON',
      })),
    },
  );
  await assert.rejects(
    answerMatchQuestionAI(input, {
      config,
      fetcher: mock.fetcher,
      onDiagnostic: (event) => diagnostics.push(event),
    }),
    (error) => error.code === 'question-withheld',
  );
  const review = diagnostics.find((event) => event.type === 'review');
  assert.ok(review);
  assert.equal(review.decision, 'approve');
  assert.equal(review.reviewComplete, false);
  assert.equal(review.predicates.claimSupport, false);
  assert.equal(review.actorIssueCount, 0);
  assert.equal(review.countIssueCount, 0);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.type === 'stage' && event.stage === 'review' && event.outcome === 'completed',
    ),
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_REVIEW_REASON/);
});

test('a qualitative standout pick and its supporting why recover the actual contradictory planner classification', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question: 'Who’s standing out so far, and why?',
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'player-assessment',
      explanationTarget: 'decision-rationale',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', result: true },
            aggregate: 'by-player',
            groupOrder: 'count-desc',
            order: 'desc',
            limit: 3,
            timeFrom: 0,
            timeTo: 80,
          },
        ],
      },
    },
    (packet, body) => {
      assert.equal(packet.requestedForm, 'assessment');
      assert.equal(packet.explanationTarget, 'other');
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.deepEqual(
        [...new Set(modes.map((mode) => mode.properties.mode.enum[0]))],
        ['player-pick'],
      );
      const fact = packet.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.claim.text.includes('J. Cole') &&
          f.claim.text.includes('completed'),
      );
      assert.ok(fact);
      return {
        scope: 'match',
        composition: { mode: 'player-pick', playerId: 'home-7', factIds: [fact.id] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsScoreline: false,
          needsMeasurementLimitation: false,
          reason: 'The supporting reason is an observed contribution for a provisional pick.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
          answerForm: 'assessment',
          requestedAction: 'other',
          explanationTarget: 'other',
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.execution.repairs, 0);
  assert.equal(result.claims.length, 2);
  assert.equal(result.aiSelectedJudgment.playerId, 'home-7');
  assert.match(result.answer, /my pick so far is J\. Cole/i);
  assert.match(result.answer, /completed/);
  assert.doesNotMatch(result.answer, /significant|leading|intention|wanted|forced/i);
});

for (const questionText of [
  'Who is standing out, and why did Reed choose to shoot?',
  'Who has been best, and could Reed have passed instead?',
])
  test(`a qualitative pick cannot normalize away a separate motive or alternative: ${questionText}`, async () => {
    const question = {
      kind: 'sustained',
      seed: 17,
      time: 80,
      language: 'en',
      question: questionText,
    };
    const mock = sequenceTransport([
      {
        answerFocus: 'player-assessment',
        explanationTarget: 'decision-rationale',
        requestedForm: 'explanation',
        mentionedPlayers: ['A. Reed'],
        decision: {
          kind: 'queries',
          queries: [
            {
              filters: { type: 'shot', player: 'A. Reed' },
              aggregate: 'list',
              order: 'desc',
              limit: 1,
            },
          ],
        },
      },
      (packet) => {
        assert.equal(packet.requestedForm, 'explanation');
        assert.equal(packet.explanationTarget, 'decision-rationale');
        const shot = packet.matchFacts.facts.find(
          (f) => f.selection.kind === 'event' && f.selection.eventType === 'shot',
        );
        assert.ok(shot);
        return {
          scope: 'match',
          composition: {
            mode: 'explanation',
            factIds: [shot.id],
            claim: {
              text: 'He intended to avoid pressure.',
              kind: 'interpretation',
              evidence: [],
              dependsOn: [0],
            },
          },
          followUp: '',
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher }),
      (error) =>
        error.code === 'question-invalid-fact-selection' &&
        /unrecorded player rationale/.test(error.message),
    );
    assert.equal(mock.count(), 2);
  });

test('player-pick schema binds every player to own positive facts and preserves that boundary after a rejected mismatched pick', async () => {
  const question = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question: 'Who’s standing out so far, and why?',
  };
  let wrongShotId, ownContribution;
  const assertBound = (packet, body) => {
    const evidence = packet.evidence || packet;
    const modes = resolvedWireSchema(body).properties.composition.anyOf;
    assert.ok(modes.length > 1, 'Offer actual eligible players, not a predetermined answer');
    assert.ok(modes.every((mode) => mode.properties.mode.enum[0] === 'player-pick'));
    const facts = evidence.matchFacts.facts;
    for (const mode of modes) {
      const [playerId] = mode.properties.playerId.enum;
      assert.equal(mode.properties.playerId.enum.length, 1);
      for (const factId of mode.properties.factIds.items.enum) {
        const fact = facts.find((f) => f.id === factId);
        assert.ok(fact);
        const owner =
          fact.selection.kind === 'credited-goal-assist'
            ? fact.selection.assisterId
            : fact.selection.subjectId || fact.selection.playerId;
        assert.equal(
          owner,
          playerId,
          'Every schema-permitted contribution must belong to the chosen player',
        );
      }
      assert.equal(mode.properties.factIds.minItems, 1);
      assert.equal(mode.properties.factIds.maxItems, 1);
    }
    return evidence;
  };
  const mock = sequenceTransport([
    {
      answerFocus: 'player-assessment',
      explanationTarget: 'decision-rationale',
      requestedForm: 'explanation',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          { filters: {}, aggregate: 'list', order: 'asc', limit: 20, timeFrom: 0, timeTo: 80 },
        ],
      },
    },
    (packet, body) => {
      const evidence = assertBound(packet, body);
      wrongShotId = evidence.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.subjectId === 'home-10' &&
          f.selection.metric === 'attempts',
      ).id;
      const cole = resolvedWireSchema(body).properties.composition.anyOf.find((mode) =>
        mode.properties.playerId.enum.includes('home-7'),
      );
      assert.ok(!cole.properties.factIds.items.enum.includes(wrongShotId));
      return {
        scope: 'match',
        composition: { mode: 'player-pick', playerId: 'home-7', factIds: [wrongShotId] },
        followUp: '',
      };
    },
    (packet, body) => {
      assert.match(packet.feedback.reason, /own contribution/);
      const evidence = assertBound(packet, body);
      ownContribution = evidence.matchFacts.facts.find(
        (f) =>
          f.selection.kind === 'count' &&
          f.selection.subjectId === 'home-7' &&
          f.selection.metric === 'ballWins',
      ).id;
      return {
        scope: 'match',
        composition: { mode: 'player-pick', playerId: 'home-7', factIds: [ownContribution] },
        followUp: '',
      };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        responseIntent: {
          purpose: 'assessment',
          needsAssessment: true,
          needsExplicitCorrection: false,
          needsScoreline: false,
          needsMeasurementLimitation: false,
          reason: 'A provisional pick supported by that player’s own recorded contribution.',
        },
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0, 1],
          answerForm: 'assessment',
          requestedAction: 'other',
          explanationTarget: 'other',
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(question, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.equal(result.aiSelectedJudgment.playerId, 'home-7');
  assert.equal(result.canonicalFactSelection.proofs[0].factId, ownContribution);
  assert.match(result.answer, /ball wins/);
  assert.match(result.answer, /my pick so far/i);
  assert.doesNotMatch(result.answer, /possession|influence|Reed|leading|significant/i);
});

for (const [answerFocus, explanationTarget] of [
  ['player-performance', 'statistic-definition'],
  ['event-actor', 'none'],
  ['player-performance', 'observed-sequence'],
])
  test(`ranking plus shot outcomes keeps Azure-valid reference enums and complete current facts (${answerFocus})`, async () => {
    const question = {
      kind: 'sustained',
      seed: 17,
      time: 80,
      language: 'en',
      question: 'Who’s had the most shots so far, and how did they turn out?',
    };

    const mock = sequenceTransport(
      [
        {
          answerFocus,
          explanationTarget,
          requestedForm: 'fact',
          mentionedPlayers: [],
          decision: {
            kind: 'queries',
            queries: [
              {
                filters: { type: 'shot' },
                aggregate: 'by-player',
                order: 'desc',
                limit: 1,
                timeFrom: 0,
                timeTo: 80,
              },
            ],
          },
        },
        (packet, body) => {
          assert.equal(
            packet.explanationTarget,
            explanationTarget === 'statistic-definition' ? 'none' : explanationTarget,
          );
          assert.equal(packet.requestedForm, 'fact');
          const rank = packet.matchFacts.facts.find(
            (f) => f.selection.kind === 'player-count-ranking' && f.selection.metric === 'attempts',
          );
          assert.ok(
            rank,
            'Canonical executed count-desc order must recover the complete tied-leader proof even when nullable planner groupOrder was absent',
          );
          const shots = packet.matchFacts.facts.filter(
            (f) =>
              f.selection.kind === 'event' &&
              f.selection.eventType === 'shot' &&
              f.selection.playerId === 'home-10' &&
              !f.selection.attributes,
          );
          assert.equal(shots.length, 2);
          const modes = resolvedWireSchema(body).properties.composition.anyOf;
          assert.equal(modes.length, 1);
          assert.deepEqual(modes[0].properties.mode.enum, ['facts']);
          assert.equal(modes[0].properties.factIds.minItems, 3);
          assert.equal(modes[0].properties.factIds.maxItems, 3);
          assert.deepEqual(
            [...modes[0].properties.factIds.items.enum].sort(),
            [rank.id, ...shots.map((f) => f.id)].sort(),
          );
          assert.ok(
            modes.some((mode) =>
              [rank.id, ...shots.map((fact) => fact.id)].every((id) =>
                mode.properties.factIds?.items.enum?.includes(id),
              ),
            ),
            'Resolving the required-ranking enum must retain allowed outcome facts for the other component',
          );
          return {
            scope: 'match',
            composition: { mode: 'facts', factIds: [rank.id, ...shots.map((f) => f.id)] },
            followUp: '',
          };
        },
        (packet) => ({
          decision: 'approve',
          reason: 'Complete canonical ranking and current outcomes.',
          checks: packet.answer.claims.map((claim, claimIndex) => ({
            claimIndex,
            supported: true,
            reason: 'Exact canonical facts are supported.',
            actors: [],
            counts: [],
            inventedFacts: [],
            shotOutcomeAssertions: claim.text.includes('blocked') ? ['blocker-identity'] : [],
          })),
          requestCheck: {
            status: 'answered',
            requestedInformation: question.question,
            responseIntent: {
              purpose: 'fact-retrieval',
              needsAssessment: false,
              needsExplicitCorrection: false,
              needsScoreline: false,
              needsMeasurementLimitation: false,
              reason:
                'A complete ranking and the ranked player’s received shot outcomes answer both factual parts.',
            },
            coverage: packet.requestComponents.map((requestSpan, i) => ({
              requestSpan,
              claimIndices: i ? [1, 2] : [0],
              answerForm: 'fact',
              requestedAction: 'shot',
              explanationTarget: 'none',
              requestedQuantity: i
                ? [
                    {
                      requestSpan,
                      action: 'shot',
                      state: 'any',
                      grouping: 'by-player',
                      subjectIds: ['home-10'],
                      timeFrom: 0,
                      timeTo: 80,
                      timeFromExclusive: null,
                      timeToExclusive: null,
                      qualifiers: null,
                    },
                  ]
                : null,
            })),
          },
        }),
      ],
      (packet, call, body) => {
        const checkRefs = (node, path = '$') => {
          if (!node || typeof node !== 'object') return;
          if (Number.isInteger(node.minItems) && Number.isInteger(node.maxItems))
            assert.ok(node.minItems <= node.maxItems, `Invalid array bounds at ${path}`);
          if (Object.hasOwn(node, '$ref'))
            assert.ok(!Object.hasOwn(node, 'enum'), `Azure rejects $ref plus enum at ${path}`);
          for (const [key, value] of Object.entries(node)) checkRefs(value, path + '.' + key);
        };
        checkRefs(body.response_format.json_schema.schema);
        if (call === 2) {
          const schema = resolvedWireSchema(body);
          const variants = schema.properties.checks.items.anyOf;
          for (const variant of variants.filter((v) => v.properties.claimIndex.enum[0] > 0))
            assert.equal(variant.properties.shotOutcomeAssertions.maxItems, 0);
          const coverage = schema.properties.requestCheck.properties.coverage.items.anyOf;
          const outcome = coverage.find(
            (v) => v.properties.requestSpan.enum[0] === 'how did they turn out',
          );
          assert.ok(outcome);
          assert.equal(outcome.properties.requestedQuantity.type, 'null');
        }
        if (!call)
          assert.ok(
            !resolvedWireSchema(body).properties.explanationTarget.enum.includes(
              'statistic-definition',
            ),
          );
      },
    );
    const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
    assert.equal(result.execution.modelCalls, 3);
    assert.equal(result.execution.planningRepairs, 0);
    assert.equal(result.execution.repairs, 0);
    assert.equal(result.canonicalFactSelection.proofs[0].kind, 'player-count-ranking');
    assert.equal(result.claims.length, 3);
    assert.match(result.answer, /A\. Reed/);
    assert.match(result.answer, /off.target/i);
    assert.match(result.answer, /blocked/i);
    assert.doesNotMatch(result.answer, /definition|intention|wanted|chance quality/i);
  });

for (const language of ['fr', 'en'])
  test(`complete named endpoint story remains one canonical claim through semantic repair (${language})`, async () => {
    const question = {
      kind: 'sustained',
      seed: 17,
      time: 80,
      language,
      question:
        language === 'fr'
          ? 'Comment l’action s’est-elle construite avant le tir de Reed à 01:14 ?'
          : "How did the action develop before Reed's shot at 01:14?",
    };
    const plan = {
      answerFocus: 'event-sequence',
      requestedForm: 'explanation',
      explanationTarget: 'observed-sequence',
      mentionedPlayers: ['A. Reed'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: {},
            aggregate: 'list',
            order: 'asc',
            limit: 20,
            timeFrom: 0,
            timeTo: 74,
            timeToExclusive: true,
          },
        ],
      },
    };
    let storyId;
    const choose = (packet, body) => {
      const evidence = packet.evidence || packet;
      const story = evidence.matchFacts.facts.find(
        (f) => f.selection.kind === 'linked-shot-supply' && f.selection.time === 74,
      );
      assert.ok(story);
      storyId ||= story.id;
      assert.equal(story.id, storyId);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.equal(modes.length, 1);
      assert.deepEqual(modes[0].properties.mode.enum, ['facts']);
      assert.deepEqual(modes[0].properties.factIds.items.enum, [storyId]);
      assert.equal(modes[0].properties.factIds.maxItems, 1);
      assert.equal(modes[0].properties.factIds.minItems, 1);
      return { scope: 'match', composition: { mode: 'facts', factIds: [storyId] }, followUp: '' };
    };
    const approve = (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: question.question,
        coverage: packet.requestComponents.map((requestSpan) => ({
          requestSpan,
          claimIndices: [0],
          answerForm: 'explanation',
          requestedAction: 'other',
          explanationTarget: 'observed-sequence',
          temporalRelation: 'before-requested-event',
          relationAnchorClaimIndex: 0,
          relationEntityBinding: 'same-team',
          relationSourceLinkIndex: null,
        })),
      },
    });
    const mock = sequenceTransport([
      plan,
      choose,
      (packet) => ({
        ...approve(packet),
        decision: 'withhold',
        reason: 'Forced semantic review rejection for repair-boundary regression.',
      }),
      choose,
      approve,
    ]);
    const result = await answerMatchQuestionAI(question, {
      config,
      fetcher: mock.fetcher,
      canRepair: () => true,
    });
    assert.equal(result.execution.modelCalls, 5);
    assert.equal(result.execution.repairs, 1);
    assert.equal(result.claims.length, 1);
    assert.equal(result.claims[0].kind, 'observation');
    assert.equal(result.claims[0].evidence.length, 4);
    assert.equal(result.canonicalFactSelection.selectedFactIds.length, 1);
    assert.doesNotMatch(result.answer, /short|standard|courte|00:10|00:14/);
    const invalid = sequenceTransport([
      plan,
      choose,
      (packet) => ({ ...approve(packet), decision: 'withhold', reason: 'Force repair.' }),
      (packet, body) => {
        choose(packet, body);
        return {
          scope: 'match',
          composition: {
            mode: 'explanation',
            factIds: [storyId],
            claim: {
              kind: 'interpretation',
              text: 'A repeated account of the same action.',
              evidence: [],
              dependsOn: [0],
            },
          },
          followUp: '',
        };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: invalid.fetcher, canRepair: () => true }),
      (error) =>
        error.code === 'question-invalid-fact-selection' &&
        /single current canonical story/.test(error.message),
    );
    assert.equal(invalid.count(), 4);
  });

test('a closed endpoint story cannot erase requested event fields, source attributes, measurement or intent', () => {
  const base = { question: "How did the action develop before Reed's shot at 01:14?" };
  assert.equal(endpointStoryExtraRequirements(base), false);
  for (const question of [
    "Describe the pass technique before Reed's shot at 01:14",
    'Explique la construction avec le pied utilisé avant le tir à 01:14',
    'Describe el tipo de pase antes del tiro a 01:14',
    'Descreva a técnica do passe antes do remate aos 01:14',
    'Why did Reed choose the shot at 01:14?',
  ])
    assert.equal(endpointStoryExtraRequirements({ question }), true, question);
  assert.equal(
    endpointStoryExtraRequirements({
      ...base,
      requestedSourceAttributes: [{ source: 'roster', sourceField: 'number' }],
    }),
    true,
  );
  assert.equal(
    endpointStoryExtraRequirements({
      ...base,
      requiredResponseForms: [{ answerForm: 'unavailable-measurement' }],
    }),
    true,
  );
  assert.equal(
    endpointStoryExtraRequirements({
      ...base,
      requestedEvidence: [{ query: { filters: { bodyPart: 'left-foot' } } }],
    }),
    true,
  );
});

for (const extra of ['event-field', 'roster-field', 'multipart'])
  test(`endpoint story schema preserves separate ${extra} requirements`, async () => {
    const question = {
      kind: 'sustained',
      seed: 17,
      time: 80,
      language: 'en',
      question:
        extra === 'event-field'
          ? "Describe the buildup with its pass technique before Reed's shot at 01:14?"
          : extra === 'roster-field'
            ? "Describe the buildup with Cole's shirt number before Reed's shot at 01:14?"
            : "How did the action develop before Reed's shot at 01:14, and how many passes has Cole completed?",
    };
    const spans = requestComponents(question.question);
    const attrs =
      extra === 'roster-field'
        ? [
            {
              requestSpan: spans[0],
              source: 'roster',
              sourceField: 'number',
              actorRole: 'none',
              linkage: 'none',
            },
          ]
        : null;
    const plan = {
      answerFocus: 'event-sequence',
      requestedForm: 'explanation',
      explanationTarget: 'observed-sequence',
      requestedSourceAttributes: attrs,
      mentionedPlayers: ['A. Reed', 'J. Cole'],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: {},
            aggregate: 'list',
            order: 'asc',
            limit: 20,
            timeFrom: 0,
            timeTo: 74,
            timeToExclusive: true,
          },
        ],
      },
    };
    let observed;
    const mock = sequenceTransport([
      plan,
      (packet, body) => {
        observed = { packet, schema: resolvedWireSchema(body) };
        return { scope: 'match', composition: { mode: 'facts', factIds: [] }, followUp: '' };
      },
    ]);
    await assert.rejects(
      answerMatchQuestionAI(question, { config, fetcher: mock.fetcher, canRepair: () => false }),
    );
    assert.ok(observed);
    assert.equal(mock.count(), 2);
    const modes = observed.schema.properties.composition.anyOf;
    assert.ok(
      modes.length > 1 ||
        modes[0].properties.mode.enum[0] !== 'facts' ||
        modes[0].properties.factIds.maxItems !== 1,
      'A complete sequence alone cannot close a separate requested obligation',
    );
    if (attrs) assert.deepEqual(observed.packet.requestedSourceAttributes, attrs);
    if (extra === 'multipart') assert.equal(observed.packet.requestComponents.length, 2);
  });

test('ranked outcome repair cannot replace a missing attempt with the actual unrelated supply fact', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question: 'Who’s had the most shots so far, and how did they turn out?',
  };
  const plan = {
    requestedForm: 'fact',
    explanationTarget: 'observed-sequence',
    answerFocus: 'player-performance',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'shot' },
          aggregate: 'by-player',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 80,
        },
      ],
    },
  };
  let required;
  const choose = (packet, body, bad) => {
    const facts = (packet.evidence || packet).matchFacts.facts,
      rank = facts.find(
        (f) => f.selection.kind === 'player-count-ranking' && f.selection.metric === 'attempts',
      ),
      shots = facts.filter(
        (f) =>
          f.selection.kind === 'event' &&
          f.selection.eventType === 'shot' &&
          f.selection.playerId === 'home-10' &&
          !f.selection.attributes,
      ),
      supply = facts.find(
        (f) => f.selection.kind === 'linked-shot-supply' && f.selection.time === 74,
      );
    assert.equal(
      supply,
      undefined,
      'Closed writer catalog removes the source supply fact that replaced the missing attempt in the real V7 response',
    );
    assert.equal(shots.length, 2);
    required = [rank.id, ...shots.map((f) => f.id)];
    const modes = resolvedWireSchema(body).properties.composition.anyOf;
    assert.equal(modes.length, 1);
    assert.deepEqual([...modes[0].properties.factIds.items.enum].sort(), [...required].sort());
    assert.ok(!modes[0].properties.factIds.items.enum.includes('fact-b38e4cc0283e81e3'));
    assert.equal(modes[0].properties.factIds.maxItems, 3);
    if (!bad) assert.match(packet.feedback.reason, /every distinct current attempt/);
    return {
      scope: 'match',
      composition: {
        mode: 'facts',
        factIds: bad
          ? [
              rank.id,
              'fact-b27133598daf9ac4',
              shots.find((f) => f.selection.time === 74).id,
              'fact-b38e4cc0283e81e3',
            ]
          : required,
      },
      followUp: '',
    };
  };
  const mock = sequenceTransport([
    plan,
    (p, b) => choose(p, b, true),
    (p, b) => choose(p, b, false),
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: i ? [1, 2] : [0],
          answerForm: 'fact',
          requestedAction: 'shot',
          explanationTarget: 'none',
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.execution.modelCalls, 4);
  assert.equal(result.execution.repairs, 1);
  assert.equal(result.claims.length, 3);
  assert.deepEqual([...result.canonicalFactSelection.selectedFactIds].sort(), [...required].sort());
  assert.match(result.answer, /off.target/i);
  assert.match(result.answer, /blocked/i);
  assert.doesNotMatch(result.answer, /assist|supplied|Cole/i);
});

test('ranked outcome schema retains a separate explicitly requested completed-pass total', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question:
      'Who has the most shots and how did they turn out and how many completed passes have both teams made?',
  };
  const plan = {
    requestedForm: 'fact',
    explanationTarget: 'none',
    answerFocus: 'event-actor',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'shot' },
          aggregate: 'by-player',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 80,
        },
        { filters: { type: 'pass', result: true }, aggregate: 'count', timeFrom: 0, timeTo: 80 },
      ],
    },
  };
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      const facts = packet.matchFacts.facts,
        rank = facts.find(
          (f) => f.selection.kind === 'player-count-ranking' && f.selection.metric === 'attempts',
        ),
        shots = facts.filter(
          (f) =>
            f.selection.kind === 'event' &&
            f.selection.eventType === 'shot' &&
            f.selection.playerId === 'home-10' &&
            !f.selection.attributes,
        ),
        passes = facts.find(
          (f) =>
            f.selection.kind === 'count' &&
            f.selection.metric === 'completedPasses' &&
            f.selection.subjectId === null &&
            f.selection.timeFrom === 0 &&
            f.selection.timeTo === 80,
        );
      assert.ok(passes);
      assert.ok(rank);
      assert.equal(shots.length, 2);
      const selected = [rank.id, ...shots.map((f) => f.id), passes.id];
      assert.equal(selected.length, 4);
      const modes = resolvedWireSchema(body).properties.composition.anyOf;
      assert.ok(
        modes.some(
          (m) =>
            m.properties.factIds.maxItems >= 4 &&
            selected.every((id) => m.properties.factIds.items.enum.includes(id)),
        ),
      );
      return { scope: 'match', composition: { mode: 'facts', factIds: selected }, followUp: '' };
    },
    (packet) => ({
      decision: 'approve',
      requestCheck: {
        status: 'answered',
        requestedInformation: input.question,
        coverage: packet.requestComponents.map((requestSpan, i) => ({
          requestSpan,
          claimIndices: i === 0 ? [0] : i === 1 ? [1, 2] : [3],
          answerForm: 'fact',
          requestedAction: i === 2 ? 'pass' : 'shot',
          explanationTarget: 'none',
          requestedQuantity:
            i === 2
              ? [
                  {
                    requestSpan,
                    action: 'pass',
                    state: 'completed',
                    grouping: 'combined',
                    subjectIds: [],
                    timeFrom: 0,
                    timeTo: 80,
                    timeFromExclusive: null,
                    timeToExclusive: null,
                    qualifiers: null,
                  },
                ]
              : null,
        })),
      },
    }),
  ]);
  const result = await answerMatchQuestionAI(input, { config, fetcher: mock.fetcher }).catch((e) =>
    assert.fail(
      JSON.stringify({ code: e.code, message: e.message, issues: e.feedback?.requestAdequacy }),
    ),
  );
  assert.equal(result.execution.modelCalls, 3);
  assert.equal(result.claims.length, 4);
  assert.ok(
    result.canonicalFactSelection.proofs.some(
      (p) => p.kind === 'count' && p.metric === 'completedPasses' && p.subjectId === null,
    ),
  );
});

test('embedded outcome attributes keep the open schema instead of an outcome-only answer', async () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 80,
    language: 'en',
    question: 'Who has the most shots and how did they turn out including the body part used?',
  };
  const plan = {
    requestedForm: 'fact',
    explanationTarget: 'none',
    answerFocus: 'event-actor',
    mentionedPlayers: [],
    decision: {
      kind: 'queries',
      queries: [
        {
          filters: { type: 'shot' },
          aggregate: 'by-player',
          order: 'desc',
          limit: 1,
          timeFrom: 0,
          timeTo: 80,
        },
      ],
    },
  };
  let captured;
  const mock = sequenceTransport([
    plan,
    (packet, body) => {
      captured = { packet, schema: resolvedWireSchema(body) };
      return { scope: 'match', composition: { mode: 'facts', factIds: [] }, followUp: '' };
    },
  ]);
  await assert.rejects(
    answerMatchQuestionAI(input, { config, fetcher: mock.fetcher, canRepair: () => false }),
  );
  assert.ok(captured);
  assert.equal(captured.packet.requestComponents.length, 2);
  assert.ok(
    captured.schema.properties.composition.anyOf.some(
      (mode) =>
        mode.properties.factIds?.maxItems > 3 || mode.properties.factIds?.items.enum?.length > 3,
    ),
  );
});

test('compact recipient contract survives actual seven-field planning and independent review in two calls', async () => {
  const question = {
    kind: 'quiet',
    seed: 73,
    time: 120,
    language: 'pt',
    question: 'Quem recebeu o último passe certo da equipa da casa? Só o nome e o minuto.',
  };
  let reviewed = false;
  const mock = directTransport(
    {
      eventPresentation: { role: 'recipient', fields: ['name', 'time'] },
      requestedSourceAttributes: null,
      answerFocus: 'event-actor',
      explanationTarget: 'none',
      requestedForm: 'fact',
      mentionedPlayers: [],
      decision: {
        kind: 'queries',
        queries: [
          {
            filters: { type: 'pass', team: 'home', result: true },
            aggregate: 'list',
            order: 'desc',
            limit: 1,
            timeFrom: 0,
            timeTo: 120,
          },
        ],
      },
    },
    { decision: 'approve' },
    (packet, call) => {
      if (call === 1) {
        reviewed = true;
        assert.equal(packet.answer.claims[0].text, 'D. Hughes · 01:40.');
      }
    },
  );
  const result = await answerMatchQuestionAI(question, { config, fetcher: mock.fetcher });
  assert.equal(result.answer, 'D. Hughes · 01:40.');
  assert.equal(mock.count(), 2);
  assert.equal(reviewed, true);
});
