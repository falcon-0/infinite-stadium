import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneUncoveredCanonicalFacts } from './question-coverage-pruning.js';

const fact = (id) => ({
  text: `Verified fact ${id}.`,
  kind: 'observation',
  evidence: [{ type: 'event', id, revision: 1 }],
});
function fixture() {
  const ids = ['shot', 'pass'];
  const answer = {
    scope: 'match',
    claims: [
      ...ids.map(fact),
      { text: 'The speed is not recorded.', kind: 'limitation', evidence: [] },
    ],
    canonicalFactSelection: {
      version: 'question-facts-v1',
      sourceFingerprint: 'source',
      requestedFactIds: ids,
      selectedFactIds: ids,
      originalToSelectedIndex: [0, 1],
      normalizations: [],
      dependencyMappings: [],
      proofs: ids.map((factId) => ({ factId, kind: 'event', eventId: factId })),
    },
    claimProvenance: ids
      .map((factId, claimIndex) => ({
        claimIndex,
        factId,
        source: 'verified-query-fact',
        modelGenerated: false,
      }))
      .concat({ claimIndex: 2, source: 'model-interpretation', modelGenerated: true }),
  };
  const review = {
    decision: 'approve',
    requestCheck: {
      status: 'answered',
      coverage: [
        {
          requestSpan: 'Speed?',
          claimIndices: [2],
          answerForm: 'unavailable-measurement',
          requestedAction: 'shot',
          temporalRelation: 'none',
          relationAnchorClaimIndex: 2,
          relationEntityBinding: 'same-player',
        },
        {
          requestSpan: 'Shooter?',
          claimIndices: [0],
          answerForm: 'fact',
          requestedAction: 'shot',
          temporalRelation: 'none',
          relationAnchorClaimIndex: 0,
          relationEntityBinding: 'none',
        },
      ],
    },
    checks: answer.claims.map((_claim, claimIndex) => ({
      claimIndex,
      actors: [],
      counts: [],
      inventedFacts: [],
      supported: true,
      reason: `Original claim ${claimIndex} supported.`,
    })),
  };
  return { answer, review };
}

test('unused canonical facts are pruned with structured indices and complete before/after audit', () => {
  const { answer, review } = fixture(),
    before = structuredClone({ answer, review });
  answer.citationAugmentations = [
    { claimIndex: 1, reference: { type: 'event', id: 'pass', revision: 1 } },
    { claimIndex: 2, reference: { type: 'event', id: 'shot', revision: 1 } },
  ];
  answer.reviewAugmentations = [{ claimIndex: 2, index: 7, value: 0 }];
  answer.numericReviewBindings = [{ claimIndex: 2, assertionIndex: 0 }];
  review.numericBindings = [{ claimIndex: 2, assertionIndex: 0 }];
  const result = pruneUncoveredCanonicalFacts(answer, review);
  assert.equal(result.pruned, true);
  assert.deepEqual(result.answer.claims, [before.answer.claims[0], before.answer.claims[2]]);
  assert.deepEqual(
    result.review.requestCheck.coverage.map((p) => p.claimIndices),
    [[1], [0]],
  );
  assert.deepEqual(
    result.review.requestCheck.coverage.map((p) => p.relationAnchorClaimIndex),
    [1, 0],
  );
  assert.deepEqual(
    result.review.checks.map((c) => c.claimIndex),
    [0, 1],
  );
  assert.equal(result.review.checks[1].reason, 'Original claim 2 supported.');
  assert.equal(result.review.reasonIndexSpace, 'reviewed-answer-before-pruning');
  assert.deepEqual(
    result.answer.claimProvenance.map((c) => c.claimIndex),
    [0, 1],
  );
  assert.equal(result.answer.claimProvenance[1].modelGenerated, true);
  assert.deepEqual(result.answer.canonicalFactSelection.selectedFactIds, ['shot']);
  assert.deepEqual(result.answer.canonicalFactSelection.requestedFactIds, ['shot', 'pass']);
  assert.deepEqual(result.answer.canonicalFactSelection.originalToSelectedIndex, [0, null]);
  assert.deepEqual(
    result.answer.citationAugmentations.map((c) => c.claimIndex),
    [1],
  );
  assert.equal(result.answer.reviewAugmentations[0].claimIndex, 1);
  assert.equal(result.answer.reviewAugmentations[0].index, 7);
  assert.equal(result.answer.numericReviewBindings[0].claimIndex, 1);
  assert.equal(result.review.numericBindings[0].claimIndex, 1);
  assert.deepEqual(result.answer.coveragePruning.originalToFinalClaimIndex, [0, null, 1]);
  assert.equal(result.answer.coveragePruning.removed[0].factId, 'pass');
  assert.deepEqual(result.answer.coveragePruning.selectionBefore, answer.canonicalFactSelection);
  assert.deepEqual(result.answer.coveragePruning.reviewBefore, review);
  assert.deepEqual(answer.claims, before.answer.claims);
  assert.equal(review.checks.length, 3, 'Inputs are not mutated');
  assert.equal(
    pruneUncoveredCanonicalFacts(result.answer, result.review).pruned,
    false,
    'Normalization is idempotent',
  );
});

test('covered interpretations preserve all declared supporting observations and remap dependencies', () => {
  const { answer, review } = fixture();
  answer.claims[2] = {
    text: 'A qualified assessment.',
    kind: 'interpretation',
    evidence: answer.claims[1].evidence,
  };
  answer.claimDependencies = [{ claimIndex: 2, observationIndices: [1] }];
  answer.canonicalFactSelection.dependencyMappings = [
    { proseIndex: 0, requestedIndices: [1], selectedIndices: [1] },
  ];
  review.requestCheck.coverage = [
    {
      requestSpan: 'Assess it.',
      claimIndices: [2],
      answerForm: 'assessment',
      requestedAction: 'other',
      temporalRelation: 'none',
    },
  ];
  const result = pruneUncoveredCanonicalFacts(answer, review);
  assert.equal(result.pruned, true);
  assert.deepEqual(result.answer.canonicalFactSelection.selectedFactIds, ['pass']);
  assert.deepEqual(result.answer.claimDependencies, [{ claimIndex: 1, observationIndices: [0] }]);
  assert.deepEqual(result.answer.canonicalFactSelection.dependencyMappings, [
    { proseIndex: 0, requestedIndices: [1], selectedIndices: [0] },
  ]);
  assert.equal(result.answer.claims[1].text, answer.claims[2].text);
  answer.claimDependencies[0].observationIndices = [0, 1];
  assert.equal(
    pruneUncoveredCanonicalFacts(answer, review).pruned,
    false,
    'Both dependencies survive even if only the interpretation is covered',
  );
});

test('relative anchor and witness closure survives even when coverage directly names only the result', () => {
  const { answer, review } = fixture();
  answer.relationWitnesses = [{ anchorClaimIndex: 1, witnessClaimIndex: 0, relation: 'after' }];
  review.requestCheck.coverage = [
    {
      requestSpan: 'Did something follow?',
      claimIndices: [0],
      answerForm: 'fact',
      requestedAction: 'shot',
      temporalRelation: 'after-requested-event',
      relationAnchorClaimIndex: 1,
      relationEntityBinding: 'none',
    },
  ];
  assert.equal(
    pruneUncoveredCanonicalFacts(answer, review).pruned,
    false,
    'The anchor and limitation are retained',
  );
  delete answer.relationWitnesses;
  review.requestCheck.coverage[0].relationAnchorClaimIndex = null;
  assert.equal(
    pruneUncoveredCanonicalFacts(answer, review).pruned,
    true,
    'Without relation or dependency use, the unrelated fact may be removed',
  );
});

test('legacy, unapproved or malformed coverage cannot authorize pruning and model prose is never trimmed', () => {
  for (const mutate of [
    (r) => (r.decision = 'withhold'),
    (r) => delete r.requestCheck.coverage[0].answerForm,
    (r) => (r.requestCheck.coverage[0].claimIndices = [9]),
    (r) => (r.requestCheck.coverage[0].claimIndices = []),
  ]) {
    const { answer, review } = fixture();
    mutate(review);
    assert.deepEqual(pruneUncoveredCanonicalFacts(answer, review), {
      answer,
      review,
      pruned: false,
    });
  }
  const { answer, review } = fixture();
  review.requestCheck.coverage = [review.requestCheck.coverage[1]];
  const result = pruneUncoveredCanonicalFacts(answer, review);
  assert.equal(
    result.answer.claims.at(-1).text,
    'The speed is not recorded.',
    'Even uncovered limitations are not deleted by a fact-only transformation',
  );
});

test('internal source anchor survives pruning without a fictional displayed anchor index', () => {
  const { answer, review } = fixture();
  answer.relationWitnesses = [
    {
      proves: 'explicit-linked-sequence',
      sourceLinkIndex: 0,
      anchor: { type: 'event', id: 'earlier-shot', revision: 1 },
      witnessClaimIndex: 0,
    },
  ];
  const result = pruneUncoveredCanonicalFacts(answer, review);
  assert.equal(result.pruned, true);
  assert.equal(result.answer.relationWitnesses[0].witnessClaimIndex, 0);
  assert.equal(Object.hasOwn(result.answer.relationWitnesses[0], 'anchorClaimIndex'), false);
});

test('prose-normalization audit indices follow canonical pruning without rewriting original text', () => {
  const { answer, review } = fixture();
  answer.proseNormalizations = [
    {
      claimIndex: 2,
      originalText: 'Original numbers. A retained conclusion.',
      removedTextVerified: false,
    },
  ];
  const result = pruneUncoveredCanonicalFacts(answer, review);
  assert.equal(result.pruned, true);
  assert.equal(result.answer.proseNormalizations[0].claimIndex, 1);
  assert.equal(
    result.answer.proseNormalizations[0].originalText,
    answer.proseNormalizations[0].originalText,
  );
});

test('a proved measurement boundary does not keep an unrelated latest action or remove the requested scorer', () => {
  const { answer, review } = fixture();
  answer.claims = [
    { kind: 'limitation', text: 'Distance ranking is unavailable.', evidence: [] },
    fact('latest-pass'),
    fact('goal'),
  ];
  const ids = ['boundary', 'latest-pass', 'goal'];
  answer.canonicalFactSelection = {
    selectedFactIds: ids,
    requestedFactIds: ids,
    originalToSelectedIndex: [0, 1, 2],
    proofs: ids.map((factId) =>
      factId === 'boundary'
        ? {
            factId,
            kind: 'source-measurement-limitation',
            dimension: 'passDistanceRanking',
            requestSpan: 'Longest pass?',
            basis: 'trusted-event-schema',
            modelGenerated: false,
          }
        : { factId, kind: 'event', eventId: factId },
    ),
    dependencyMappings: [],
  };
  answer.claimProvenance = ids.map((factId, claimIndex) => ({
    claimIndex,
    factId,
    source: 'verified-query-fact',
    modelGenerated: false,
  }));
  review.requestCheck.coverage = [
    {
      requestSpan: 'Longest pass?',
      claimIndices: [0, 1],
      answerForm: 'unavailable-measurement',
      requestedAction: 'pass',
      temporalRelation: 'none',
    },
    {
      requestSpan: 'Goal scorer?',
      claimIndices: [2],
      answerForm: 'fact',
      requestedAction: 'shot',
      temporalRelation: 'none',
    },
  ];
  const before = structuredClone({ answer, review });
  const result = pruneUncoveredCanonicalFacts(answer, review);
  assert.equal(result.pruned, true);
  assert.deepEqual(result.answer.claims, [answer.claims[0], answer.claims[2]]);
  assert.deepEqual(
    result.review.requestCheck.coverage.map((part) => part.claimIndices),
    [[0], [1]],
  );
  assert.deepEqual({ answer, review }, before);
  const needed = structuredClone(review);
  needed.requestCheck.coverage.push({
    requestSpan: 'Latest pass?',
    claimIndices: [1],
    answerForm: 'fact',
    requestedAction: 'pass',
    temporalRelation: 'none',
  });
  assert.equal(
    pruneUncoveredCanonicalFacts(answer, needed).pruned,
    false,
    'an independently requested pass remains',
  );
});
