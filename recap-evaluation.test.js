import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  recapEvaluationCases,
  recapEvaluationAdapters,
  runRecapEvaluation,
} from './recap-evaluation.js';
import { GenerationError } from './ai.js';
import { createRecapFacts } from './recap-facts.js';
import { renderRecapFacts } from './recap-renderer.js';
test('default recap evaluation is offline, with independent counts and complete 50-event overview', async () => {
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw new Error('Model execution forbidden.');
  };
  const report = await runRecapEvaluation({
    adapters: recapEvaluationAdapters({
      fetcher: forbidden,
      runner: forbidden,
    }),
  });
  assert.equal(calls, 0);
  assert.equal(report.results.length, 6);
  assert.equal(report.summaries[0].drafts, 5);
  assert.equal(report.summaries[0].correctAbstentions, 1);
  assert.equal(report.summaries[0].failed, 0);
  const end = report.results.find((r) => r.caseId === 'received-segment-end');
  assert.equal(end.overviewReferenceCount, 50);
  assert.equal(end.fixtureChecks['away.shots'], true);
  assert.equal(end.fixtureChecks['home.failed'], true);
  assert.equal(end.fixtureChecks['away.completed'], true);
  assert.ok(
    report.results
      .filter((r) => r.status === 'draft')
      .every((r) => Object.values(r.fixtureChecks).every(Boolean)),
  );
  assert.equal(report.results.find((r) => r.caseId === 'empty-inventory').modelCallsBeforeError, 0);
  assert.equal(report.summaries[0].semanticQuality, null);
  assert.equal(report.summaries[0].tokens.prompt, 0);
  const disabled = await runRecapEvaluation({
    adapters: recapEvaluationAdapters({
      adapter: 'fact-selection',
      fetcher: forbidden,
      runner: forbidden,
    }),
  });
  assert.equal(disabled.summaries[0].skipped, 6);
  assert.equal(calls, 0);
});
test('favorite-player evaluation independently requires ten D. Silva actor records plus the latest recorded lead', async () => {
  const testCase = recapEvaluationCases().find((c) => c.id === 'favorite-player-segment-end'),
    template = recapEvaluationAdapters()[0];
  const output = await template.run(testCase.input),
    profile = output.selectedFacts.find((f) => f.kind === 'recap-player-actions');
  assert.deepEqual(profile.values, {
    player: 'D. Silva',
    playerId: 'away-10',
    team: 'away',
    total: 10,
    shots: 5,
    goals: 1,
    passes: 0,
    completedPasses: 0,
    pendingPasses: 0,
    recoveries: 0,
    ballWins: 0,
    initialControls: 0,
    unknownRecoveries: 0,
    recoveryClassificationVersion: 'recovery-classification-v1',
    involvement: 'recorded',
    start: 0,
    end: 362,
  });
  assert.equal(profile.evidence.length, 10);
  assert.equal(
    profile.evidence.filter((r) => r.id.endsWith('-receive') && r.revision === 1).length,
    5,
  );
  assert.equal(
    profile.evidence.filter((r) => r.id.endsWith('-shot') && r.revision === 2).length,
    5,
  );
  assert.ok(profile.evidence.every((r) => !r.id.endsWith('-flight')));
  const lead = output.selectedFacts.find((f) => f.kind === 'recap-goal-score-change');
  assert.equal(lead.values.anchorId, 'extended-17-10-shot');
  assert.equal(lead.values.time, 328);
  assert.equal(lead.values.effect, 'took-lead');
  assert.deepEqual(
    [lead.values.beforeHome, lead.values.beforeAway, lead.values.afterHome, lead.values.afterAway],
    [1, 1, 2, 1],
  );
  const report = await runRecapEvaluation({
    cases: [testCase],
    adapters: [template],
  });
  assert.equal(report.results[0].status, 'draft');
  assert.ok(Object.values(report.results[0].selectionChecks).every(Boolean));
  assert.equal(report.results[0].fixtureChecks['player.complete-support'], true);
  assert.equal(report.results[0].fixtureChecks['player.total'], true);
  assert.equal(report.results[0].claims.find((c) => c.factId === profile.id).evidence.length, 10);
  const wrong = {
    ...testCase,
    expected: {
      ...testCase.expected,
      player: {
        ...testCase.expected.player,
        total: 11,
      },
    },
  };
  const failed = await runRecapEvaluation({
    cases: [wrong],
    adapters: [template],
  });
  assert.equal(failed.results[0].status, 'failed');
  assert.equal(failed.results[0].fixtureChecks['player.total'], false);
});
test('canonical generic team counts and earlier goal facts cannot substitute for required player or latest-score context', async () => {
  const player = recapEvaluationCases().find((c) => c.id === 'favorite-player-segment-end'),
    end = recapEvaluationCases().find((c) => c.id === 'received-segment-end');
  const adapter = (choose) => ({
    id: 'adversarial-canonical',
    run: async (input) => {
      const prepared = createRecapFacts(input),
        selectedFacts = choose(prepared.catalog.facts),
        selectedFactIds = selectedFacts.map((f) => f.id);
      const rendered = renderRecapFacts(prepared.catalog, selectedFactIds, {
        audience: prepared.audience,
        language: prepared.language.code,
      });
      return {
        ...prepared,
        language: prepared.language.code,
        status: 'draft',
        selectedFacts,
        selectedFactIds,
        claims: rendered.claims,
        execution: {
          modelCalls: 0,
          usageReportedCalls: 0,
        },
      };
    },
  });
  const generic = await runRecapEvaluation({
    cases: [player],
    adapters: [
      adapter((facts) => [
        facts[0],
        facts.find((f) => f.kind === 'recap-team-shots' && f.values.team === 'away'),
        facts.filter((f) => f.kind === 'recap-goal-score-change').at(-1),
      ]),
    ],
  });
  assert.equal(generic.results[0].status, 'failed');
  assert.equal(generic.results[0].selectionChecks.favoritePlayerIncluded, false);
  assert.equal(generic.results[0].selectionChecks.latestRecordedGoalIncluded, true);
  const stale = await runRecapEvaluation({
    cases: [end],
    adapters: [
      adapter((facts) => [facts[0], facts.find((f) => f.kind === 'recap-goal-score-change')]),
    ],
  });
  assert.equal(stale.results[0].status, 'failed');
  assert.equal(stale.results[0].selectionChecks.latestRecordedGoalIncluded, false);
});
test('provider failures and calls before an empty-inventory rejection do not masquerade as abstention', async () => {
  const cases = recapEvaluationCases().filter((c) => c.expectedInvalid);
  for (const status of [503, 429]) {
    const report = await runRecapEvaluation({
      cases,
      adapters: [
        {
          id: 'failure',
          run: async () => {
            throw new GenerationError('Provider failed.', status);
          },
        },
      ],
    });
    assert.equal(report.summaries[0].correctAbstentions, 0);
    assert.equal(report.summaries[0].failed, 1);
  }
  const report = await runRecapEvaluation({
    cases,
    adapters: [
      {
        id: 'bad',
        run: async () => {
          const error = new GenerationError('Bad late rejection.', 400);
          error.evaluationModelCalls = 1;
          throw error;
        },
      },
    ],
  });
  assert.equal(report.summaries[0].correctAbstentions, 0);
  assert.equal(report.results[0].modelCallsBeforeError, 1);
});
test('explicit Azure adapter accepts the current mandatory overview and nullable context wire contract', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body),
      packet = JSON.parse(body.messages.at(-1).content);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    let raw;
    if (calls === 1) {
      const schema = body.response_format.json_schema.schema;
      assert.deepEqual(schema.required, [
        'overviewFactId',
        'context1',
        'context2',
        'context3',
        'context4',
      ]);
      assert.equal(schema.additionalProperties, false);
      assert.equal(packet.requiredFactIds.length, 1);
      assert.deepEqual(schema.properties.context4, {
        type: 'string',
        enum: [packet.requiredFactIds[0]],
      });
      for (const field of ['context1', 'context2', 'context3']) {
        assert.ok(schema.properties[field].enum.includes(null));
        assert.ok(!schema.properties[field].enum.includes(packet.requiredFactIds[0]));
      }
      raw = {
        overviewFactId: packet.catalog.facts[0].id,
        context1: null,
        context2: null,
        context3: null,
        context4: packet.requiredFactIds[0],
      };
    } else {
      assert.equal(calls, 2, 'The isolated adapter must not execute another workflow.');
      raw = {
        decision: 'approve',
        issues: [],
        suggestions: [],
      };
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify(raw),
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
        },
      }),
    );
  };
  const cases = recapEvaluationCases().filter((c) => c.id === 'received-segment-end');
  const report = await runRecapEvaluation({
    cases,
    adapters: recapEvaluationAdapters({
      adapter: 'fact-selection',
      live: true,
      config: {
        url: 'https://test.openai.azure.com/openai/v1/chat/completions',
        deployment: 'test',
        key: 'test',
      },
      fetcher,
      runner: () => {
        throw new Error('Local worker forbidden.');
      },
    }),
  });
  assert.equal(calls, 2);
  assert.equal(report.summaries[0].drafts, 1);
  assert.equal(report.summaries[0].failed, 0);
  assert.equal(report.results[0].overviewReferenceCount, 50);
  assert.equal(report.results[0].execution.modelCalls, 2);
  assert.deepEqual(report.results[0].selectedKinds, ['recap-overview', 'recap-goal-score-change']);
  assert.deepEqual(report.results[0].authorship, {
    selection: 'azure-model',
    mandatoryFacts: 'application-domain-rules',
    additionalContext: 'azure-model',
    wording: 'application-fact-templates',
  });
});
test('evaluation catches wrong received scope, altered selected count and independent fixture mismatch', async () => {
  const end = recapEvaluationCases().find((c) => c.id === 'received-segment-end'),
    template = recapEvaluationAdapters()[0];
  for (const change of [
    (output) => {
      output.scope.observedAt = 360;
    },
    (output) => {
      output.selectedFacts[0].values.home = 9;
    },
    (output) => {
      output.claims[0].evidence.pop();
    },
  ]) {
    const adapter = {
      id: 'bad',
      run: async (input) => {
        const output = structuredClone(await template.run(input));
        change(output);
        return output;
      },
    };
    const report = await runRecapEvaluation({
      cases: [end],
      adapters: [adapter],
    });
    assert.equal(report.summaries[0].failed, 1);
  }
  const wrong = {
    ...end,
    expected: {
      ...end.expected,
      eventCount: 49,
    },
  };
  const report = await runRecapEvaluation({
    cases: [wrong],
    adapters: [template],
  });
  assert.equal(report.results[0].fixtureChecks.eventCount, false);
  assert.equal(report.summaries[0].failed, 1);
});
test('CLI requires explicit isolated model adapter and rejects invalid flags before execution', () => {
  const directory = new URL('./artifacts/evaluations/', import.meta.url);
  const artifacts = () =>
    existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => name.startsWith('recap-evaluation-'))
          .sort()
      : [];
  const before = artifacts();
  for (const args of [
    ['--local'],
    ['--live'],
    ['--live', '--adapter=template'],
    ['--local', '--live', '--adapter=fact-selection'],
    ['--adapter=unknown'],
    ['--adapter=template', '--adapter=fact-selection'],
    ['--unexpected'],
  ]) {
    const result = spawnSync(process.execPath, ['recap-evaluation-cli.js', ...args], {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.length);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(artifacts(), before, 'Invalid options must not write a recap report.');
  assert.throws(
    () =>
      recapEvaluationAdapters({
        local: true,
      }),
    /explicitly/,
  );
  const offline = spawnSync(
    process.execPath,
    ['recap-evaluation-cli.js', '--adapter=fact-selection'],
    {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
    },
  );
  assert.equal(offline.status, 0);
  assert.match(offline.stdout, /0 drafts.*6 skipped/);
  assert.match(offline.stdout, /pending human review/);
  assert.ok(offline.stdout.split('\n').length <= 5);
  const destination = offline.stdout.match(/^Report: (.+)$/m)?.[1];
  assert.ok(destination);
  const saved = JSON.parse(readFileSync(destination, 'utf8'));
  assert.equal(saved.summaries[0].skipped, 6);
  assert.equal(saved.results.length, 6);
  assert.equal(saved.provider, 'offline');
});
