// Lossless transport compaction only. Internal evidence and validation packets
// remain untouched; requested query results stay complete and ordered.
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
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const identity = (ref) =>
  ref &&
  typeof ref.type === 'string' &&
  typeof ref.id === 'string' &&
  Number.isSafeInteger(ref.revision)
    ? `${ref.type}:${ref.id}@${ref.revision}`
    : null;
function eventIdentities(query) {
  if (
    !Array.isArray(query.rows) ||
    (query.rowReferences !== undefined && !Array.isArray(query.rowReferences))
  )
    return null;
  const refs = [];
  for (const row of query.rows || []) {
    if (!row || typeof row.id !== 'string' || !Number.isSafeInteger(row.revision)) return null;
    refs.push(`event:${row.id}@${row.revision}`);
  }
  for (const ref of query.rowReferences || []) {
    const id = identity(ref);
    if (!id || ref.type !== 'event') return null;
    refs.push(id);
  }
  return [...new Set(refs)].sort();
}
function equivalentQuery(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (
    identity(left.scopeReference) !== identity(right.scopeReference) ||
    !identity(left.scopeReference)
  )
    return false;
  const { rows: a, rowReferences: b, ...leftMetadata } = left,
    { rows: c, rowReferences: d, ...rightMetadata } = right;
  const leftEvents = eventIdentities(left),
    rightEvents = eventIdentities(right);
  if (
    !leftEvents ||
    !rightEvents ||
    !same(leftMetadata, rightMetadata) ||
    !same(leftEvents, rightEvents)
  )
    return false;
  // If both copies include a record, all its fields must agree. References may
  // replace records only when the intact requested result retains that record.
  for (const row of right.rows || []) {
    const original = (left.rows || []).find(
      (item) => item.id === row.id && item.revision === row.revision,
    );
    if (!original || !same(original, row)) return false;
  }
  return true;
}
export function compactQuestionWirePacket(packet) {
  const result = structuredClone(packet);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (Array.isArray(result.requestedEvidence) && Array.isArray(result.queryResults)) {
    result.queryResults = result.queryResults.filter(
      (query) => !result.requestedEvidence.some((requested) => equivalentQuery(requested, query)),
    );
  }
  for (const query of [
    ...(Array.isArray(result.requestedEvidence) ? result.requestedEvidence : []),
    ...(Array.isArray(result.queryResults) ? result.queryResults : []),
  ]) {
    if (
      query?.scope &&
      Object.hasOwn(query.scope, 'entityResolution') &&
      same(query.scope.entityResolution, query.entityResolution)
    )
      delete query.scope.entityResolution;
  }
  return result;
}
