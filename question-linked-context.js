// Recover contextual observations only through explicit received source links.
// This never infers forcing, nearest-event adjacency, or first/next order.
export function linkedRecoveryContextFacts(facts, sources, links) {
  const anchors = new Set(
    sources
      .filter(
        (s) =>
          s.query?.aggregate === 'list' &&
          s.query.filters?.type === 'pass' &&
          s.query.filters.result === false,
      )
      .flatMap((s) =>
        [...(s.rows || []), ...(s.rowReferences || [])].map((row) =>
          JSON.stringify([row.id, row.revision]),
        ),
      ),
  );
  const witnesses = new Set(
    links
      .filter(
        (link) =>
          link.anchorType === 'pass' &&
          link.witnessType === 'recovery' &&
          anchors.has(JSON.stringify([link.anchor.id, link.anchor.revision])),
      )
      .map((link) => JSON.stringify([link.witness.id, link.witness.revision])),
  );
  return facts.filter((fact) => {
    const p = fact.proof?.kind === 'ordered-event' ? fact.proof.event : fact.proof;
    return (
      p?.eventType === 'recovery' &&
      !p.attributes &&
      witnesses.has(JSON.stringify([p.eventId, p.revision]))
    );
  });
}
