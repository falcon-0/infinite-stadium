import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createQuestionDiagnostics,
  emitQuestionDiagnostic,
  reviewPredicateNames,
  beginQuestionTiming,
  endQuestionTiming,
  questionTimingSegments,
} from './question-diagnostics.js';
const id = '248c7805-d921-4b7a-80f4-684181cd8240';

test('question diagnostic summaries retain only fixed predicates, counters, stages and generated correlation IDs', () => {
  const diagnostic = createQuestionDiagnostics(id),
    secret = 'PRIVATE_PROMPT_COOKIE_TOKEN_PROSE';
  const predicates = Object.fromEntries(reviewPredicateNames.map((name) => [name, true]));
  predicates.coverage = false;
  predicates.secret = secret;
  diagnostic.record({
    type: 'stage',
    stage: 'review',
    elapsedMs: 123.6,
    outcome: 'completed',
    prompt: secret,
  });
  diagnostic.record({
    type: 'review',
    reviewComplete: false,
    predicates,
    actorIssueCount: 0,
    countIssueCount: 0,
    requestAdequacyIssueCount: 1,
    claimCount: 1,
    reviewCheckCount: 1,
    decision: 'approve',
    review: { text: secret },
    feedback: secret,
  });
  diagnostic.record({ type: 'stage', stage: secret, elapsedMs: 1, outcome: 'completed' });
  const summary = diagnostic.failure(
    { code: 'question-withheld', message: secret, feedback: { review: secret }, stack: secret },
    502,
    140,
  );
  assert.equal(summary.requestId, id);
  assert.equal(summary.code, 'question-withheld');
  assert.equal(summary.modelCalls, 1);
  assert.equal(summary.stages[0].elapsedMs, 124);
  assert.equal(summary.reviews[0].predicates.coverage, false);
  assert.equal(summary.reviews[0].decision, 'approve');
  assert.deepEqual(Object.keys(summary.reviews[0].predicates), reviewPredicateNames);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(secret));
  assert.equal(diagnostic.failure({ code: secret }, 502, 1).code, 'other');
  assert.throws(() => createQuestionDiagnostics(secret));
  summary.reviews[0].predicates.coverage = true;
  assert.equal(
    diagnostic.failure(null, 500, 1).reviews[0].predicates.coverage,
    false,
    'Snapshots cannot mutate recorded predicates',
  );
  assert.doesNotThrow(() =>
    emitQuestionDiagnostic(
      () => {
        throw new Error(secret);
      },
      { type: 'review' },
    ),
  );
});

test('diagnostic body timing ends once and explicitly excludes platform/ESM bootstrap', () => {
  const response = {};
  beginQuestionTiming(response, 'wrapper');
  beginQuestionTiming(response, 'handler');
  beginQuestionTiming(response, 'requestBody');
  endQuestionTiming(response, 'requestBody');
  const first = questionTimingSegments(response);
  endQuestionTiming(response, 'requestBody');
  const second = questionTimingSegments(response);
  assert.equal(first.requestBodyMs, second.requestBodyMs);
  assert.ok(second.handlerMs >= second.requestBodyMs);
  assert.equal(second.runtimeInitMs, null);
  assert.match(second.scope, /platform-and-esm-bootstrap-excluded/);
});
