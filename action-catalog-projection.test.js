import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActionLookupFacts } from './match-question-ai.js';

const facts = [
  { id: 'action', proof: { kind: 'event' } },
  { id: 'total', proof: { kind: 'count', value: 1 } },
  { id: 'boundary', proof: { kind: 'capability-limitation' } },
];
const catalog = { sourceFingerprint: 'complete-source', facts };
const request = {
  question: 'Did he force the mistake, or only recover the ball?',
  requestedForm: 'fact',
  requestedEvidence: [
    {
      query: {
        aggregate: 'list',
        filters: { type: 'recovery', player: 'home-7' },
        limit: 1,
        timeFrom: 0,
        timeTo: 70,
      },
    },
  ],
};
test('narrow action selection omits unsolicited totals while retaining source-bound facts and uncertainty', () => {
  const before = structuredClone(catalog),
    result = projectActionLookupFacts(catalog, request);
  assert.deepEqual(
    result.facts.map((f) => f.id),
    ['action', 'boundary'],
  );
  assert.equal(result.sourceFingerprint, catalog.sourceFingerprint);
  assert.deepEqual(catalog, before);
  assert.equal(result.facts[0], catalog.facts[0]);
});
test('verified zero counts remain available to correct a false action premise', () => {
  const zero = { id: 'absence', proof: { kind: 'count', value: 0 } },
    full = { ...catalog, facts: [...facts, zero] };
  assert.ok(projectActionLookupFacts(full, request).facts.includes(zero));
});
test('quantity requests, broader histories, comparisons and assessments retain the complete catalog', () => {
  for (const question of [
    'How many recoveries did he make?',
    'Combien de récupérations ?',
    'Quantas recuperações fez?',
    '¿Cuántas recuperaciones hizo?',
  ])
    assert.equal(projectActionLookupFacts(catalog, { ...request, question }), catalog);
  for (const extra of [
    { requestedForm: 'assessment' },
    { requestedForm: 'explanation' },
    { requestedEvidence: [] },
    { requestedEvidence: [{ query: { aggregate: 'by-team', filters: { type: 'recovery' } } }] },
    {
      requestedEvidence: [
        { query: { aggregate: 'list', filters: { type: 'recovery' }, limit: 20 } },
      ],
    },
  ])
    assert.equal(projectActionLookupFacts(catalog, { ...request, ...extra }), catalog);
});
