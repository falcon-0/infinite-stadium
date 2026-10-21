import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationCases, evaluationAdapters, runEvaluation } from './evaluation.js';
import { spawnSync } from 'node:child_process';

test('offline evaluation uses new seeds, checks abstention and never contacts a provider', async () => {
  const cases = evaluationCases();
  assert.ok(cases.every((c) => c.input.seed !== 17));
  const report = await runEvaluation({
    cases,
    adapters: evaluationAdapters({
      fetcher: () => {
        throw new Error('No network allowed.');
      },
    }),
  });
  const template = report.summaries[0];
  assert.equal(template.drafts, 13);
  assert.equal(template.correctAbstentions, 5);
  assert.equal(template.failed, 0);
  assert.equal(report.summaries[1].skipped, 18);
  assert.equal(report.summaries[1].latency.p95Ms, null);
  assert.equal(report.summaries.find((s) => s.adapter === 'fact-selection').skipped, 18);
  assert.ok(
    report.results
      .filter((r) => r.fixtureChecks)
      .every((r) => Object.values(r.fixtureChecks).every(Boolean)),
  );
  assert.ok(report.results.every((r) => r.semanticReview.label === null));
});

test('isolated adapter selection keeps offline canonical selection disabled without provider or runner calls', async () => {
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw new Error('No provider or local runtime allowed.');
  };
  {
    const adapters = evaluationAdapters({
      adapter: 'fact-selection',
      fetcher: forbidden,
      localRunner: forbidden,
    });
    assert.deepEqual(
      adapters.map((a) => a.id),
      ['fact-selection'],
    );
    const report = await runEvaluation({ cases: evaluationCases(), adapters });
    assert.equal(report.summaries.length, 1);
    assert.equal(report.summaries[0].skipped, 18);
  }
  const template = evaluationAdapters({
    live: true,
    adapter: 'template',
    config: null,
    fetcher: forbidden,
  });
  assert.deepEqual(
    template.map((a) => a.id),
    ['template'],
  );
  assert.equal(
    (await runEvaluation({ cases: evaluationCases(), adapters: template })).summaries[0].failed,
    0,
  );
  assert.equal(calls, 0);
  assert.throws(() => evaluationAdapters({ adapter: 'unknown' }), /supported evaluation adapter/);
});

test('isolated local canonical selection uses its bounded worker and no cloud adapter', async () => {
  const cases = [
    evaluationCases().find((c) => c.label === 'segment-end'),
    evaluationCases().find((c) => c.id === 'central-101-future-goal'),
  ];
  let calls = 0;
  const localRunner = async (packet) => {
    calls++;
    let raw,
      tools = [];
    if (packet.mode === 'fact-tool-selector') {
      assert.equal(calls, 1);
      assert.ok(packet.outputs.get_event_sequence);
      assert.ok(packet.outputs.get_match_patterns);
      tools = ['get_event_sequence', 'get_match_patterns'];
      raw = { tools };
    } else if (packet.mode === 'fact-selection') {
      assert.equal(calls, 2);
      const moment = packet.catalog.facts.find((f) => f.kind === 'moment'),
        count = packet.catalog.facts.find(
          (f) =>
            f.kind === 'window-event-count' &&
            f.values.team === 'away' &&
            f.values.category === 'shots',
        );
      assert.equal(count.values.count, 2);
      raw = { slots: [moment.slot, count.slot] };
    } else {
      assert.equal(packet.mode, 'fact-editorial-review');
      assert.equal(calls, 3);
      assert.deepEqual(
        new Set(packet.renderedClaims[1].evidence.map((r) => `${r.id}@${r.revision}`)),
        new Set(['extended-2039-7-shot@2', 'extended-2039-11-shot@2']),
      );
      raw = { decision: 'approve', issues: [] };
    }
    return {
      raw,
      tools,
      modelCalls: 1,
      elapsedMs: 1,
      usageReportedCalls: 1,
      usage: { promptTokens: 10, completionTokens: 5 },
    };
  };
  const adapters = evaluationAdapters({
    local: true,
    adapter: 'fact-selection',
    localRunner,
    fetcher: () => {
      throw new Error('Cloud calls forbidden.');
    },
  });
  const report = await runEvaluation({ cases, adapters });
  assert.equal(calls, 3);
  assert.equal(report.summaries.length, 1);
  assert.equal(report.summaries[0].drafts, 1);
  assert.equal(report.summaries[0].correctAbstentions, 1);
  assert.equal(report.summaries[0].failed, 0);
  assert.equal(report.results[0].provider, 'local');
  assert.equal(report.results[0].model, 'qwen3:4b');
  assert.deepEqual(report.results[0].authorship, {
    selection: 'local-model',
    mandatoryFacts: 'application-domain-rules',
    additionalContext: 'local-model',
    wording: 'application-fact-templates',
  });
  assert.equal(report.results[0].selectedFactIds.length, 2);
  assert.equal(report.results[0].execution.workerCalls, 3);
  assert.equal(report.summaries[0].semanticQuality, null);
});

test('isolated Azure canonical adapter validates full window citations and records template authorship', async () => {
  const cases = [evaluationCases().find((c) => c.label === 'segment-end')];
  let calls = 0;
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    calls++;
    let response;
    if (calls === 1)
      response = {
        finish_reason: 'tool_calls',
        message: {
          tool_calls: ['get_event_sequence', 'get_match_patterns'].map((name, i) => ({
            id: `call-${i}`,
            type: 'function',
            function: { name, arguments: '{}' },
          })),
        },
      };
    else if (calls === 2) {
      const catalog = JSON.parse(body.messages.at(-1).content).catalog;
      const moment = catalog.facts.find((f) => f.kind === 'moment'),
        count = catalog.facts.find(
          (f) =>
            f.kind === 'window-event-count' &&
            f.values.team === 'away' &&
            f.values.category === 'shots',
        );
      assert.ok(
        count.evidence.some((r) => !r.id.includes('-11-')),
        'Window fact must use older events outside the selected phase.',
      );
      response = {
        finish_reason: 'stop',
        message: { content: JSON.stringify({ factIds: [moment.id, count.id] }) },
      };
    } else {
      assert.equal(calls, 3, 'Only the selected adapter may run');
      response = {
        finish_reason: 'stop',
        message: { content: JSON.stringify({ decision: 'approve', issues: [] }) },
      };
    }
    return new Response(
      JSON.stringify({ choices: [response], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    );
  };
  const adapters = evaluationAdapters({
    live: true,
    adapter: 'fact-selection',
    config: { url: 'https://test.openai.azure.com', deployment: 'test', key: 'test' },
    fetcher,
  });
  const report = await runEvaluation({ cases, adapters });
  assert.equal(calls, 3);
  assert.equal(report.results.length, 1);
  assert.equal(report.summaries[0].drafts, 1);
  assert.equal(report.summaries[0].failed, 0);
  assert.deepEqual(report.results[0].authorship, {
    selection: 'azure-model',
    mandatoryFacts: 'application-domain-rules',
    additionalContext: 'azure-model',
    wording: 'application-fact-templates',
  });
  assert.equal(report.results[0].selectedFactIds.length, 2);
  assert.equal(report.results[0].citationCheck, 'passed');
  assert.equal(report.summaries[0].semanticQuality, null);
  assert.match(report.summaries[0].semanticQualityLimitation, /do not measure semantic truth/);
});

test('CLI rejects unknown or multiple adapter choices before any live execution', () => {
  for (const args of [
    ['--live', '--adapter=unknown'],
    ['--live', '--adapter=template', '--adapter=fact-selection'],
  ]) {
    const result = spawnSync(process.execPath, ['evaluation-cli.js', ...args], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:|only one evaluation adapter/);
  }
});
test('the comparison catches current-key mismatches, future citations and false abstention', async () => {
  const cases = evaluationCases().slice(0, 1);
  for (const adapter of [
    { id: 'bad', run: async () => ({ key: 'wrong', claims: [] }) },
    {
      id: 'bad',
      run: async (input) => {
        const real = await evaluationAdapters()[0].run(input);
        return {
          ...real,
          claims: [{ text: 'Future', evidence: [{ id: 'central-101-shot', revision: 1 }] }],
        };
      },
    },
  ])
    assert.equal((await runEvaluation({ cases, adapters: [adapter] })).summaries[0].failed, 1);
  const unavailable = evaluationCases()
    .filter((c) => c.expectedInvalid)
    .slice(0, 1);
  const outage = {
    id: 'outage',
    run: async () => {
      const error = new Error('Provider outage');
      error.status = 502;
      throw error;
    },
  };
  assert.equal(
    (await runEvaluation({ cases: unavailable, adapters: [outage] })).summaries[0]
      .correctAbstentions,
    0,
  );
});
test('withheld outputs cannot contain claims, repeated runs retain denominators', async () => {
  const cases = evaluationCases().slice(0, 1),
    adapter = {
      id: 'withheld',
      run: async () => ({ status: 'withheld', claims: [], review: 'Review rejected.' }),
    };
  const report = await runEvaluation({ cases, adapters: [adapter], repeat: 3 });
  assert.equal(report.summaries[0].withheld, 3);
  assert.equal(report.results.length, 3);
  assert.equal(report.summaries[0].semanticQuality, null);
  adapter.run = async () => ({ status: 'withheld', claims: [{ text: 'Hidden draft' }] });
  assert.equal((await runEvaluation({ cases, adapters: [adapter] })).summaries[0].failed, 1);
  await assert.rejects(runEvaluation({ repeat: 11 }), /repeat/);
});

test('variant fixture evaluation checks independently specified final action and pass totals', async () => {
  const segment = evaluationCases().find((c) => c.label === 'segment-end');
  assert.deepEqual(segment.expected, {
    scoreHome: 2,
    scoreAway: 1,
    passAccuracy: 75,
    anchorRevision: 2,
    homeShots: 2,
    awayShots: 5,
    passAttempts: 12,
    completedPasses: 9,
    homeRecoveries: 7,
    awayRecoveries: 8,
    eventCount: 50,
  });
  const adapters = evaluationAdapters().slice(0, 1);
  const valid = await runEvaluation({ cases: [segment], adapters });
  assert.equal(Object.keys(valid.results[0].fixtureChecks).length, 11);
  assert.ok(Object.values(valid.results[0].fixtureChecks).every(Boolean));
  const wrong = {
    ...segment,
    expected: { ...segment.expected, completedPasses: 12, eventCount: 60 },
  };
  const invalid = await runEvaluation({ cases: [wrong], adapters });
  assert.equal(invalid.results[0].fixtureChecks.completedPasses, false);
  assert.equal(invalid.results[0].fixtureChecks.eventCount, false);
  assert.equal(invalid.results[0].fixtureChecks.score, true);
});
