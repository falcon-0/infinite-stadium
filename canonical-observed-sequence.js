import { buildQuestionFacts } from './question-facts.js';
import { recoveryClassification } from './recovery-classification.js';

const key = (ref) => `${ref?.type}:${ref?.id}@${ref?.revision}`;
const sameRefs = (a = [], b = []) =>
  a.length === b.length &&
  new Set(a.map(key)).size === a.length &&
  a.every((ref) => b.some((other) => key(ref) === key(other)));

// A complete canonical chain can prove a positive predecessor by the shooter
// (the linked reception) as well as one by the supplier (the linked pass).
// Neither the current pin nor a reviewer label supplies an anchor or action.
export function canonicalObservedSequenceWitness(part, answer, selection, packet, endpoint) {
  const index = part.relationAnchorClaimIndex,
    claim = answer.claims?.[index],
    proof = selection?.proofs?.[index];
  if (
    packet.requestedForm !== 'explanation' ||
    packet.explanationTarget !== 'observed-sequence' ||
    part.answerForm !== 'explanation' ||
    part.explanationTarget !== 'observed-sequence' ||
    part.requestedAnchorOrdinal != null ||
    part.temporalRelation !== 'before-requested-event' ||
    !Number.isInteger(index) ||
    !part.claimIndices?.includes(index) ||
    !['none', 'same-team', 'same-player'].includes(part.relationEntityBinding) ||
    part.requestedQuantity?.length ||
    part.requestedSourceAttributes?.length ||
    claim?.kind !== 'observation' ||
    proof?.kind !== 'linked-shot-supply' ||
    proof.modelGenerated !== false ||
    proof.sequenceBasis !== 'explicit-recovery-pass-reception-shot' ||
    proof.sequenceLinks?.length !== 4 ||
    !endpoint ||
    key(endpoint) !== key({ type: 'event', id: proof.eventId, revision: proof.revision }) ||
    key(packet.requestedMoment?.reference) !== key(endpoint) ||
    packet.requestedMoment.time !== proof.time
  )
    return null;
  const rebuilt = buildQuestionFacts(packet).facts.find(
    (f) =>
      f.proof.kind === proof.kind &&
      f.proof.eventId === proof.eventId &&
      f.proof.revision === proof.revision &&
      f.proof.sequenceBasis === proof.sequenceBasis,
  );
  if (
    !rebuilt ||
    rebuilt.claim.text !== claim.text ||
    !sameRefs(rebuilt.claim.evidence, claim.evidence) ||
    JSON.stringify(rebuilt.proof.sequenceLinks) !== JSON.stringify(proof.sequenceLinks)
  )
    return null;
  const sources = [...(packet.queryResults || []), ...(packet.requestedEvidence || [])];
  const binding = (packet.queryRelations || []).find((binding) => {
    const source = sources.find(
      (s) =>
        key(s.scopeReference) === key(binding.scopeReference) &&
        s.rows?.some((row) => row.id === proof.passId && row.revision === proof.passRevision),
    );
    const anchor = sources.find(
      (s) =>
        key(s.scopeReference) === key(binding.anchorScope) &&
        s.rows?.some((row) => row.id === proof.eventId && row.revision === proof.revision),
    );
    return (
      binding.relation === 'before' &&
      binding.anchorIdentifiedBy === 'requested-moment' &&
      key(binding.anchor) === key(endpoint) &&
      binding.anchorTime === proof.time &&
      binding.query?.filters?.id === proof.passId &&
      binding.query.filters.type === 'pass' &&
      Object.keys(binding.query.filters).every((field) => ['id', 'type', 'team'].includes(field)) &&
      (!binding.query.filters.team || binding.query.filters.team === proof.sequenceLinks[1].team) &&
      binding.query.aggregate === 'list' &&
      binding.query.timeFrom <= proof.sequenceLinks[1].time &&
      binding.query.timeTo <= proof.time &&
      binding.query.timeTo >= proof.sequenceLinks[1].time &&
      !(
        binding.query.timeFromExclusive && binding.query.timeFrom === proof.sequenceLinks[1].time
      ) &&
      !(binding.query.timeToExclusive && binding.query.timeTo === proof.sequenceLinks[1].time) &&
      (binding.query.timeTo < proof.time || binding.query.timeToExclusive === true) &&
      source?.query?.filters?.id === proof.passId &&
      source.query.timeFrom === binding.query.timeFrom &&
      source.query.filters.type === 'pass' &&
      Object.keys(source.query.filters).every((field) => ['id', 'type', 'team'].includes(field)) &&
      source.query.filters.team === binding.query.filters.team &&
      source.query.aggregate === 'list' &&
      source.query.timeTo === binding.query.timeTo &&
      !!source.query.timeToExclusive === !!binding.query.timeToExclusive &&
      !!source.query.timeFromExclusive === !!binding.query.timeFromExclusive &&
      source.rows?.some((row) => row.id === proof.passId && row.revision === proof.passRevision) &&
      anchor?.rows?.some((row) => row.id === proof.eventId && row.revision === proof.revision) &&
      anchor.query?.filters?.id === proof.eventId &&
      anchor.query.aggregate === 'list' &&
      anchor.query.timeFrom <= proof.time &&
      anchor.query.timeTo >= proof.time &&
      !(anchor.query.timeFromExclusive && anchor.query.timeFrom === proof.time) &&
      !(anchor.query.timeToExclusive && anchor.query.timeTo === proof.time) &&
      binding.resultEvents?.some(
        (ref) =>
          key(ref) === key({ type: 'event', id: proof.passId, revision: proof.passRevision }),
      )
    );
  });
  if (!binding) return null;
  const rows = [...sources.flatMap((s) => s.rows || []), ...(packet.linkedContext?.rows || [])];
  const shot = proof.sequenceLinks.at(-1);
  const predecessor = proof.sequenceLinks.slice(0, -1).find((link) => {
    const row = rows.find((row) => row.id === link.eventId && row.revision === link.revision);
    return (
      row &&
      link.time < shot.time &&
      (part.requestedAction === 'other' ||
        (part.requestedAction === 'ball-win'
          ? recoveryClassification(row) === 'ball-win'
          : row.type === part.requestedAction)) &&
      (part.relationEntityBinding !== 'same-player' || link.playerId === shot.playerId) &&
      (part.relationEntityBinding !== 'same-team' || link.team === shot.team)
    );
  });
  return predecessor
    ? {
        anchor: endpoint,
        witness: { type: 'event', id: predecessor.eventId, revision: predecessor.revision },
        proves: 'positive-linked-predecessor',
        doesNotProve: ['absence', 'count', 'causation', 'intent', 'first-or-last'],
      }
    : null;
}
