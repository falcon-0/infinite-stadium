const strict = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Factor population choices separately from action/outcome choices. This
 * prevents a team ID from entering a per-player obligation without expanding
 * the complete quantity contract once for every action/group combination.
 */
export function quantityPopulationSchema(players) {
  const teams = ['home', 'away'];
  return {
    anyOf: [
      ['combined', []],
      ['by-team', teams],
      ['by-player', players],
      ['named-entity', [...teams, ...players]],
    ].map(([grouping, ids]) =>
      strict({
        grouping: { type: 'string', enum: [grouping] },
        subjectIds: {
          type: 'array',
          minItems: 0,
          maxItems: ids.length,
          items: ids.length ? { type: 'string', enum: ids } : { type: 'string' },
        },
      }),
    ),
  };
}

/** Decode the new wire shape without guessing or changing any population.
 * Recorded older reviews retain their original shape and validation path.
 */
export function normalizeQuantityReviewPopulations(review) {
  const copy = structuredClone(review);
  for (const part of copy.requestCheck?.coverage || []) {
    if (!Array.isArray(part.requestedQuantity)) continue;
    part.requestedQuantity = part.requestedQuantity.map((demand) => {
      if (!demand || !Object.hasOwn(demand, 'population')) return demand;
      const { population, ...rest } = demand;
      if (
        !population ||
        typeof population !== 'object' ||
        Array.isArray(population) ||
        Object.keys(population).length !== 2 ||
        !Object.hasOwn(population, 'grouping') ||
        !Array.isArray(population.subjectIds) ||
        Object.hasOwn(rest, 'grouping') ||
        Object.hasOwn(rest, 'subjectIds')
      )
        throw new RangeError('Quantity population has conflicting or missing fields.');
      return { ...rest, grouping: population.grouping, subjectIds: population.subjectIds };
    });
  }
  return copy;
}
