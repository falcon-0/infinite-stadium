import { allowedOperationMetrics } from './operation-capabilities.js';

const normalize = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const passNoun = /\b(?:pass(?:es)?|pases?|passe)\b/u;
const selection =
  /\b(?:first|earliest|last|latest|most recent|how many|number|total|most|fewest|more|fewer|plus|moins|mas|menos|mais|premier\w*|dernier\w*|combien|primer\w*|ultim\w*|cuantos|cuantas|primeir\w*|quantos|quantas)\b/u;
const broadening =
  /\b(?:not just|not only|regardless|whether or not|including|instead of|pas seulement|pas uniquement|y compris|no solo|no solamente|incluyendo|nao apenas|nao so|incluindo)\b/u;
const negative =
  /\b(?:not|never|isn't|wasn't|weren't|aren't|didn't|without|excluding|except|non|sans|sauf|sin|excepto|nao|sem)\b/u;

/** A single explicit completion-count contract. Outcome questions about one
 * selected pass, mixed outcome buckets and ratios remain outside this binding.
 */
export function explicitCompletedPassCount(input = {}) {
  const text = normalize(input.question);
  return (
    passNoun.test(text) &&
    /\b(?:more|fewer|less|how many|number|count|totals?|combien|plus|moins|cuantos|cuantas|mas|menos|quantos|quantas|mais)\b/u.test(
      text,
    ) &&
    !broadening.test(text) &&
    !negative.test(text) &&
    !/\b(?:failed|unsuccessful|pending|unresolved|unsettled|awaiting|unconfirmed|accuracy|percentage|percent|ratio|rate|manque\w*|fallid\w*|pendiente\w*|pendente\w*|falhad\w*)\b/u.test(
      text,
    ) &&
    allowedOperationMetrics(input).includes('completedPasses')
  );
}

/** A bounded license for outcome filters when selecting/counting passes.
 * It does not infer answers, actors or outcomes. Unsupported qualifiers retain
 * the complete pass inventory; the planner must not silently choose a subset.
 * Qualitative contribution queries are outside this selector-specific guard. */
export function passQuerySelectionPermission(input = {}) {
  const current = normalize(input.question);
  let topic = current;
  if (
    !passNoun.test(current) &&
    /\b(?:and|what about|which|how many|et|y|e|combien|cuantos|quantos|those|them|ones|last|latest)\b/u.test(
      current,
    )
  ) {
    const history = Array.isArray(input.conversation)
      ? input.conversation.map((turn) => normalize(turn?.question))
      : [];
    if (!history.length && input.previousQuestion) history.push(normalize(input.previousQuestion));
    const previous = history.at(-1);
    if (previous && passNoun.test(previous)) topic = previous + ' ' + current;
  }
  const constrained = passNoun.test(topic) && selection.test(topic);
  if (!constrained)
    return {
      constrained: false,
      results: [true, false],
      outcomes: ['completed', 'failed', 'pending'],
    };
  // Asking about the outcome of an already selected pass never licenses a
  // filter that substitutes an older pass with the desired outcome.
  const outcomeQuestion =
    /^[¿?\s]*(?:was|were|is|are|did|does|has|had|est ce que|est|etait|a t il|fue|era|es|foi|era|o ultimo|a ultima)\b/u.test(
      current,
    );
  if (
    broadening.test(topic) ||
    negative.test(topic) ||
    (outcomeQuestion && !explicitCompletedPassCount(input))
  )
    return { constrained: true, results: [], outcomes: [] };
  const completed = allowedOperationMetrics({
    ...input,
    question: topic.replace(/\bpase\b/gu, 'pases'),
    conversation: [],
    previousQuestion: null,
  }).includes('completedPasses');
  const failed =
    /\b(?:failed|unsuccessful|incomplete|incomplet(?:e?s?|os?|as?)|rates?|echoues?|fallidos?|fallados?|malsucedidos?)\b/u.test(
      topic,
    );
  return {
    constrained: true,
    results: [...(completed ? [true] : []), ...(failed ? [false] : [])],
    outcomes: [],
  };
}

export function passQueryOutcomeAllowed(input, query) {
  const permission = passQuerySelectionPermission(input);
  if (!permission.constrained) return true;
  const filters = query?.filters || {};
  // A missing event type must not turn a pass selector into a mixed inventory
  // of successful passes and goals. Explicit supporting shot queries remain valid.
  if (
    filters.type === undefined &&
    (Object.hasOwn(filters, 'result') || Object.hasOwn(filters, 'outcome'))
  )
    return false;
  if (filters.type !== 'pass') return true;
  return (
    (!Object.hasOwn(filters, 'result') || permission.results.includes(filters.result)) &&
    (!Object.hasOwn(filters, 'outcome') || permission.outcomes.includes(filters.outcome))
  );
}

/** Bind the one explicit outcome for a proposed aggregate count. Supporting
 * event lists, mixed-state questions and explicit conflicting filters remain
 * unchanged and must pass the ordinary query/coverage checks.
 */
export function bindExplicitCompletedPassCount(input, query) {
  if (
    !explicitCompletedPassCount(input) ||
    query?.filters?.type !== 'pass' ||
    !['count', 'by-team', 'by-player'].includes(query.aggregate) ||
    Object.hasOwn(query.filters, 'result') ||
    Object.hasOwn(query.filters, 'outcome')
  )
    return query;
  return { ...query, filters: { ...query.filters, result: true } };
}
