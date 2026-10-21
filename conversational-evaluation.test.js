import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createConversationPlan,
  scoreConversationReports,
  classifyConversationOutcome,
  captureEvaluationIdentity,
} from './conversational-evaluation.js';

const identity = { buildFingerprint: 'build', promptFingerprint: 'prompt' };
const cases = [
  {
    id: 'unknown',
    category: 'useful-uncertainty',
    input: {
      kind: 'sustained',
      seed: 2317,
      time: 96,
      language: 'en',
      question: 'What was the chance probability?',
    },
  },
];
const plan = () => createConversationPlan(identity, { repeat: 2, cases });
const report = (p, repeat = 1, overrides = {}) => ({
  mode: 'real-azure',
  evaluationIdentity: { planId: p.planId, ...identity, repeatIndex: repeat },
  cases: [
    {
      id: 'unknown',
      input: cases[0].input,
      status: 'generated',
      answer: { answer: 'The record does not supply that probability.' },
      elapsedMs: 100,
      ...overrides,
    },
  ],
});
const review = (rowId) => ({
  rowId,
  method: 'human',
  reviewer: 'Test reviewer fixture',
  reviewedAt: '2026-10-14T00:00:00Z',
  factuality: 'pass',
  relevance: 'pass',
  usefulness: 'pass',
  uncertainty: 'appropriate',
  rationale: 'Test fixture: useful limitation without fabricated probability.',
});

test('generation is unreviewed, repeat coverage remains missing, and no score is invented', () => {
  const p = plan(),
    r = scoreConversationReports(p, [report(p)]);
  assert.equal(r.modelCalls, 0);
  assert.equal(r.coverage.received, 1);
  assert.deepEqual(r.coverage.missing, [{ caseId: 'unknown', repeatIndex: 2 }]);
  assert.equal(r.quality.human.factualityPassRate, null);
  assert.equal(r.quality.unreviewedPlannedLive, 1);
  assert.equal(r.reviewTemplate[0].reviewer, null);
});
test('legacy successes and mocked runs never inflate current live quality', () => {
  const p = plan(),
    legacy = { cases: report(p).cases },
    mock = { ...report(p), mode: 'mock' };
  const first = scoreConversationReports(p, [legacy, mock]);
  const r = scoreConversationReports(p, [legacy, mock], {
    reviews: first.rows.map((row) => review(row.rowId)),
  });
  assert.equal(r.outcomes.allImported.generated, 2);
  assert.equal(r.coverage.received, 0);
  assert.equal(r.quality.human.reviewed, 0);
});
test('provider failure, semantic withholding and setup failure remain distinct', () => {
  assert.equal(
    classifyConversationOutcome({
      status: 'failed',
      error: { status: 502, code: 'question-withheld' },
    }),
    'withheld',
  );
  assert.equal(
    classifyConversationOutcome({
      status: 'failed',
      error: { status: 502, code: 'azure-network' },
    }),
    'provider-failed',
  );
  assert.equal(
    classifyConversationOutcome({ status: 'failed', error: { status: 502 } }),
    'application-failed',
  );
  assert.equal(classifyConversationOutcome({ status: 'blocked' }), 'setup-blocked');
});
test('human useful uncertainty and automated factual scores remain separate', () => {
  const p = plan(),
    reports = [report(p), report(p, 2)],
    first = scoreConversationReports(p, reports);
  const human = review(first.rows[0].rowId),
    automated = {
      ...review(first.rows[1].rowId),
      method: 'automated',
      factuality: 'fail',
      usefulness: 'fail',
      uncertainty: 'unsupported-certainty',
    };
  const r = scoreConversationReports(p, reports, { reviews: [human, automated] });
  assert.equal(r.quality.human.factualityPassRate, 1);
  assert.equal(r.quality.human.uncertainty.appropriate, 1);
  assert.equal(r.quality.automated.factualityPassRate, 0);
  assert.equal(r.quality.automated.uncertainty['unsupported-certainty'], 1);
  assert.equal(r.repeatability[0].humanFactualFailures, 0);
});
test('provider failures cannot inflate quality even if a reviewer labels them passes', () => {
  const p = plan(),
    r = report(p, 1, {
      status: 'failed',
      answer: undefined,
      error: { code: 'azure-timeout', status: 504 },
    });
  const row = scoreConversationReports(p, [r]).rows[0];
  const scored = scoreConversationReports(p, [r], { reviews: [review(row.rowId)] });
  assert.equal(scored.outcomes.plannedLive['provider-failed'], 1);
  assert.equal(scored.quality.human.reviewed, 0);
  assert.equal(scored.quality.human.factualityPassRate, null);
});
test('raw draft and repair candidates survive import without acquiring semantic judgments', () => {
  const p = plan(),
    r = report(p, 1, {
      calls: [
        { output: JSON.stringify({ draft: { claims: [{ text: 'Unsupported claim.' }] } }) },
        { output: JSON.stringify({ decision: 'withhold' }) },
        { output: JSON.stringify({ claims: [{ text: 'Useful corrected limitation.' }] }) },
      ],
    });
  r.sourceIdentity = { sha256: 'preserved-provider-run-identity' };
  const row = scoreConversationReports(p, [r]).rows[0];
  assert.deepEqual(
    row.draftCandidates.map((c) => c.callIndex),
    [0, 2],
  );
  assert.ok(row.draftCandidates.every((c) => c.quality === 'unreviewed'));
  assert.deepEqual(row.sourceIdentity, r.sourceIdentity);
  assert.equal(row.review, null);
});
test('duplicate files, duplicate slots, tampered plans and mismatched inputs cannot certify repeats', () => {
  const p = plan(),
    r = report(p);
  assert.throws(() => scoreConversationReports(p, [r, r]), /Duplicate report/);
  assert.throws(
    () => scoreConversationReports(p, [r, { ...r, createdAt: 'different' }]),
    /Duplicate case\/repeat/,
  );
  assert.throws(() => scoreConversationReports({ ...p, repeat: 3 }, [r]), /Plan identity/);
  const wrong = report(p, 1, { input: { ...cases[0].input, time: 118 } });
  assert.equal(scoreConversationReports(p, [wrong]).coverage.received, 0);
  assert.equal(
    scoreConversationReports(p, [
      { ...r, evaluationIdentity: { ...r.evaluationIdentity, buildFingerprint: 'old' } },
    ]).coverage.received,
    0,
  );
});
test('reviews need explicit provenance and cannot silently overwrite adjudication', () => {
  const p = plan(),
    r = report(p),
    row = scoreConversationReports(p, [r]).rows[0];
  assert.throws(
    () => scoreConversationReports(p, [r], { reviews: [{ ...review(row.rowId), reviewer: '' }] }),
    /Review needs/,
  );
  assert.throws(
    () => scoreConversationReports(p, [r], { reviews: [review(row.rowId), review(row.rowId)] }),
    /Duplicate review/,
  );
});
test('source fingerprint detects dirty prompt changes independent of git commit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'conversation-identity-'));
  try {
    for (const file of [
      'match-question-ai.js',
      'question-policies.js',
      'question-evidence-check.js',
      'ai.js',
    ])
      writeFileSync(join(directory, file), 'original');
    const before = captureEvaluationIdentity(directory);
    writeFileSync(join(directory, 'match-question-ai.js'), 'changed');
    const after = captureEvaluationIdentity(directory);
    assert.notEqual(before.buildFingerprint, after.buildFingerprint);
    assert.notEqual(before.promptFingerprint, after.promptFingerprint);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('offline CLI scores a historical file without model credentials and refuses overwrite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'conversation-cli-'));
  try {
    const p = plan(),
      planFile = join(directory, 'plan.json'),
      reportFile = join(directory, 'report.json'),
      output = join(directory, 'score.json');
    writeFileSync(planFile, JSON.stringify(p));
    writeFileSync(reportFile, JSON.stringify({ cases: report(p).cases }));
    const args = [
      'conversational-evaluation-cli.js',
      'score',
      `--plan=${planFile}`,
      `--report=${reportFile}`,
      `--out=${output}`,
    ];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(readFileSync(output));
    assert.equal(saved.modelCalls, 0);
    assert.equal(saved.coverage.received, 0);
    assert.notEqual(
      spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true }).status,
      0,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('composition capture preserves exact writer selection, unsupported prose and captured catalogue provenance', () => {
  const p = plan();
  const catalog = {
    version: 'question-facts-v1',
    sourceFingerprint: 'frozen-source',
    facts: [
      {
        id: 'second',
        claim: {
          text: 'Second selected fact.',
          kind: 'observation',
          evidence: [{ id: 'e2', revision: 2 }],
        },
        selection: { kind: 'count', timeTo: 96 },
      },
      {
        id: 'unused',
        claim: { text: 'Must never enter draft.', kind: 'observation', evidence: [] },
      },
      {
        id: 'first',
        claim: {
          text: 'First selected fact.',
          kind: 'observation',
          evidence: [{ id: 'e1', revision: 1 }],
        },
      },
    ],
  };
  const paragraph = {
    text: 'Unsupported physical certainty, kept verbatim.',
    kind: 'interpretation',
    evidence: [],
    dependsOn: [1],
  };
  const raw = {
    composition: { mode: 'explanation', factIds: ['first', 'second'], claim: paragraph },
  };
  const rawJSON = JSON.stringify(raw);
  const r = report(p, 1, {
    calls: [
      {
        output: rawJSON,
        request: { messages: [{ role: 'user', content: JSON.stringify({ matchFacts: catalog }) }] },
      },
    ],
  });
  const row = scoreConversationReports(p, [r]).rows[0],
    candidate = row.draftCandidates[0];
  assert.equal(candidate.rawJSON, rawJSON);
  assert.deepEqual(candidate.rawValue, raw);
  assert.deepEqual(candidate.selectedFactIds, ['first', 'second']);
  assert.deepEqual(candidate.generatedParagraph, paragraph);
  assert.equal(
    candidate.text,
    'First selected fact. Second selected fact. Unsupported physical certainty, kept verbatim.',
  );
  assert.equal(candidate.catalogProvenance.sourceFingerprint, 'frozen-source');
  assert.match(candidate.catalogProvenance.capturedCatalogHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(candidate.selectedFacts[1].fact.claim.evidence, [{ id: 'e2', revision: 2 }]);
  assert.equal(candidate.stage, 'raw-writer-output');
  assert.equal(candidate.canonicalAnswer, null);
  assert.equal(row.finalCapture.stage, 'final-returned');
  assert.notEqual(row.answer, candidate.text);
  assert.equal(row.review, null);
  assert.equal(candidate.quality, 'unreviewed');
});

test('unknown or ambiguous IDs stay unresolved rather than borrowing final or other-call facts', () => {
  const p = plan(),
    raw = { composition: { mode: 'facts', factIds: ['missing'] } };
  const catalog = {
    sourceFingerprint: 'current',
    facts: [{ id: 'known', claim: { text: 'Known.' } }],
  };
  const r = report(p, 1, {
    answer: {
      answer: 'Final answer must not fill missing drafts.',
      canonicalFactSelection: { selectedFactIds: ['missing'] },
    },
    calls: [
      {
        output: JSON.stringify(raw),
        request: { messages: [{ role: 'user', content: JSON.stringify({ matchFacts: catalog }) }] },
      },
      { output: JSON.stringify({ composition: { mode: 'facts', factIds: ['known'] } }) },
      {
        output: JSON.stringify({ composition: { mode: 'facts', factIds: ['duplicate'] } }),
        request: {
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                matchFacts: {
                  facts: [
                    { id: 'duplicate', claim: { text: 'A' } },
                    { id: 'duplicate', claim: { text: 'B' } },
                  ],
                },
              }),
            },
          ],
        },
      },
    ],
  });
  const drafts = scoreConversationReports(p, [r]).rows[0].draftCandidates;
  assert.equal(drafts[0].selectedFacts[0].resolution, 'unknown-id');
  assert.equal(drafts[1].selectedFacts[0].resolution, 'catalog-unavailable');
  assert.equal(drafts[2].selectedFacts[0].resolution, 'ambiguous-id');
  for (const candidate of drafts) {
    assert.equal(candidate.text, null);
    assert.equal(candidate.claims, null);
    assert.equal(candidate.canonicalAnswer, null);
    assert.equal(candidate.selectionResolution, 'unresolved');
  }
  assert.equal(drafts[1].catalogProvenance, null);
});

test('native response envelopes and repair catalogues remain distinct from prechecked and failed stages', () => {
  const p = plan();
  const rejected = { claims: [{ text: 'Rejected certainty.' }] };
  const raw = {
    composition: {
      mode: 'explanation',
      factIds: ['f'],
      claim: { text: 'Still unsupported.', kind: 'interpretation', dependsOn: [0], evidence: [] },
    },
  };
  const checked = { claims: [{ text: 'Already checked source text.' }] };
  const repairPayload = {
    evidence: {
      matchFacts: {
        sourceFingerprint: 'repair-source',
        facts: [{ id: 'f', claim: { text: 'Captured support.' } }],
      },
    },
    rejectedAnswer: rejected,
    feedback: { issues: ['source guard issue'] },
  };
  const request = { messages: [{ role: 'user', content: JSON.stringify(repairPayload) }] };
  const calls = [
    {
      request,
      response: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }),
    },
    {
      schema: 'match_answer_review',
      request: {
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              answer: checked,
              evidence: { sourceFingerprint: 'checked-source' },
            }),
          },
        ],
      },
      response: { choices: [{ message: { content: JSON.stringify({ checks: [] }) } }] },
    },
    {
      request: {
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              rejectedPlan: { decision: { kind: 'general' } },
              planningError: 'Needs match evidence.',
            }),
          },
        ],
      },
      output: JSON.stringify({ decision: { kind: 'queries' } }),
    },
  ];
  const row = scoreConversationReports(p, [
    report(p, 1, {
      status: 'failed',
      answer: null,
      error: { code: 'question-withheld', message: 'Rejected.' },
      calls,
    }),
  ]).rows[0];
  assert.equal(row.draftCandidates.length, 1);
  assert.equal(row.draftCandidates[0].generatedParagraph.text, 'Still unsupported.');
  assert.equal(
    row.draftCandidates[0].catalogProvenance.location,
    'request.user.evidence.matchFacts',
  );
  assert.deepEqual(row.precheckedCandidates[0].answer, checked);
  assert.equal(row.precheckedCandidates[0].quality, 'unreviewed');
  assert.match(row.precheckedCandidates[0].limitation, /not an independent baseline/);
  assert.deepEqual(
    row.rejectionStages.map((r) => r.stage),
    ['repair-request', 'planning-repair-request'],
  );
  assert.deepEqual(row.rejectionStages[0].rejectedAnswer, rejected);
  assert.equal(row.failureCapture.stage, 'reported-failure');
  assert.equal(row.finalCapture, null);
});

test('special composition transformations are not invented by draft capture', () => {
  const p = plan(),
    r = report(p, 1, {
      calls: [
        {
          output: JSON.stringify({
            composition: { mode: 'player-pick', playerId: 'home-7', factIds: ['f'] },
          }),
          request: {
            messages: [
              {
                role: 'user',
                content: JSON.stringify({
                  matchFacts: { facts: [{ id: 'f', claim: { text: 'One recorded event.' } }] },
                }),
              },
            ],
          },
        },
      ],
    });
  const draft = scoreConversationReports(p, [r]).rows[0].draftCandidates[0];
  assert.equal(draft.selectionResolution, 'resolved');
  assert.equal(draft.selectedFacts[0].fact.claim.text, 'One recorded event.');
  assert.equal(draft.text, null);
  assert.equal(draft.canonicalAnswer, null);
});
