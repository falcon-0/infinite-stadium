import { performance } from 'node:perf_hooks';
const requestTimings = new WeakMap();
export function beginQuestionTiming(response, segment) {
  if (!['wrapper', 'handler', 'requestBody', 'wrapperBody', 'runtimeInit'].includes(segment))
    return;
  let timings = requestTimings.get(response);
  if (!timings) {
    timings = {};
    requestTimings.set(response, timings);
  }
  timings[segment] ??= performance.now();
}
export function endQuestionTiming(response, segment) {
  const timings = requestTimings.get(response);
  if (timings && Number.isFinite(timings[segment]) && timings[segment + 'Ms'] === undefined)
    timings[segment + 'Ms'] = Math.max(0, performance.now() - timings[segment]);
}
export function questionTimingSegments(response) {
  const timings = requestTimings.get(response) || {},
    now = performance.now();
  return {
    scope: 'in-process-only-platform-and-esm-bootstrap-excluded',
    wrapperMs: Number.isFinite(timings.wrapper) ? duration(now - timings.wrapper) : null,
    handlerMs: Number.isFinite(timings.handler) ? duration(now - timings.handler) : null,
    runtimeInitMs: duration(timings.runtimeInitMs),
    wrapperBodyMs: duration(timings.wrapperBodyMs),
    requestBodyMs: duration(timings.requestBodyMs),
  };
}
const stageNames = new Set([
  'answer-or-query',
  'planning-repair',
  'answer-after-query',
  'review',
  'repair',
  'select-rule-facts',
]);
const failureCodes = new Set([
  'question-withheld',
  'question-invalid-fact-selection',
  'question-invalid-operation',
  'question-call-limit',
  'azure-network',
  'azure-timeout',
  'azure-http',
  'generation-busy',
]);
export const reviewPredicateNames = Object.freeze([
  'requestAdequacy',
  'coverage',
  'rules',
  'requestStatus',
  'claimSupport',
  'inventedFacts',
]);
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 10000) : null;
const duration = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.round(Math.min(value, 3600000)) : null;

// Diagnostic failures must never change answer generation or its review verdict.
export function emitQuestionDiagnostic(listener, event) {
  try {
    if (typeof listener === 'function') listener(event);
  } catch {}
}

// The only strings retained are application-owned enums and a generated UUID.
// Never traverse Error.feedback, model responses, questions or request headers.
export function createQuestionDiagnostics(requestId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error('A generated request UUID is required.');
  const stages = [],
    reviews = [];
  return {
    requestId,
    record(event) {
      if (event?.type === 'stage' && stageNames.has(event.stage) && stages.length < 8) {
        stages.push({
          stage: event.stage,
          elapsedMs: duration(event.elapsedMs),
          outcome: ['completed', 'failed'].includes(event.outcome) ? event.outcome : 'unknown',
        });
      }
      if (event?.type === 'review' && reviews.length < 3) {
        reviews.push({
          reviewComplete: event.reviewComplete === true,
          predicates: Object.fromEntries(
            reviewPredicateNames.map((name) => [
              name,
              typeof event.predicates?.[name] === 'boolean' ? event.predicates[name] : null,
            ]),
          ),
          actorValidationRan: event.actorValidationRan === true,
          actorIssueCount: count(event.actorIssueCount),
          countIssueCount: count(event.countIssueCount),
          requestAdequacyIssueCount: count(event.requestAdequacyIssueCount),
          claimCount: count(event.claimCount),
          reviewCheckCount: count(event.reviewCheckCount),
          decision: ['approve', 'withhold'].includes(event.decision) ? event.decision : 'unknown',
        });
      }
    },
    failure(error, status, elapsedMs) {
      return {
        event: 'match-question-failure',
        version: 1,
        requestId,
        status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500,
        code: failureCodes.has(error?.code) ? error.code : 'other',
        elapsedMs: duration(elapsedMs),
        modelCalls: stages.length,
        stages: structuredClone(stages),
        reviews: structuredClone(reviews),
      };
    },
  };
}
