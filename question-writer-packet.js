// Writer-only serialization. Full evidence stays in the orchestrator and reviewer.
import { compactQuestionWirePacket } from './question-wire-packet.js';
import { projectQuestionFactWindows } from './question-facts.js';

export function projectWriterFactCatalog(catalog, schema) {
  if (!Array.isArray(catalog?.facts) || !schema?.properties?.composition) return catalog;
  const selected = new Set();
  const resolve = (node, ancestors) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || ancestors.has(node))
      throw new Error('Unknown schema');
    const next = new Set(ancestors).add(node);
    if (!node.$ref) return [node, next];
    if (
      !node.$ref.startsWith('#/') ||
      Object.keys(node).some((key) => !['$ref', 'description'].includes(key))
    )
      throw new Error('Unsupported reference');
    const target = node.$ref
      .slice(2)
      .split('/')
      .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((value, key) => (Object.hasOwn(value || {}, key) ? value[key] : undefined), schema);
    return resolve(target, next);
  };
  const ids = (value, ancestors = new Set()) => {
    const [node, next] = resolve(value, ancestors);
    if (node.allOf || node.not || node.if) throw new Error('Unsupported constraint');
    const branches = node.anyOf || node.oneOf;
    if (branches) {
      for (const branch of branches) ids(branch, next);
      return;
    }
    const values = node.enum || (Object.hasOwn(node, 'const') ? [node.const] : null);
    if (!values?.length || values.some((id) => typeof id !== 'string'))
      throw new Error('Unbounded IDs');
    values.forEach((id) => selected.add(id));
  };
  const modes = (value, ancestors = new Set()) => {
    const [node, next] = resolve(value, ancestors);
    if (node.allOf || node.not || node.if) throw new Error('Unsupported composition');
    const branches = node.anyOf || node.oneOf;
    if (branches) {
      for (const branch of branches) modes(branch, next);
      return;
    }
    if (node.type !== 'object' || node.additionalProperties !== false || !node.properties)
      throw new Error('Unbounded composition');
    for (const [key, value] of Object.entries(node.properties)) {
      if (['limitationFactId', 'sequenceFactId'].includes(key)) ids(value);
      if (['factIds', 'contextFactIds'].includes(key)) {
        const [array] = resolve(value, new Set());
        if (array.type !== 'array') throw new Error('Unknown selection');
        if (array.maxItems !== 0) ids(array.items);
      }
    }
  };
  try {
    modes(schema.properties.composition);
  } catch {
    return catalog;
  }
  const available = new Set(catalog.facts.map((fact) => fact.id));
  if (!selected.size || [...selected].some((id) => !available.has(id))) return catalog;
  const facts = catalog.facts.filter((fact) => selected.has(fact.id));
  return facts.length === catalog.facts.length ? catalog : { ...catalog, facts };
}
export function deduplicateWriterRequestedEvidence(sources) {
  // Wire-only: require the complete result and source identity to be identical.
  // Never collapse differing revisions, filters, coverage, rows or group values.
  const stable = (value) =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, stable(value[key])]),
          )
        : value;
  const seen = new Set();
  return sources.filter((source) => {
    const ref = source?.scopeReference;
    if (ref?.type !== 'scope' || typeof ref.id !== 'string' || !Number.isSafeInteger(ref.revision))
      return true;
    const key = JSON.stringify(stable(source));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function writerPacket(packet) {
  const compact = compactQuestionWirePacket(packet);
  if (Array.isArray(compact.requestedEvidence))
    compact.requestedEvidence = deduplicateWriterRequestedEvidence(compact.requestedEvidence);
  if (compact.matchFacts)
    compact.matchFacts = projectQuestionFactWindows(compact.matchFacts, compact.requestedEvidence);
  // The writer selects proved claims; it does not need repeated proof operands
  // and coverage records. Retain those unchanged internally and in review.
  if (compact.matchFacts)
    compact.matchFacts = {
      ...compact.matchFacts,
      facts: compact.matchFacts.facts.map(({ id, claim, proof }) => ({
        id,
        claim,
        selection: Object.fromEntries(
          Object.entries({
            kind: proof.kind,
            dimension: proof.dimension,
            requestSpan: proof.requestSpan,
            metric: proof.metric,
            subjectId: proof.subjectId,
            playerId: proof.playerId,
            eventType: proof.eventType,
            recipient: proof.recipient ?? proof.event?.recipient,
            attributes: proof.attributes,
            time: proof.time,
            timeFrom: proof.timeFrom,
            timeTo: proof.timeTo,
            timeFromExclusive: proof.timeFromExclusive,
            timeToExclusive: proof.timeToExclusive,
            order: proof.order,
            filters: proof.query?.filters,
            attackingTeam: proof.attackingTeam,
            attackingLeader: proof.attackingLeader,
            doesNotProve: proof.doesNotProve,
            actorRole:
              proof.kind === 'linked-goalkeeper-hold'
                ? 'goalkeeper-and-shooter'
                : (proof.eventType ?? proof.event?.eventType) === 'shot'
                  ? 'shooter'
                  : proof.metric === 'savedAttemptCollections'
                    ? 'saved-shot-collector'
                    : undefined,
          }).filter(([_key, value]) => value !== undefined),
        ),
      })),
    };
  if (compact.matchFacts && compact.requestedForm) {
    // The current writer selects canonical IDs, not raw records or query scopes.
    // Keep the complete source packet inside the application and the reviewer;
    // avoid supplying it twice in competing representations to this stage.
    const fields = [
      'question',
      'requestComponents',
      'requestedForm',
      'explanationTarget',
      'answerFocus',
      'viewerProfile',
      'responseLanguage',
      'previousQuestion',
      'conversation',
      'observedAt',
      'observedClock',
      'roster',
      'teams',
      'score',
      'limits',
      'coordinateSystem',
      'mentionedPlayerResolution',
      'requestedMoment',
      'conversationActionAnchor',
      'requestedEventOutcome',
      'pendingOutcomeContext',
      'footballKnowledge',
      'queryRelations',
      'sourceAttributeCapabilities',
      'requestedSourceAttributes',
      'matchFacts',
    ];
    return {
      ...Object.fromEntries(
        fields
          .filter((field) => compact[field] !== undefined)
          .map((field) => [field, compact[field]]),
      ),
      requestedEvidence: (compact.requestedEvidence || []).map(
        ({ query, scopeReference, count, groups, entityResolution, truncated }) => ({
          query,
          scopeReference,
          count,
          groups,
          entityResolution,
          truncated,
        }),
      ),
    };
  }
  return compact;
}
