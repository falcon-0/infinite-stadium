const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 700;
const referenceMatches = (ref, id, revision) =>
  ref?.type === 'event' && ref.id === id && ref.revision === revision;
const effects = new Set(['took-lead', 'equalized', 'extended-lead', 'reduced-deficit']);

/** Application-owned evidence foundation. The scoped output must contain the
 * current received anchor, not an old/deleted/future version. This is a domain
 * requirement, not a claim that the model selected these tools.
 */
export function requiredStoryTools(sequenceOutput, anchorId) {
  const scope = sequenceOutput?.scope;
  if (
    !validId(anchorId) ||
    !object(scope) ||
    scope.anchorId !== anchorId ||
    !Number.isFinite(scope.eventTime) ||
    scope.eventTime < 0 ||
    !Number.isFinite(scope.observedAt) ||
    scope.observedAt < scope.eventTime ||
    !Array.isArray(sequenceOutput.events) ||
    !Array.isArray(sequenceOutput.references)
  )
    throw new RangeError('Provide the current received anchor sequence and matching scope.');
  const matches = sequenceOutput.events.filter((event) => event?.id === anchorId);
  if (matches.length !== 1)
    throw new RangeError(
      'The current received anchor must occur once in the materialized sequence.',
    );
  const anchor = matches[0];
  if (
    !Number.isSafeInteger(anchor.revision) ||
    anchor.revision < 1 ||
    anchor.time !== scope.eventTime ||
    !Number.isFinite(anchor.arrivedAt) ||
    anchor.arrivedAt < anchor.time ||
    anchor.arrivedAt > scope.observedAt ||
    !['shot', 'pass', 'recovery', 'receive', 'flight'].includes(anchor.type) ||
    ![undefined, 'upsert'].includes(anchor.operation) ||
    !sequenceOutput.references.some((ref) => referenceMatches(ref, anchorId, anchor.revision))
  )
    throw new RangeError(
      'The anchor is deleted, unreceived, stale or missing its current reference.',
    );
  return [
    'get_event_sequence',
    ...(anchor.type === 'shot' && anchor.result === true ? ['score_at_moment'] : []),
  ];
}

/** Supported recorded-score consequence only. No tactical cause, final result
 * or absent meaning is added; catalog construction owns complete citations.
 */
export function storyRequirements(catalog, anchorId) {
  if (
    !object(catalog) ||
    !Array.isArray(catalog.facts) ||
    !validId(anchorId) ||
    catalog.scope?.anchorId !== anchorId ||
    !Number.isFinite(catalog.scope.eventTime) ||
    catalog.scope.eventTime < 0 ||
    !Number.isFinite(catalog.scope.observedAt) ||
    catalog.scope.observedAt < catalog.scope.eventTime ||
    catalog.facts.some((fact) => !validId(fact?.id)) ||
    new Set(catalog.facts.map((fact) => fact.id)).size !== catalog.facts.length
  )
    throw new RangeError('Provide a current typed fact catalog for the selected anchor.');
  const matches = catalog.facts.filter(
    (fact) => fact?.kind === 'moment' && fact.values?.anchorId === anchorId,
  );
  if (
    matches.length !== 1 ||
    !validId(matches[0].id) ||
    matches[0].values.time !== catalog.scope.eventTime
  )
    throw new RangeError('The required current moment fact is unavailable or ambiguous.');
  const moment = matches[0],
    anchorRef = moment.evidence?.find(
      (ref) =>
        ref.type === 'event' &&
        ref.id === anchorId &&
        Number.isSafeInteger(ref.revision) &&
        ref.revision > 0,
    );
  if (!anchorRef)
    throw new RangeError('The required moment fact lacks its received anchor reference.');
  const confirmedGoal = moment.values.action === 'shot' && moment.values.outcome === 'goal';
  let consequence = null;
  if (confirmedGoal) {
    const changes = catalog.facts.filter(
      (fact) => fact?.kind === 'goal-score-change' && fact.values?.anchorId === anchorId,
    );
    if (changes.length > 1)
      throw new RangeError('The catalog contains conflicting score consequences for the anchor.');
    if (changes.length) {
      const fact = changes[0],
        values = fact.values;
      const scoreFields = ['beforeHome', 'beforeAway', 'afterHome', 'afterAway'];
      const own = values.team === 'home' ? values.beforeHome : values.beforeAway,
        other = values.team === 'home' ? values.beforeAway : values.beforeHome;
      const expectedEffect =
        own === other
          ? 'took-lead'
          : own === other - 1
            ? 'equalized'
            : own > other
              ? 'extended-lead'
              : 'reduced-deficit';
      if (
        !validId(fact.id) ||
        values.time !== moment.values.time ||
        values.team !== moment.values.team ||
        !['home', 'away'].includes(values.team) ||
        scoreFields.some((field) => !Number.isSafeInteger(values[field]) || values[field] < 0) ||
        values.afterHome !== values.beforeHome + (values.team === 'home' ? 1 : 0) ||
        values.afterAway !== values.beforeAway + (values.team === 'away' ? 1 : 0) ||
        !effects.has(values.effect) ||
        values.effect !== expectedEffect ||
        !Array.isArray(fact.evidence) ||
        !fact.evidence.some((ref) => referenceMatches(ref, anchorId, anchorRef.revision))
      )
        throw new RangeError(
          'The catalog score consequence does not match the current supported goal.',
        );
      consequence = fact;
    }
  }
  return {
    requiredFactIds: [moment.id, ...(consequence ? [consequence.id] : [])],
    requiredKinds: ['moment', ...(consequence ? ['goal-score-change'] : [])],
    ambiguity: confirmedGoal && !consequence ? 'goal-score-change-unavailable' : null,
  };
}

/** Validate model output as supplied. Never silently append required facts. */
export function validateRequiredStoryFacts(selectedIds, requirements) {
  if (
    !Array.isArray(selectedIds) ||
    selectedIds.some((id) => !validId(id)) ||
    new Set(selectedIds).size !== selectedIds.length ||
    !object(requirements) ||
    !Array.isArray(requirements.requiredFactIds) ||
    !requirements.requiredFactIds.length ||
    requirements.requiredFactIds.some((id) => !validId(id))
  )
    throw new RangeError('Provide unique selected fact IDs and current story requirements.');
  if (requirements.requiredFactIds.some((id) => !selectedIds.includes(id)))
    throw new RangeError('Include the required current moment and supported goal score change.');
  return true;
}
