// This runs only after factual guards and semantic review have approved an
// answer. It removes unused application-rendered facts, never rewrites prose
// or infers relevance from words. Invalid/legacy metadata leaves it unchanged.
export function pruneUncoveredCanonicalFacts(answer, review, context = {}) {
  const unchanged = () => ({
    answer: structuredClone(answer),
    review: structuredClone(review),
    pruned: false,
  });
  const claims = answer?.claims,
    selection = answer?.canonicalFactSelection,
    coverage = review?.requestCheck?.coverage;
  if (
    !Array.isArray(claims) ||
    !selection ||
    review?.decision !== 'approve' ||
    !['answered', 'corrected-premise', 'useful-limitation', 'clarification'].includes(
      review.requestCheck?.status,
    ) ||
    !Array.isArray(coverage) ||
    !coverage.length ||
    !Array.isArray(answer.claimProvenance) ||
    !Array.isArray(selection.selectedFactIds) ||
    !Array.isArray(selection.proofs) ||
    selection.proofs.length !== selection.selectedFactIds.length
  )
    return unchanged();
  const valid = (index) => Number.isInteger(index) && index >= 0 && index < claims.length;
  if (
    !Array.isArray(review.checks) ||
    review.checks.length !== claims.length ||
    new Set(review.checks.map((check) => check.claimIndex)).size !== claims.length ||
    review.checks.some(
      (check) =>
        !valid(check.claimIndex) ||
        check.supported !== true ||
        !Array.isArray(check.inventedFacts) ||
        check.inventedFacts.length,
    )
  )
    return unchanged();
  if (
    coverage.some(
      (part) =>
        !Array.isArray(part.claimIndices) ||
        !part.claimIndices.length ||
        part.claimIndices.some((index) => !valid(index)) ||
        new Set(part.claimIndices).size !== part.claimIndices.length ||
        typeof part.answerForm !== 'string' ||
        typeof part.requestedAction !== 'string',
    )
  )
    return unchanged();
  const provenance = new Map(answer.claimProvenance.map((item) => [item.claimIndex, item]));
  if (provenance.size !== claims.length || [...provenance.keys()].some((index) => !valid(index)))
    return unchanged();
  const canonical = new Map(
    [...provenance]
      .filter(([, item]) => item.source === 'verified-query-fact' && item.modelGenerated === false)
      .map(([index, item]) => [index, item.factId]),
  );
  if (
    canonical.size !== selection.selectedFactIds.length ||
    new Set(canonical.values()).size !== canonical.size ||
    [...canonical].some(
      ([index, id]) =>
        !['observation', 'limitation'].includes(claims[index].kind) ||
        (claims[index].kind === 'limitation' &&
          !selection.proofs.some(
            (proof) =>
              proof.factId === id &&
              proof.kind === 'source-measurement-limitation' &&
              proof.basis === 'trusted-event-schema' &&
              proof.modelGenerated === false,
          )) ||
        !selection.selectedFactIds.includes(id),
    )
  )
    return unchanged();
  if (selection.proofs.some((proof, index) => proof.factId !== selection.selectedFactIds[index]))
    return unchanged();
  const dependencies = answer.claimDependencies || [];
  if (
    !Array.isArray(dependencies) ||
    dependencies.some(
      (item) =>
        !valid(item.claimIndex) ||
        !Array.isArray(item.observationIndices) ||
        item.observationIndices.some((index) => !valid(index) || index === item.claimIndex),
    )
  )
    return unchanged();
  const provedLimitations = new Map(
    [...canonical].filter(
      ([index, id]) =>
        claims[index].kind === 'limitation' &&
        selection.proofs.some(
          (proof) =>
            proof.factId === id &&
            proof.kind === 'source-measurement-limitation' &&
            proof.basis === 'trusted-event-schema' &&
            proof.modelGenerated === false,
        ),
    ),
  );
  // A single positive collection already answers an occurrence lookup. Its
  // complete one-player/one-action ranking adds no other occurrence. Only use
  // this equivalence after both planner and reviewer identify a factual lookup;
  // quantitative, comparative, temporal and explanatory uses stay untouched.
  const intent = review.requestCheck.responseIntent;
  const occurrenceLookup =
    context.requestedForm === 'fact' &&
    context.answerFocus === 'event-actor' &&
    intent?.purpose === 'fact-retrieval' &&
    [
      'needsAssessment',
      'needsExplicitCorrection',
      'needsScoreline',
      'needsMeasurementLimitation',
    ].every((key) => intent[key] === false) &&
    coverage.every(
      (part) =>
        part.answerForm === 'fact' &&
        part.requestedQuantity === null &&
        part.temporalRelation === 'none',
    );
  const redundantRankings = new Set();
  if (occurrenceLookup)
    for (const [index, factId] of canonical) {
      const ranking = selection.proofs.find((proof) => proof.factId === factId);
      if (
        ranking?.kind !== 'player-count-ranking' ||
        ranking.modelGenerated !== false ||
        ranking.metric !== 'savedAttemptCollections' ||
        ranking.value !== 1 ||
        ranking.totalCount !== 1 ||
        ranking.matchedGroupCount !== 1 ||
        ranking.leaders?.length !== 1 ||
        ranking.leaders[0].count !== 1 ||
        ranking.groups?.length !== 1 ||
        ranking.groups[0].count !== 1 ||
        ranking.groups[0].id !== ranking.leaders[0].id ||
        ranking.query?.aggregate !== 'by-player' ||
        JSON.stringify(Object.entries(ranking.query.filters || {}).sort()) !==
          JSON.stringify(
            Object.entries({
              type: 'recovery',
              recoveryKind: 'goalkeeper-hold',
              linkedShotOutcome: 'saved',
            }).sort(),
          )
      )
        continue;
      const witness = [...canonical].find(([otherIndex, otherId]) => {
        if (otherIndex === index) return false;
        const hold = selection.proofs.find((proof) => proof.factId === otherId);
        const window = hold?.orderedShot;
        return (
          hold?.kind === 'linked-goalkeeper-hold' &&
          hold.modelGenerated === false &&
          hold.holderId === ranking.leaders[0].id &&
          Number.isFinite(hold.time) &&
          Number.isFinite(hold.shotTime) &&
          hold.shotTime <= hold.time &&
          window?.modelGenerated === false &&
          window.metric === 'savedShots' &&
          window.timeFrom === ranking.timeFrom &&
          window.timeTo === ranking.timeTo &&
          Number.isFinite(ranking.timeFrom) &&
          Number.isFinite(ranking.timeTo) &&
          hold.time >= ranking.timeFrom &&
          hold.time <= ranking.timeTo &&
          !ranking.query.timeFromExclusive &&
          !ranking.query.timeToExclusive &&
          !window.query?.timeFromExclusive &&
          !window.query?.timeToExclusive
        );
      });
      const uses = coverage.filter((part) => part.claimIndices.includes(index));
      if (
        witness &&
        uses.length &&
        uses.every(
          (part) =>
            ['shot', 'recovery'].includes(part.requestedAction) &&
            part.claimIndices.includes(witness[0]),
        )
      )
        redundantRankings.add(index);
    }
  const effectiveCoverage = coverage.map((originalPart) => {
    const part = {
      ...originalPart,
      claimIndices: originalPart.claimIndices.filter((index) => !redundantRankings.has(index)),
    };
    if (part.answerForm !== 'unavailable-measurement' || part.temporalRelation !== 'none')
      return part;
    const limitations = part.claimIndices.filter((index) => {
      const factId = provedLimitations.get(index);
      return (
        factId &&
        selection.proofs.some(
          (proof) =>
            proof.factId === factId &&
            proof.requestSpan === part.requestSpan &&
            proof.dimension === 'passDistanceRanking',
        )
      );
    });
    // An observation cannot establish a source-declared absent measurement.
    // Other request components and explicit dependencies still retain their facts.
    if (!limitations.length) return part;
    return {
      ...part,
      claimIndices: part.claimIndices.filter(
        (index) => !canonical.has(index) || provedLimitations.has(index),
      ),
    };
  });
  const keep = new Set(effectiveCoverage.flatMap((part) => part.claimIndices));
  for (const index of provedLimitations.keys()) keep.add(index);
  // Model prose is never deleted or silently detached from declared support.
  for (let index = 0; index < claims.length; index++) if (!canonical.has(index)) keep.add(index);
  for (const part of coverage) {
    if (!['after-requested-event', 'before-requested-event'].includes(part.temporalRelation))
      continue;
    if (part.relationAnchorClaimIndex != null) {
      if (!valid(part.relationAnchorClaimIndex)) return unchanged();
      keep.add(part.relationAnchorClaimIndex);
    }
  }
  for (const witness of answer.relationWitnesses || []) {
    const internalAnchor =
      witness.proves === 'explicit-linked-sequence' &&
      Number.isInteger(witness.sourceLinkIndex) &&
      witness.sourceLinkIndex >= 0 &&
      witness.anchor?.type === 'event';
    if ((!internalAnchor && !valid(witness.anchorClaimIndex)) || !valid(witness.witnessClaimIndex))
      return unchanged();
    if (!internalAnchor) keep.add(witness.anchorClaimIndex);
    keep.add(witness.witnessClaimIndex);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of dependencies)
      if (keep.has(item.claimIndex))
        for (const index of item.observationIndices)
          if (!keep.has(index)) {
            keep.add(index);
            changed = true;
          }
  }
  const removed = [...canonical.keys()].filter((index) => !keep.has(index));
  if (!removed.length) return unchanged();
  const retained = claims.map((_claim, index) => index).filter((index) => !removed.includes(index)),
    claimMap = claims.map((_claim, index) => retained.indexOf(index));
  const retainedIds = new Set(
    [...canonical].filter(([index]) => keep.has(index)).map(([, id]) => id),
  );
  const finalIds = selection.selectedFactIds.filter((id) => retainedIds.has(id)),
    factMap = selection.selectedFactIds.map((id) => finalIds.indexOf(id));
  if (
    (selection.dependencyMappings || []).some(
      (item) =>
        !Array.isArray(item.selectedIndices) ||
        item.selectedIndices.some(
          (index) => !Number.isInteger(index) || factMap[index] === undefined || factMap[index] < 0,
        ),
    )
  )
    return unchanged();
  const remapAnnotations = (items) =>
    items
      ?.filter((item) => valid(item.claimIndex) && claimMap[item.claimIndex] >= 0)
      .map((item) => ({ ...structuredClone(item), claimIndex: claimMap[item.claimIndex] }));
  const out = structuredClone(answer),
    mappedReview = structuredClone(review);
  out.claims = retained.map((index) => structuredClone(claims[index]));
  out.claimProvenance = retained.map((index) => ({
    ...structuredClone(provenance.get(index)),
    claimIndex: claimMap[index],
  }));
  if (out.claimDependencies)
    out.claimDependencies = dependencies
      .filter((item) => keep.has(item.claimIndex))
      .map((item) => ({
        ...structuredClone(item),
        claimIndex: claimMap[item.claimIndex],
        observationIndices: item.observationIndices.map((index) => claimMap[index]),
      }));
  for (const field of [
    'citationAugmentations',
    'reviewAugmentations',
    'numericReviewBindings',
    'proseNormalizations',
  ])
    if (out[field]) out[field] = remapAnnotations(out[field]);
  if (out.relationWitnesses)
    out.relationWitnesses = out.relationWitnesses.map((item) => ({
      ...item,
      ...(item.anchorClaimIndex != null
        ? { anchorClaimIndex: claimMap[item.anchorClaimIndex] }
        : {}),
      witnessClaimIndex: claimMap[item.witnessClaimIndex],
    }));
  const rawMap =
    selection.originalToSelectedIndex || selection.selectedFactIds.map((_id, index) => index);
  out.canonicalFactSelection = {
    ...structuredClone(selection),
    selectedFactIds: finalIds,
    proofs: selection.proofs
      .filter((proof) => retainedIds.has(proof.factId))
      .map((proof) => structuredClone(proof)),
    originalToSelectedIndex: rawMap.map((index) =>
      Number.isInteger(index) && index >= 0 && factMap[index] >= 0 ? factMap[index] : null,
    ),
    dependencyMappings: (selection.dependencyMappings || []).map((item) => ({
      ...structuredClone(item),
      selectedIndices: item.selectedIndices.map((index) => factMap[index]),
    })),
  };
  mappedReview.requestCheck.coverage = effectiveCoverage.map((part) => ({
    ...structuredClone(part),
    claimIndices: part.claimIndices.map((index) => claimMap[index]),
    ...(Object.hasOwn(part, 'relationAnchorClaimIndex')
      ? {
          relationAnchorClaimIndex:
            valid(part.relationAnchorClaimIndex) && claimMap[part.relationAnchorClaimIndex] >= 0
              ? claimMap[part.relationAnchorClaimIndex]
              : null,
        }
      : {}),
  }));
  mappedReview.checks = remapAnnotations(review.checks);
  if (mappedReview.numericBindings)
    mappedReview.numericBindings = remapAnnotations(review.numericBindings);
  // Free-form reviewer reasons remain verbatim; their original index space is
  // explicitly recorded rather than pretending text indices were rewritten.
  mappedReview.reasonIndexSpace = 'reviewed-answer-before-pruning';
  out.coveragePruning = {
    version: 'coverage-pruning-v1',
    method: 'approved-indexed-coverage-and-dependency-closure',
    originalClaimCount: claims.length,
    originalToFinalClaimIndex: claimMap.map((index) => (index < 0 ? null : index)),
    removed: removed.map((index) => ({
      claimIndex: index,
      factId: canonical.get(index),
      claim: structuredClone(claims[index]),
    })),
    selectionBefore: structuredClone(selection),
    reviewBefore: structuredClone(review),
    reviewAfter: structuredClone(mappedReview),
    limitation:
      'Relevance is the approved model review, not independently established by pruning. Retained model prose is unchanged.',
  };
  return { answer: out, review: mappedReview, pruned: true };
}
