import { actionOutcome } from './action-evidence.js';

const key = (ref) => `${ref?.type}:${ref?.id}@${ref?.revision}`;
const sameRefs = (left = [], right = []) =>
  left.length === right.length &&
  left.every((ref) => right.some((other) => key(ref) === key(other)));
const sources = (packet) => [...(packet.requestedEvidence || []), ...(packet.queryResults || [])];
const windowMatches = (left, right) =>
  left.timeFrom === right.timeFrom &&
  left.timeTo === right.timeTo &&
  !!left.timeFromExclusive === !!right.timeFromExclusive &&
  !!left.timeToExclusive === !!right.timeToExclusive;

// Only exact application text and references can receive this exemption from
// model assertion labels. Model-written blocker/path/workload prose cannot.
export function canonicalShotOutcome(index, answer, selection, packet) {
  const claim = answer.claims?.[index],
    canonical = selection?.claims?.[index],
    proof = selection?.proofs?.[index];
  if (
    !claim ||
    !canonical ||
    claim.kind !== 'observation' ||
    canonical.kind !== 'observation' ||
    claim.text !== canonical.text ||
    !sameRefs(claim.evidence, canonical.evidence) ||
    proof?.kind !== 'event' ||
    proof.modelGenerated !== false ||
    proof.attributes ||
    proof.eventType !== 'shot' ||
    !Number.isSafeInteger(proof.revision) ||
    proof.revision < 1 ||
    claim.evidence?.length !== 1 ||
    key(claim.evidence[0]) !==
      key({ type: 'event', id: proof.eventId, revision: proof.revision }) ||
    !['pending', 'goal', 'saved', 'blocked', 'off-target'].includes(proof.actionOutcome?.status)
  )
    return null;
  const received = [
    ...sources(packet).flatMap((source) => source.rows || []),
    ...(packet.linkedContext?.rows || []),
  ].filter(
    (row) =>
      row.id === proof.eventId &&
      Number.isFinite(row.arrivedAt) &&
      row.arrivedAt <= packet.observedAt,
  );
  const revision = Math.max(0, ...received.map((row) => row.revision));
  const current = received.filter((row) => row.revision === revision);
  if (
    !current.length ||
    revision !== proof.revision ||
    current.some(
      (row) =>
        row.operation === 'delete' ||
        row.type !== 'shot' ||
        !Number.isFinite(row.time) ||
        row.time > packet.observedAt ||
        row.time !== proof.time ||
        row.playerId !== proof.playerId ||
        (proof.teamId && row.team !== proof.teamId) ||
        actionOutcome(row)?.status !== proof.actionOutcome.status,
    )
  )
    return null;
  return { proof, row: current[0], reference: claim.evidence[0] };
}

// A bare request for the outcomes of already identified attempts is not a new
// numeric/subset/team/window request. Richer clauses keep the ordinary guards.
export function descriptiveOutcomeRequest(span) {
  const text = String(span || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^[¿¡]+/u, '')
    .replace(/[?!.]+$/u, '');
  return /^(?:how did (?:they|it|those shots|these shots|those attempts|the shots) (?:turn out|end|finish)|what (?:were|are) (?:their outcomes|the outcomes|the results)(?: of (?:those|these|the) (?:shots|attempts))?|comment (?:se sont|ont) (?:ils|elles|ces tirs) (?:termines|fini)|comment (?:ces tirs se sont termines|se sont-ils termines)|quels (?:ont ete|sont) leurs resultats|como (?:terminaron|acabaron|terminaram|sairam)(?: (?:esos|estos|os|aqueles) (?:tiros|remates))?)$/u.test(
    text,
  );
}

// Derive the writer's mandatory inventory from the same proof used by review.
// Assist/supply stories cannot substitute for a distinct attempt outcome.
export function rankedOutcomeCompositionFacts(manifest, packet, rankingIds) {
  const spans = (packet.requestComponents || []).filter(descriptiveOutcomeRequest);
  if (spans.length !== 1 || !rankingIds?.length) return null;
  const required = [];
  for (const rankId of rankingIds) {
    const rank = manifest.facts.find((f) => f.id === rankId);
    if (!rank || rank.proof.kind !== 'player-count-ranking' || rank.proof.metric !== 'attempts')
      return null;
    const p = rank.proof,
      leaders = new Set((p.leaders || []).map((leader) => leader.id));
    const events = manifest.facts
      .filter(
        (f) =>
          f.proof.kind === 'event' &&
          f.proof.eventType === 'shot' &&
          !f.proof.attributes &&
          leaders.has(f.proof.playerId) &&
          f.proof.time >= p.timeFrom &&
          f.proof.time <= p.timeTo &&
          !(p.timeFromExclusive && f.proof.time === p.timeFrom) &&
          !(p.timeToExclusive && f.proof.time === p.timeTo),
      )
      .sort(
        (a, b) => a.proof.time - b.proof.time || a.proof.eventId.localeCompare(b.proof.eventId),
      );
    const facts = [rank, ...events],
      selection = {
        claims: facts.map((f) => f.claim),
        proofs: facts.map((f) => ({ ...f.proof, factId: f.id })),
      };
    const part = { requestSpan: spans[0], claimIndices: events.map((_, i) => i + 1) };
    if (!rankedOutcomeInventory(part, { claims: selection.claims }, selection, packet)) return null;
    required.push(...facts.map((f) => f.id));
  }
  const ids = [...new Set(required)];
  return ids.length <= 4 ? ids : null;
}

// Prove the entire listed inventory from a complete canonical ranking source.
// A correct count alone never substitutes for missing outcome observations.
export function rankedOutcomeInventory(part, answer, selection, packet, demand = null) {
  if (
    !descriptiveOutcomeRequest(part.requestSpan) ||
    !Array.isArray(part.claimIndices) ||
    new Set(part.claimIndices).size !== part.claimIndices.length
  )
    return null;
  const outcomes = part.claimIndices
    .map((index) => canonicalShotOutcome(index, answer, selection, packet))
    .filter(Boolean);
  if (!outcomes.length || new Set(outcomes.map((item) => item.row.id)).size !== outcomes.length)
    return null;
  for (const [index, rank] of (selection?.proofs || []).entries()) {
    const canonical = selection.claims?.[index],
      claim = answer.claims?.[index];
    if (
      rank.kind !== 'player-count-ranking' ||
      rank.metric !== 'attempts' ||
      rank.direction !== 'max' ||
      rank.modelGenerated !== false ||
      !canonical ||
      claim?.text !== canonical.text ||
      !sameRefs(claim.evidence, canonical.evidence) ||
      !claim.evidence.some((ref) => key(ref) === key(rank.scope))
    )
      continue;
    const source = sources(packet).find((source) => key(source.scopeReference) === key(rank.scope));
    const query = source?.query,
      filters = query?.filters;
    if (
      !source ||
      source.truncated !== false ||
      query.aggregate !== 'by-player' ||
      filters?.type !== 'shot' ||
      Object.entries(filters).some(
        ([name, value]) => !['type', 'team'].includes(name) && value != null,
      ) ||
      !windowMatches(query, rank) ||
      !Number.isFinite(query.timeFrom) ||
      !Number.isFinite(query.timeTo) ||
      query.timeFrom < 0 ||
      query.timeTo > packet.observedAt ||
      query.timeFrom > query.timeTo ||
      !Array.isArray(source.groups) ||
      !source.groups.length ||
      new Set(source.groups.map((group) => group.key)).size !== source.groups.length ||
      source.matchedGroupCount !== source.groups.length ||
      !Number.isSafeInteger(source.count) ||
      source.count <= 0 ||
      source.groups.some((group) => !Number.isSafeInteger(group.count) || group.count < 0) ||
      source.groups.reduce((sum, group) => sum + group.count, 0) !== source.count ||
      rank.totalCount !== source.count ||
      rank.matchedGroupCount !== source.matchedGroupCount ||
      rank.groups?.length !== source.groups.length ||
      new Set(rank.groups.map((group) => group.id)).size !== rank.groups.length ||
      !rank.groups.every((group) =>
        source.groups.some((other) => other.key === group.id && other.count === group.count),
      )
    )
      continue;
    const maximum = Math.max(...source.groups.map((group) => group.count)),
      leaders = source.groups.filter((group) => group.count === maximum),
      ids = new Set(leaders.map((group) => group.key));
    if (
      maximum <= 0 ||
      ids.size !== leaders.length ||
      rank.value !== maximum ||
      rank.leaders?.length !== leaders.length ||
      !rank.leaders.every((leader) => ids.has(leader.id) && leader.count === maximum)
    )
      continue;
    if (
      demand &&
      (demand.action !== 'shot' ||
        demand.state !== 'any' ||
        demand.grouping !== 'by-player' ||
        !Array.isArray(demand.subjectIds) ||
        new Set(demand.subjectIds).size !== ids.size ||
        demand.subjectIds.length !== ids.size ||
        demand.subjectIds.some((id) => !ids.has(id)) ||
        !windowMatches(demand, rank) ||
        (demand.requestSpan !== undefined && demand.requestSpan !== part.requestSpan) ||
        (demand.qualifiers && Object.values(demand.qualifiers).some((value) => value != null)))
    )
      continue;
    if (
      outcomes.some(
        ({ row }) =>
          !ids.has(row.playerId) ||
          (filters.team && row.team !== filters.team) ||
          row.time < rank.timeFrom ||
          row.time > rank.timeTo ||
          (rank.timeFromExclusive && row.time === rank.timeFrom) ||
          (rank.timeToExclusive && row.time === rank.timeTo),
      )
    )
      continue;
    if (
      !leaders.every(
        (leader) =>
          outcomes.filter((item) => item.row.playerId === leader.key).length === leader.count,
      )
    )
      continue;
    return {
      rankFactId: rank.factId,
      leaderIds: [...ids],
      events: outcomes.map((item) => item.reference),
      window: { from: rank.timeFrom, to: rank.timeTo },
    };
  }
  return null;
}
