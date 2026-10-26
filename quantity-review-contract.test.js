import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quantityPopulationSchema,
  normalizeQuantityReviewPopulations,
} from './quantity-review-contract.js';
test('population wire alternatives keep team and player identifiers disjoint', () => {
  const choices = quantityPopulationSchema(['home-7', 'away-10']).anyOf;
  assert.equal(choices.length, 4);
  assert.equal(choices[0].properties.subjectIds.maxItems, 0);
  assert.deepEqual(choices[1].properties.subjectIds.items.enum, ['home', 'away']);
  assert.deepEqual(choices[2].properties.subjectIds.items.enum, ['home-7', 'away-10']);
});
test('population decoding preserves declared scope and never guesses invalid entities or conflicting fields', () => {
  const review = {
    requestCheck: {
      coverage: [
        {
          requestedQuantity: [
            { action: 'shot', population: { grouping: 'by-player', subjectIds: ['away-10'] } },
          ],
        },
      ],
    },
  };
  const before = structuredClone(review),
    normalized = normalizeQuantityReviewPopulations(review);
  assert.deepEqual(normalized.requestCheck.coverage[0].requestedQuantity, [
    { action: 'shot', grouping: 'by-player', subjectIds: ['away-10'] },
  ]);
  assert.deepEqual(review, before);
  const invalid = structuredClone(review);
  invalid.requestCheck.coverage[0].requestedQuantity[0].population.subjectIds = ['away'];
  assert.deepEqual(
    normalizeQuantityReviewPopulations(invalid).requestCheck.coverage[0].requestedQuantity[0]
      .subjectIds,
    ['away'],
    'runtime must still reject wrong-type IDs; decoder does not fix them',
  );
  for (const change of [
    (d) => (d.grouping = 'combined'),
    (d) => (d.population.extra = true),
    (d) => delete d.population.subjectIds,
  ]) {
    const bad = structuredClone(review);
    change(bad.requestCheck.coverage[0].requestedQuantity[0]);
    assert.throws(() => normalizeQuantityReviewPopulations(bad), RangeError);
  }
  assert.deepEqual(normalizeQuantityReviewPopulations(normalized), normalized);
});
