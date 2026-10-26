const key = (ref) => `${ref?.type}:${ref?.id}@${ref?.revision}`;

/** An identity list is not a request to print a numeric count for each actor.
 * A complete cited list plus current canonical actor observations can prove
 * the full positive actor inventory. It cannot satisfy a quantity request,
 * an outcome subset, a missing actor, or a truncated source.
 */
export function canonicalIdentityInventory(part, answer, selection, packet, demand) {
  if (
    demand?.grouping !== 'by-player' ||
    demand.state !== 'any' ||
    !['shot', 'pass', 'receive', 'recovery'].includes(demand.action) ||
    Object.values(demand.qualifiers || {}).some((value) => value !== null)
  )
    return false;
  const chosen = (part.claimIndices || []).map((index) => ({
    proof: selection?.proofs?.[index],
    claim: answer.claims[index],
  }));
  const sources = [...(packet.requestedEvidence || []), ...(packet.queryResults || [])];
  return sources.some((source) => {
    const q = source.query,
      rows = source.rows;
    if (
      q?.aggregate !== 'list' ||
      q.filters?.type !== demand.action ||
      Object.keys(q.filters).some((k) => !['type', 'team'].includes(k)) ||
      source.scopeReference?.type !== 'scope' ||
      source.truncated !== false ||
      !Array.isArray(rows) ||
      !rows.length ||
      source.count !== rows.length ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      Object.values(source.scope?.missingFields || {}).some((n) => n > 0) ||
      q.timeFrom !== demand.timeFrom ||
      q.timeTo !== demand.timeTo ||
      ['timeFromExclusive', 'timeToExclusive'].some((k) => !!q[k] !== !!demand[k]) ||
      !chosen.some(({ claim }) =>
        claim?.evidence.some((ref) => key(ref) === key(source.scopeReference)),
      )
    )
      return false;
    const roster = new Set((packet.roster || []).map((player) => player.id));
    if (
      rows.some(
        (row) =>
          row.type !== demand.action ||
          !roster.has(row.playerId) ||
          !Number.isSafeInteger(row.revision) ||
          row.revision < 1 ||
          row.time < q.timeFrom ||
          row.time > q.timeTo ||
          row.arrivedAt > packet.observedAt,
      )
    )
      return false;
    const expected = new Set(rows.map((row) => row.playerId));
    const represented = new Set(
      chosen.flatMap(({ proof, claim }) => {
        if (
          proof?.kind !== 'event' ||
          proof.modelGenerated !== false ||
          proof.eventType !== demand.action
        )
          return [];
        const row = rows.find(
          (row) =>
            row.id === proof.eventId &&
            row.revision === proof.revision &&
            row.playerId === proof.playerId,
        );
        return row &&
          claim?.evidence.some(
            (ref) => ref.type === 'event' && ref.id === row.id && ref.revision === row.revision,
          )
          ? [row.playerId]
          : [];
      }),
    );
    return (
      [...expected].every((id) => represented.has(id)) &&
      [...represented].every((id) => expected.has(id)) &&
      (!demand.subjectIds.length ||
        (new Set(demand.subjectIds).size === expected.size &&
          demand.subjectIds.every((id) => expected.has(id))))
    );
  });
}
