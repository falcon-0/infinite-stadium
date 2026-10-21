import { performance } from 'node:perf_hooks';
import { configuration } from './ai.js';
import { createRecapFacts } from './recap-facts.js';
import { renderRecapFacts } from './recap-renderer.js';
import { generateRecapStory } from './recap-workflow.js';

const zero = { shots: 0, total: 0, known: 0, completed: 0, failed: 0, pending: 0 };
const end = {
  home: 2,
  away: 1,
  eventCount: 50,
  teams: {
    home: { shots: 2, total: 6, known: 6, completed: 4, failed: 2, pending: 0 },
    away: { shots: 5, total: 6, known: 6, completed: 5, failed: 1, pending: 0 },
  },
};
// Independently fixed fixture expectations, not copied from the fact catalog.
export function recapEvaluationCases() {
  const input = {
    source: 'integrated-match',
    kind: 'extended',
    seed: 2039,
    audience: 'analyst',
    language: 'en',
  };
  return [
    {
      id: 'pending-pass',
      input: { ...input, time: 22 },
      expected: {
        home: 0,
        away: 0,
        eventCount: 2,
        status: 'in-progress',
        teams: {
          home: { shots: 0, total: 1, known: 0, completed: 0, failed: 0, pending: 1 },
          away: { ...zero },
        },
      },
    },
    {
      id: 'before-completion',
      input: { ...input, time: 359 },
      expected: { ...end, status: 'in-progress' },
    },
    {
      id: 'received-segment-end',
      input: { ...input, time: 362 },
      expected: { ...end, status: 'demo-segment-complete' },
    },
    {
      id: 'confirmed-short-pass',
      input: {
        ...input,
        kind: 'central',
        seed: 701,
        time: 4,
        audience: 'newcomer',
        language: 'fr',
      },
      expected: {
        home: 0,
        away: 0,
        eventCount: 2,
        status: 'in-progress',
        teams: {
          home: { shots: 0, total: 1, known: 1, completed: 1, failed: 0, pending: 0 },
          away: { ...zero },
        },
      },
    },
    {
      id: 'favorite-player-segment-end',
      input: { ...input, seed: 17, time: 362, audience: 'player', favoritePlayer: 'D. Silva' },
      expected: {
        ...end,
        status: 'demo-segment-complete',
        player: {
          player: 'D. Silva',
          team: 'away',
          total: 10,
          shots: 5,
          goals: 1,
          passes: 0,
          completedPasses: 0,
          pendingPasses: 0,
          recoveries: 0,
          involvement: 'recorded',
          start: 0,
          end: 362,
          evidence: [1, 3, 5, 7, 11].flatMap((phase) => [
            { type: 'event', id: `extended-17-${phase}-receive`, revision: 1 },
            { type: 'event', id: `extended-17-${phase}-shot`, revision: 2 },
          ]),
        },
        selectedGoal: {
          anchorId: 'extended-17-10-shot',
          time: 328,
          team: 'home',
          beforeHome: 1,
          beforeAway: 1,
          afterHome: 2,
          afterAway: 1,
          effect: 'took-lead',
        },
      },
    },
    { id: 'empty-inventory', input: { ...input, time: 0 }, expectedInvalid: true },
  ];
}

export function recapEvaluationAdapters({
  adapter = 'template',
  live = false,
  local = false,
  config,
  fetcher = fetch,
  runner,
} = {}) {
  if (!['template', 'fact-selection'].includes(adapter))
    throw new RangeError('Choose template or fact-selection recap evaluation.');
  if ((live && local) || ((live || local) && adapter !== 'fact-selection'))
    throw new RangeError('Choose only one live provider and explicitly select fact-selection.');
  if (adapter === 'template')
    return [
      {
        id: adapter,
        run: async (input) => {
          const prepared = createRecapFacts(input),
            maximum = ['newcomer', 'player'].includes(prepared.audience) ? 3 : 5;
          const overview = prepared.catalog.facts[0],
            goals = prepared.catalog.facts.filter((f) => f.kind === 'recap-goal-score-change');
          const latest = goals.at(-1),
            requiredGoal =
              latest &&
              latest.values.afterHome === overview.values.home &&
              latest.values.afterAway === overview.values.away
                ? latest
                : null;
          const player =
            prepared.audience === 'player'
              ? prepared.catalog.facts.find(
                  (f) =>
                    f.kind === 'recap-player-actions' &&
                    f.values.player === prepared.preferences.favoritePlayer,
                )
              : null;
          const required = [overview, ...(requiredGoal ? [requiredGoal] : [])],
            optional = [
              ...(player ? [player] : []),
              ...goals.filter((f) => f !== requiredGoal).reverse(),
              ...prepared.catalog.facts.filter((f) => f.kind === 'recap-team-shots'),
            ].slice(0, maximum - required.length);
          const context = [...optional, ...(requiredGoal ? [requiredGoal] : [])];
          const chosen = [
            overview,
            ...context.filter((f) => f.kind !== 'recap-goal-score-change'),
            ...context
              .filter((f) => f.kind === 'recap-goal-score-change')
              .sort((a, b) => a.values.time - b.values.time),
          ];
          const rendered = renderRecapFacts(
            prepared.catalog,
            chosen.map((f) => f.id),
            { audience: prepared.audience, language: prepared.language.code },
          );
          return {
            ...prepared,
            status: 'draft',
            provider: 'template',
            language: prepared.language.code,
            claims: rendered.claims,
            selectedFacts: chosen,
            selectedFactIds: chosen.map((f) => f.id),
            authorship: { selection: 'application-policy', wording: 'application-fact-templates' },
            execution: {
              modelCalls: 0,
              toolCalls: 0,
              repairCount: 0,
              elapsedMs: 0,
              usage: null,
              usageReportedCalls: 0,
            },
          };
        },
      },
    ];
  if (!live && !local)
    return [
      {
        id: adapter,
        skip: 'Model calls disabled; explicitly choose --local or --live with --adapter=fact-selection.',
      },
    ];
  const azureConfig = local ? null : config === undefined ? configuration() : config;
  if (!local && !azureConfig) return [{ id: adapter, skip: 'Azure is not configured.' }];
  return [
    {
      id: adapter,
      run: async (input) => {
        let calls = 0;
        const countedFetch = async (...args) => {
          calls++;
          return fetcher(...args);
        };
        const countedRunner = runner
          ? async (...args) => {
              calls++;
              return runner(...args);
            }
          : undefined;
        // The default runner is imported lazily only for explicit local evaluation.
        let actualRunner = countedRunner;
        if (local && !actualRunner) {
          const { runLocalPacket } = await import('./local-ai.js');
          actualRunner = async (...args) => {
            calls++;
            return runLocalPacket(...args);
          };
        }
        try {
          return await generateRecapStory(input, {
            provider: local ? 'local' : 'azure',
            config: azureConfig,
            fetcher: countedFetch,
            runner: actualRunner,
          });
        } catch (error) {
          error.evaluationModelCalls = calls;
          throw error;
        }
      },
    },
  ];
}

const refKey = (r) => `${r.type}:${r.id}@${r.revision}`;
const sameRefs = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  JSON.stringify(a.map(refKey).sort()) === JSON.stringify(b.map(refKey).sort());
function fixtureChecks(prepared, expected) {
  const facts = prepared.catalog.facts,
    overview = facts[0].values;
  const checks = Object.fromEntries(
    ['home', 'away', 'eventCount', 'status'].map((field) => [
      field,
      overview[field] === expected[field],
    ]),
  );
  for (const team of ['home', 'away']) {
    const shots =
      facts.find((f) => f.kind === 'recap-team-shots' && f.values.team === team)?.values.count ?? 0;
    const passes =
      facts.find((f) => f.kind === 'recap-team-passes' && f.values.team === team)?.values ?? zero;
    checks[`${team}.shots`] = shots === expected.teams[team].shots;
    for (const field of ['total', 'known', 'completed', 'failed', 'pending'])
      checks[`${team}.${field}`] = passes[field] === expected.teams[team][field];
  }
  if (expected.player) {
    const player = facts.find(
      (f) => f.kind === 'recap-player-actions' && f.values.player === expected.player.player,
    );
    for (const [field, value] of Object.entries(expected.player))
      if (field !== 'evidence') checks[`player.${field}`] = player?.values[field] === value;
    checks['player.complete-support'] = sameRefs(player?.evidence, expected.player.evidence);
  }
  if (expected.selectedGoal) {
    const goal = facts.find(
      (f) =>
        f.kind === 'recap-goal-score-change' &&
        f.values.anchorId === expected.selectedGoal.anchorId,
    );
    checks['required-goal.available'] =
      !!goal &&
      Object.entries(expected.selectedGoal).every(([field, value]) => goal.values[field] === value);
  }
  return checks;
}

export async function runRecapEvaluation({
  cases = recapEvaluationCases(),
  adapters = recapEvaluationAdapters(),
} = {}) {
  const results = [];
  for (const testCase of cases)
    for (const adapter of adapters) {
      const row = {
        caseId: testCase.id,
        adapter: adapter.id,
        input: testCase.input,
        expectedInvalid: !!testCase.expectedInvalid,
        semanticReview: { status: 'pending-human-review', label: null, notes: null },
      };
      if (adapter.skip) {
        results.push({ ...row, status: 'skipped', reason: adapter.skip });
        continue;
      }
      const started = performance.now();
      try {
        const output = await adapter.run(testCase.input);
        row.elapsedMs = performance.now() - started;
        if (testCase.expectedInvalid) throw new Error('Output returned for empty inventory.');
        const prepared = createRecapFacts(testCase.input);
        row.fixtureChecks = fixtureChecks(prepared, testCase.expected);
        if (!Object.values(row.fixtureChecks).every(Boolean))
          throw new Error('Independent fixture expectation failed.');
        if (
          output.key !== prepared.key ||
          JSON.stringify(output.scope) !== JSON.stringify(prepared.scope) ||
          !sameRefs(output.dependencies, prepared.dependencies) ||
          output.audience !== prepared.audience ||
          output.language !== prepared.language.code ||
          JSON.stringify(output.preferences) !== JSON.stringify(prepared.preferences)
        )
          throw new Error('Wrong received scope or dependencies.');
        row.provider = output.provider;
        row.authorship = output.authorship;
        row.execution = output.execution;
        const execution = output.execution;
        if (
          !execution ||
          !Number.isInteger(execution.modelCalls) ||
          execution.modelCalls < 0 ||
          execution.modelCalls > 4 ||
          !Number.isInteger(execution.usageReportedCalls) ||
          execution.usageReportedCalls < 0 ||
          execution.usageReportedCalls > execution.modelCalls
        )
          throw new Error('Invalid execution accounting.');
        if (
          (adapter.id === 'template' && execution.modelCalls !== 0) ||
          (adapter.id === 'fact-selection' && execution.modelCalls < 2)
        )
          throw new Error('Execution accounting disagrees with the selected adapter.');
        row.availableKinds = prepared.catalog.facts.map((f) => f.kind);
        if (output.status === 'withheld') {
          if (
            !Array.isArray(output.claims) ||
            output.claims.length ||
            !Array.isArray(output.selectedFactIds) ||
            output.selectedFactIds.length ||
            output.selectedFacts?.length
          )
            throw new Error('Withheld recap includes claims or selections.');
          results.push({
            ...row,
            status: 'withheld',
            selectedKinds: [],
            reason: 'Selection validation or editorial review withheld recap.',
          });
          continue;
        }
        if (
          output.status !== 'draft' ||
          !Array.isArray(output.selectedFacts) ||
          !Array.isArray(output.selectedFactIds)
        )
          throw new Error('Invalid recap output.');
        const actual = new Map(prepared.catalog.facts.map((f) => [f.id, f]));
        if (
          output.selectedFacts.length !== output.selectedFactIds.length ||
          output.selectedFacts.some(
            (f, i) =>
              f.id !== output.selectedFactIds[i] ||
              JSON.stringify(f) !== JSON.stringify(actual.get(f.id)),
          )
        )
          throw new Error('Selected facts disagree with current canonical evidence.');
        const overview = prepared.catalog.facts[0],
          latest = prepared.catalog.facts
            .filter((f) => f.kind === 'recap-goal-score-change')
            .at(-1);
        const requiredGoal =
          latest &&
          latest.values.afterHome === overview.values.home &&
          latest.values.afterAway === overview.values.away
            ? latest
            : null;
        const requiredPlayer =
          prepared.audience === 'player'
            ? prepared.catalog.facts.find(
                (f) =>
                  f.kind === 'recap-player-actions' &&
                  f.values.player === prepared.preferences.favoritePlayer,
              )
            : null;
        const selectedPlayer = output.selectedFacts.find((f) => f.id === requiredPlayer?.id);
        row.selectionChecks = {
          overviewIncluded: output.selectedFacts[0]?.id === overview.id,
          latestRecordedGoalIncluded:
            !requiredGoal || output.selectedFactIds.includes(requiredGoal.id),
          favoritePlayerIncluded: !requiredPlayer || !!selectedPlayer,
        };
        if (testCase.expected.player)
          row.selectionChecks.favoritePlayerSupportExact = sameRefs(
            selectedPlayer?.evidence,
            testCase.expected.player.evidence,
          );
        if (testCase.expected.selectedGoal)
          row.selectionChecks.expectedGoalScoreChangeIncluded = output.selectedFacts.some(
            (f) =>
              f.kind === 'recap-goal-score-change' &&
              Object.entries(testCase.expected.selectedGoal).every(
                ([field, value]) => f.values[field] === value,
              ),
          );
        if (!Object.values(row.selectionChecks).every(Boolean))
          throw new Error(
            'Required overview, latest-score or favorite-player selection coverage failed.',
          );
        const rendered = renderRecapFacts(prepared.catalog, output.selectedFactIds, {
          audience: prepared.audience,
          language: prepared.language.code,
        });
        if (
          !Array.isArray(output.claims) ||
          output.claims.length !== rendered.claims.length ||
          output.claims.some(
            (claim, i) =>
              claim.text !== rendered.claims[i].text ||
              !sameRefs(claim.evidence, rendered.claims[i].evidence),
          )
        )
          throw new Error('Canonical wording or complete citations disagree.');
        results.push({
          ...row,
          status: 'draft',
          citationCheck: 'complete-canonical-references',
          selectedKinds: output.selectedFacts.map((f) => f.kind),
          selectedFactIds: output.selectedFactIds,
          overviewReferenceCount: output.claims[0].evidence.length,
          claims: output.claims,
        });
      } catch (error) {
        const abstention =
          testCase.expectedInvalid &&
          error?.status === 400 &&
          (error.evaluationModelCalls ?? 0) === 0;
        results.push({
          ...row,
          elapsedMs: performance.now() - started,
          status: abstention ? 'correct-abstention' : 'failed',
          modelCallsBeforeError: abstention ? 0 : (error.evaluationModelCalls ?? null),
          reason: abstention
            ? 'Empty inventory rejected before any model call.'
            : error?.status
              ? `Generation failed (status ${error.status}).`
              : 'Fixture, scope, selection, citation or accounting validation failed.',
        });
      }
    }
  const summaries = adapters.map((adapter) => {
    const rows = results.filter((r) => r.adapter === adapter.id),
      drafts = rows.filter((r) => r.status === 'draft');
    const times = rows
      .map((r) => r.elapsedMs)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const completeUsage = rows.filter(
      (r) =>
        r.execution?.modelCalls > 0 &&
        r.execution.usageReportedCalls === r.execution.modelCalls &&
        Number.isSafeInteger(r.execution.usage?.promptTokens) &&
        r.execution.usage.promptTokens >= 0 &&
        Number.isSafeInteger(r.execution.usage?.completionTokens) &&
        r.execution.usage.completionTokens >= 0,
    );
    return {
      adapter: adapter.id,
      total: rows.length,
      skipped: rows.filter((r) => r.status === 'skipped').length,
      drafts: drafts.length,
      withheld: rows.filter((r) => r.status === 'withheld').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      correctAbstentions: rows.filter((r) => r.status === 'correct-abstention').length,
      selectedKindCounts: Object.fromEntries(
        [...new Set(drafts.flatMap((r) => r.selectedKinds))].map((kind) => [
          kind,
          drafts.reduce((n, r) => n + r.selectedKinds.filter((k) => k === kind).length, 0),
        ]),
      ),
      latency: {
        samples: times.length,
        medianMs: times.length ? times[Math.ceil(times.length / 2) - 1] : null,
        p95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
      },
      completeUsageRows: completeUsage.length,
      tokens: {
        prompt: completeUsage.reduce((n, r) => n + r.execution.usage.promptTokens, 0),
        completion: completeUsage.reduce((n, r) => n + r.execution.usage.completionTokens, 0),
      },
      semanticQuality: null,
      semanticQualityLimitation:
        'Known fixture counts and complete canonical references do not measure editorial usefulness, source completeness, football realism or translation quality. Application templates supply wording; human review is pending.',
    };
  });
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    task: 'received-synthetic-segment-recap',
    summaries,
    results,
    limitations: [
      'These short seeded fixtures are not representative full matches.',
      'Selected-kind and favorite-player coverage describe objective choices, not a semantic quality score.',
      'Small-sample latency and reported tokens are descriptive; token totals are not monetary costs.',
    ],
  };
}
