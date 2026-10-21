import test from 'node:test';
import assert from 'node:assert/strict';
import { compactQuestionWirePacket } from './question-wire-packet.js';
const ref = (id, revision = 1, type = 'event') => ({ type, id, revision });
const row = (id, revision = 1) => ({
  id,
  revision,
  type: 'pass',
  result: false,
  evidence: [ref(id, revision)],
});
const query = () => ({
  scopeReference: ref('scope', 1, 'scope'),
  query: { filters: { type: 'pass' }, order: 'desc', timeFrom: 0, timeTo: 67 },
  scope: { missingFields: { result: 0 } },
  count: 2,
  truncated: false,
  groups: [],
  rows: [row('new', 2), row('old')],
});
test('transport retains ordered requested evidence and every current record without mutating validation input', () => {
  const requested = query(),
    duplicate = {
      ...structuredClone(requested),
      rows: [row('old')],
      rowReferences: [ref('new', 2)],
    };
  const packet = {
    requestedEvidence: [requested],
    queryResults: [duplicate],
    roster: [{ id: 'p' }],
    pendingOutcomeContext: { count: 1 },
  };
  const before = structuredClone(packet),
    result = compactQuestionWirePacket(packet);
  assert.deepEqual(packet, before);
  assert.deepEqual(result.requestedEvidence, [requested]);
  assert.deepEqual(result.queryResults, []);
  assert.deepEqual(result.roster, packet.roster);
  assert.deepEqual(result.pendingOutcomeContext, packet.pendingOutcomeContext);
  assert.ok(JSON.stringify(result).length < JSON.stringify(packet).length);
});
test('different scope, revision, outcome, coverage, window or incomplete record copies are never deduplicated', () => {
  for (const mutate of [
    (q) => q.scopeReference.revision++,
    (q) => (q.scopeReference.id = 'other'),
    (q) => (q.query.timeFrom = 30),
    (q) => (q.scope.missingFields.result = 1),
    (q) => (q.rows[0].result = true),
    (q) => q.rows.pop(),
    (q) => (q.rowReferences = [ref('foreign')]),
  ]) {
    const requested = query(),
      other = query();
    mutate(other);
    assert.equal(
      compactQuestionWirePacket({ requestedEvidence: [requested], queryResults: [other] })
        .queryResults.length,
      1,
    );
  }
});
test('entity-resolution duplication is removed only on exact equality and never erases the query resolution', () => {
  const resolution = { player: { status: 'ambiguous', candidates: ['one', 'two'] } },
    first = query();
  first.entityResolution = resolution;
  first.scope.entityResolution = structuredClone(resolution);
  const result = compactQuestionWirePacket({ requestedEvidence: [first], queryResults: [] });
  assert.deepEqual(result.requestedEvidence[0].entityResolution, resolution);
  assert.equal(Object.hasOwn(result.requestedEvidence[0].scope, 'entityResolution'), false);
  first.scope.entityResolution = { player: { status: 'absent' } };
  assert.deepEqual(
    compactQuestionWirePacket({ requestedEvidence: [first] }).requestedEvidence[0].scope
      .entityResolution,
    first.scope.entityResolution,
  );
});
test('general and empty packets retain all facts', () => {
  for (const packet of [{ question: 'Offside?', footballKnowledge: { facts: ['a'] } }, {}, null])
    assert.deepEqual(compactQuestionWirePacket(packet), packet);
});
