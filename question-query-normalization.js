// Normalize a model proposal before the read-only query engine validates it.
import { GenerationError } from './ai.js';
import { matchQueryDefinition } from './match-query.js';

export function normalizePlannedQuery(query, observedAt) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;
  const result = { ...query };
  const rootFields = Object.keys(matchQueryDefinition.parameters.properties).filter(
    (key) => key !== 'filters',
  );
  if (result.filters && typeof result.filters === 'object' && !Array.isArray(result.filters)) {
    result.filters = { ...result.filters };
    for (const field of rootFields) {
      if (!Object.hasOwn(result.filters, field)) continue;
      if (
        Object.hasOwn(result, field) &&
        JSON.stringify(result[field]) !== JSON.stringify(result.filters[field])
      )
        throw new GenerationError('Conflicting match query fields.');
      result[field] = result.filters[field];
      delete result.filters[field];
    }
  }
  const fields = Object.keys(matchQueryDefinition.parameters.properties.filters.properties);
  for (const field of fields) {
    if (!Object.hasOwn(result, field)) continue;
    if (
      result.filters !== undefined &&
      (!result.filters || typeof result.filters !== 'object' || Array.isArray(result.filters))
    )
      throw new GenerationError('Invalid match filters.');
    if (Object.hasOwn(result.filters || {}, field) && result.filters[field] !== result[field])
      throw new GenerationError('Conflicting match filters.');
    result.filters = { ...(result.filters || {}), [field]: result[field] };
    delete result[field];
  }
  // The model may request a window extending beyond the question's timestamp.
  // Clip its upper bound to received time; never retrieve a future event.
  if (Number.isFinite(result.timeTo) && result.timeTo > observedAt) result.timeTo = observedAt;
  return result;
}
