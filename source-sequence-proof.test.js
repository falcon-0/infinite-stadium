import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceSequenceLinks, sourceSequenceWitness } from './source-sequence-proof.js';
const shot = { id: 'shot', revision: 1, type: 'shot', time: 89, team: 'home', playerId: 'shooter' };
const recovery = {
  id: 'recovery',
  revision: 1,
  type: 'recovery',
  time: 91,
  team: 'away',
  playerId: 'collector',
  cause: 'shot',
};
const ref = (row) => ({ type: 'event', id: row.id, revision: row.revision });
function setup() {
  return {
    packet: { observedAt: 95, linkedContext: { rows: [shot, recovery] } },
    part: {
      relationSourceLinkIndex: 0,
      temporalRelation: 'after-requested-event',
      relationEntityBinding: 'none',
      requestedAction: 'recovery',
      claimIndices: [0],
    },
    answer: { claims: [{ evidence: [ref(recovery)] }] },
    checks: [{ cited: [{ reference: ref(recovery), record: recovery }] }],
    selection: { proofs: [{ kind: 'event', eventId: 'recovery', revision: 1, time: 91 }] },
  };
}
const witness = (s) => sourceSequenceWitness(s.part, s.answer, s.checks, s.selection, s.packet);
test('source-linked collection keeps a requested shot internal without inventing causation or order', () => {
  const s = setup(),
    proof = witness(s);
  assert.equal(proof.anchor.id, 'shot');
  assert.equal(proof.witness.id, 'recovery');
  assert.ok(proof.doesNotProve.includes('causation'));
  assert.ok(proof.doesNotProve.includes('first-or-next-event'));
});
test('unlinked, conflicting, stale, deleted, future and simultaneous records cannot prove a source sequence', () => {
  for (const change of [
    { cause: undefined },
    { passId: 'different' },
    { time: 89 },
    { time: 96 },
    { operation: 'delete' },
  ]) {
    const s = setup();
    s.packet.linkedContext.rows[1] = { ...recovery, ...change };
    assert.equal(witness(s), false, JSON.stringify(change));
  }
  const s = setup();
  s.packet.linkedContext.rows.push({ ...shot, revision: 2, operation: 'delete' });
  assert.deepEqual(sourceSequenceLinks(s.packet), []);
});
test('source sequence rejects wrong identity bindings, action, direction, selected fact or reference', () => {
  for (const change of [
    { relationSourceLinkIndex: 1 },
    { relationSourceLinkIndex: null },
    { relationEntityBinding: 'same-team' },
    { relationEntityBinding: 'same-player' },
    { temporalRelation: 'before-requested-event' },
    { requestedAction: 'shot' },
  ]) {
    const s = setup();
    Object.assign(s.part, change);
    assert.equal(witness(s), false, JSON.stringify(change));
  }
  for (const change of [
    { revision: 2 },
    { eventId: 'unrelated' },
    { time: 92 },
    { kind: 'count' },
  ]) {
    const s = setup();
    Object.assign(s.selection.proofs[0], change);
    assert.equal(witness(s), false);
  }
  const s = setup();
  s.answer.claims[0].evidence = [];
  assert.equal(witness(s), false);
});
