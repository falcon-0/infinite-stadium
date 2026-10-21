import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedRecoveryContextFacts } from './question-linked-context.js';
const fact = {
  id: 'recovery',
  proof: { kind: 'event', eventType: 'recovery', eventId: 'r', revision: 2 },
};
const source = {
  query: { aggregate: 'list', filters: { type: 'pass', player: 'loser', result: false } },
  rows: [{ id: 'p', revision: 3 }],
};
const link = {
  anchorType: 'pass',
  witnessType: 'recovery',
  anchor: { id: 'p', revision: 3 },
  witness: { id: 'r', revision: 2 },
};
test('explicit received pass link keeps the opposing recovery even when a model queried the wrong recovering actor', () => {
  const bad = {
    query: { aggregate: 'list', filters: { type: 'recovery', player: 'loser' } },
    rows: [],
  };
  assert.deepEqual(linkedRecoveryContextFacts([fact], [source, bad], [link]), [fact]);
  assert.deepEqual(
    linkedRecoveryContextFacts(
      [fact],
      [{ ...source, rows: [], rowReferences: source.rows }],
      [link],
    ),
    [fact],
  );
});
test('no adjacency, wrong revision, unrelated query, attribute or unlinked recovery is accepted', () => {
  assert.deepEqual(linkedRecoveryContextFacts([fact], [source], []), []);
  for (const change of [
    { ...link, anchor: { id: 'p', revision: 2 } },
    { ...link, witness: { id: 'r', revision: 1 } },
    { ...link, anchorType: 'shot' },
  ])
    assert.deepEqual(linkedRecoveryContextFacts([fact], [source], [change]), []);
  assert.deepEqual(linkedRecoveryContextFacts([fact], [], [link]), []);
  assert.deepEqual(
    linkedRecoveryContextFacts(
      [{ ...fact, proof: { ...fact.proof, attributes: { bodyPart: 'left-foot' } } }],
      [source],
      [link],
    ),
    [],
  );
});
