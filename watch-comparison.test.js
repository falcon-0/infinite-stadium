import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compareWatchWorkflow, summarizeWatchComparison } from './watch-comparison.js';

const input = { kind: 'sustained', seed: 17, time: 118, language: 'en', question: 'Who scored?' };
const config = {
  url: 'https://not-called.invalid',
  key: 'never-persist-this-secret',
  deployment: 'mock',
};
const ref = { type: 'event', id: 'comparison-sustained-17-shot-116', revision: 2 };
const draft = (text) => ({
  premiseCheck: {
    questionAssumption: 'A goal occurred',
    recordedAction: 'Reed scored',
    conclusion: 'supported',
  },
  scope: 'match',
  claims: [{ text, kind: 'observation', evidence: [ref] }],
  followUp: '',
});
const review = (decision = 'approve') => ({
  requestCheck: {
    requestedInformation: 'scorer',
    status: decision === 'approve' ? 'answered' : 'not-answered',
    reason: 'Mock request relevance',
  },
  checks: [
    {
      claimIndex: 0,
      actors: [{ name: 'A. Reed', action: 'goal', individualAction: true }],
      inventedFacts: [],
      counts: [],
      shotOutcomeAssertions: ['bucket-count'],
      reason: 'Mock scenario evidence',
      supported: decision === 'approve',
    },
  ],
  reason: 'Mock verdict',
  decision,
});
function provider(values, { usage = true } = {}) {
  let count = 0;
  return {
    count: () => count,
    fetcher: async (_url, options) => {
      const value = values[count++];
      if (value?.requestCheck) {
        const source = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
        value.requestCheck = {
          coverage: [
            { requestSpan: source.evidence.question, answerSpan: source.answer.claims[0].text },
          ],
          ...value.requestCheck,
        };
      }
      if (value === 429)
        return new Response(JSON.stringify({ error: { code: 'rate_limit' } }), { status: 429 });
      if (value === undefined) throw new Error('Unexpected provider call');
      return new Response(
        JSON.stringify({
          model: 'mock',
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
          ...(usage ? { usage: { prompt_tokens: 100, completion_tokens: 20 } } : {}),
        }),
      );
    },
  };
}

test('paired boundary uses the actual checked draft and counts shared prefix once', async () => {
  const mock = provider([{ draft: draft('A. Reed scored.'), queries: [] }, review()]);
  const result = await compareWatchWorkflow(input, { config, fetcher: mock.fetcher });
  assert.equal(mock.count(), 2);
  assert.equal(result.paired, true);
  assert.equal(result.baseline.answer, 'A. Reed scored.');
  assert.equal(result.baseline.measurements.modelCalls, 1);
  assert.equal(result.full.measurements.modelCalls, 2);
  assert.equal(result.delta.modelCalls, 1);
  assert.equal(result.sameEvidenceAtEveryReview, true);
  assert.equal(result.full.status, 'generated');
  assert.equal(result.baseline.quality.verdict, 'unreviewed');
  assert.equal(result.full.measurements.estimatedUsd, null);
  assert.ok(!JSON.stringify(result).includes(config.key));
  assert.ok(!JSON.stringify(result).includes(config.url));
  assert.equal(summarizeWatchComparison([result]).executedModelCalls, 2);
  assert.equal(summarizeWatchComparison([result]).qualityAdvantage, null);
});
test('model withholding can fail full arm while baseline remains visible, without synthetic approval', async () => {
  const mock = provider([{ draft: draft('A. Reed scored.'), queries: [] }, review('withhold')]);
  const result = await compareWatchWorkflow(input, { config, fetcher: mock.fetcher });
  assert.equal(result.baseline.status, 'checked-candidate');
  assert.equal(result.full.status, 'failed');
  assert.equal(result.full.error.code, 'question-withheld');
  assert.equal(mock.count(), 2);
});
test('deterministic rejection before review shares its repair with both arms', async () => {
  const mock = provider([
    { draft: draft('A. Reed had a low chance of scoring.'), queries: [] },
    draft('A. Reed scored.'),
    review(),
  ]);
  const result = await compareWatchWorkflow(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.baseline.boundaryCallIndex, 2);
  assert.equal(result.baseline.measurements.modelCalls, 2);
  assert.equal(result.full.measurements.modelCalls, 3);
  assert.equal(result.baseline.answer, 'A. Reed scored.');
  assert.equal(result.full.result.execution.repairs, 1);
});
test('review-triggered rewrite belongs only to full arm with the same evidence', async () => {
  const mock = provider([
    { draft: draft('A. Reed scored for Northbridge.'), queries: [] },
    review('withhold'),
    draft('A. Reed scored.'),
    review(),
  ]);
  const result = await compareWatchWorkflow(input, {
    config,
    fetcher: mock.fetcher,
    canRepair: () => true,
  });
  assert.equal(result.baseline.answer, 'A. Reed scored for Northbridge.');
  assert.equal(result.full.result.answer, 'A. Reed scored.');
  assert.equal(result.delta.modelCalls, 3);
  assert.equal(result.reviewBoundaries.length, 2);
  assert.equal(result.sameEvidenceAtEveryReview, true);
  assert.equal(result.delta.answerChanged, true);
});
test('review transport failure preserves a baseline but is never called a factual failure', async () => {
  const mock = provider([{ draft: draft('A. Reed scored.'), queries: [] }, 429]);
  const result = await compareWatchWorkflow(input, { config, fetcher: mock.fetcher });
  assert.equal(result.baseline.status, 'checked-candidate');
  assert.equal(result.full.error.code, 'azure-rate-limit');
  assert.equal(result.full.quality.verdict, 'unreviewed');
  assert.equal(result.calls[1].status, 429);
});
test('local clarification has no comparison intervention and consumes no model calls', async () => {
  const result = await compareWatchWorkflow(
    { ...input, question: 'j' },
    {
      config,
      fetcher: () => {
        throw new Error('No network');
      },
    },
  );
  assert.equal(result.baseline.status, 'local-result');
  assert.equal(result.paired, false);
  assert.equal(result.full.measurements.modelCalls, 0);
  assert.equal(result.delta.modelCalls, 0);
});
test('missing token usage never becomes a complete zero-dollar estimate', async () => {
  const mock = provider([{ draft: draft('A. Reed scored.'), queries: [] }, review()], {
    usage: false,
  });
  const result = await compareWatchWorkflow(input, {
    config,
    fetcher: mock.fetcher,
    pricing: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      source: 'test fixture',
      asOf: '2026-10-14',
    },
  });
  assert.equal(result.full.measurements.usageComplete, false);
  assert.equal(result.full.measurements.estimatedUsd, null);
  assert.equal(result.delta.promptTokens, null);
});
test('explicit supplied pricing is calculated without implying billed cost', async () => {
  const mock = provider([{ draft: draft('A. Reed scored.'), queries: [] }, review()]);
  const result = await compareWatchWorkflow(input, {
    config,
    fetcher: mock.fetcher,
    pricing: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      source: 'test fixture',
      asOf: '2026-10-14',
    },
  });
  assert.equal(result.full.measurements.estimatedUsd, 0.00028);
  assert.equal(result.baseline.measurements.estimatedUsd, 0.00014);
});
test('no implicit transport and no CLI live opt-in can invoke network', async () => {
  await assert.rejects(compareWatchWorkflow(input, { config }), /explicit transport/);
  const result = spawnSync(process.execPath, ['watch-comparison-cli.js'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No model calls made/);
});
