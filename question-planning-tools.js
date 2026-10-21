// Read-only query augmentation and component-window ownership.
// These helpers call only the supplied application query executor.
import { GenerationError } from './ai.js';

export function requestedPlayerRankings(definitions, run, sources = []) {
  const queries = new Map();
  for (const [index, query] of (definitions || []).entries()) {
    if (
      query.aggregate !== 'by-player' ||
      query.groupOrder !== 'count-desc' ||
      query.limit !== 1 ||
      query.relativeTo ||
      (query.groupCount && Object.keys(query.groupCount).length) ||
      ['id', 'player', 'receiver', 'assistPlayer'].some((key) => query.filters?.[key] != null)
    )
      continue;
    const complete = { ...(sources[index]?.query || query), limit: 20 };
    delete complete.relativeTo;
    queries.set(JSON.stringify(complete), complete);
  }
  return [...queries.values()].slice(0, 3).map(run);
}

export function requestedListCounts(sources, run) {
  const definitions = new Map();
  for (const source of sources) {
    const query = source?.query;
    if (
      query?.aggregate !== 'list' ||
      !query.filters?.type ||
      query.filters.id ||
      query.groupCount ||
      Object.values(source.entityResolution || {}).some(
        (entity) => entity?.status && entity.status !== 'resolved',
      )
    )
      continue;
    const definition = {
      filters: { ...query.filters },
      aggregate: 'count',
      timeFrom: query.timeFrom,
      timeTo: query.timeTo,
      ...(Object.hasOwn(query, 'timeFromExclusive')
        ? { timeFromExclusive: query.timeFromExclusive }
        : {}),
      ...(Object.hasOwn(query, 'timeToExclusive')
        ? { timeToExclusive: query.timeToExclusive }
        : {}),
    };
    definitions.set(JSON.stringify(definition), definition);
  }
  if (definitions.size > 3) return [];
  return [...definitions.values()].map(run);
}

export function bindComponentWindowQueries(queries, bindings) {
  if (!bindings.length) return { queries, bindings: [] };
  const invalid = () => {
    const error = new GenerationError(
      'Each independently timed request component needs its own exact query ownership and bounds.',
      502,
      'question-invalid-operation',
    );
    error.planningCorrection = {
      kind: 'component-window-binding',
      requiredComponents: bindings,
      instruction:
        'Return requestSpan and query envelopes. Copy the exact component and its own bounds. Do not map by query position or apply another component window. Before/after are exclusive; since is inclusive.',
    };
    throw error;
  };
  if (!Array.isArray(queries) || !queries.length || queries.length > 3) invalid();
  const owned = queries.map((entry, queryIndex) => {
    if (
      !entry ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, 'requestSpan') ||
      !Object.hasOwn(entry, 'query')
    )
      invalid();
    const binding = bindings.find((item) => item.requestSpan === entry.requestSpan),
      query = entry.query;
    if (
      !binding ||
      !query ||
      typeof query !== 'object' ||
      Array.isArray(query) ||
      query.relativeTo ||
      Object.entries(binding.window).some(([key, value]) => query[key] !== value)
    )
      invalid();
    return { query, requestSpan: binding.requestSpan, window: binding.window, queryIndex };
  });
  if (bindings.some((binding) => !owned.some((item) => item.requestSpan === binding.requestSpan)))
    invalid();
  return {
    queries: owned.map((item) => item.query),
    bindings: owned.map(({ query, ...item }) => item),
  };
}

export function requestedAttackingQueries(planned, run, { answerFocus, requestedForm } = {}) {
  // The semantic task stays comparative when the fan also asks for an
  // explanation. Supply the same complete measured evidence for both forms;
  // do not leave the writer to infer team totals from selected shot examples.
  if (
    answerFocus !== 'team-attacking-assessment' ||
    !['assessment', 'explanation'].includes(requestedForm)
  )
    return [];
  const windows = new Map();
  for (const { query } of planned) {
    const window = {
      timeFrom: query.timeFrom,
      timeTo: query.timeTo,
      ...(query.timeFromExclusive ? { timeFromExclusive: true } : {}),
      ...(query.timeToExclusive ? { timeToExclusive: true } : {}),
    };
    if (Number.isFinite(window.timeFrom) && Number.isFinite(window.timeTo))
      windows.set(JSON.stringify(window), window);
  }
  return [...windows.values()].flatMap((window) =>
    [{ type: 'shot' }, { type: 'shot', outcome: 'on-target' }].map((filters) =>
      run({ filters, aggregate: 'by-team', ...window }),
    ),
  );
}
