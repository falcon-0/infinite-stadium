import test from 'node:test';
import assert from 'node:assert/strict';
import { storyContextRequirement, validateStoryContext } from './story-context.js';
import { storyFacts } from './story-facts.js';
import { createInvestigationTools } from './investigation-tools.js';
import { renderFactStory } from './fact-renderer.js';

const wide = {
  kind: 'wide',
  seed: 902,
  time: 10,
  anchorId: 'wide-902-shot',
  audience: 'analyst',
  language: 'es',
};
function catalog(
  input = wide,
  names = ['get_event_sequence', 'score_at_moment', 'get_match_patterns', 'measure_moment'],
) {
  const registry = createInvestigationTools(input);
  return storyFacts(
    Object.fromEntries(names.map((name) => [name, registry.execute(name, {})])),
    registry.scope,
  );
}

test('supported comparative story is an analyst alternative but not a spatial measurement requirement', () => {
  const facts = catalog({
    kind: 'sustained',
    seed: 17,
    time: 120,
    anchorId: 'comparison-sustained-17-shot-116',
  });
  const comparison = facts.facts.find((f) => f.kind === 'window-shot-change'),
    analyst = storyContextRequirement(facts, 'analyst');
  assert.ok(analyst.candidateFactIds.includes(comparison.id));
  assert.equal(validateStoryContext([facts.facts[0].id, comparison.id], analyst), true);
  assert.equal(
    storyContextRequirement(facts, 'spatial').candidateFactIds.includes(comparison.id),
    false,
  );
  for (const audience of ['newcomer', 'player'])
    assert.equal(storyContextRequirement(facts, audience).minimum, 0);
  const invalid = structuredClone(facts);
  invalid.facts.find((f) => f.kind === 'window-shot-change').values.recentCount = 2;
  assert.equal(
    storyContextRequirement(invalid, 'analyst').candidateFactIds.includes(comparison.id),
    false,
  );
});

test('corrected wide analyst context includes confirmed pass revision without anchor-only shot repetition', () => {
  const facts = catalog(wide, ['get_event_sequence', 'score_at_moment', 'get_match_patterns']);
  const requirement = storyContextRequirement(facts, 'analyst'),
    pass = facts.facts.find(
      (f) => f.kind === 'window-event-count' && f.values.category === 'completedPasses',
    );
  assert.equal(requirement.minimum, 1);
  assert.deepEqual(requirement.candidateFactIds, [pass.id]);
  assert.deepEqual(pass.values, {
    team: 'home',
    category: 'completedPasses',
    count: 1,
    start: 0,
    end: 8,
    inclusive: true,
  });
  assert.deepEqual(pass.evidence, [{ type: 'event', id: 'wide-902-pass', revision: 2 }]);
  const ids = facts.facts
    .filter((f) => ['moment', 'goal-score-change'].includes(f.kind))
    .map((f) => f.id);
  assert.throws(() => validateStoryContext(ids, requirement), /nonredundant/);
  const selection = [...ids, pass.id],
    before = [...selection];
  assert.equal(validateStoryContext(selection, requirement), true);
  assert.deepEqual(selection, before);
  const rendered = renderFactStory(facts, selection, { language: 'es', audience: 'analyst' });
  assert.deepEqual(rendered.claims.at(-1).evidence, pass.evidence);
});

test('spatial candidates are exact corrected sampled metrics, not positive window counts', () => {
  const facts = catalog(),
    requirement = storyContextRequirement(facts, 'spatial');
  assert.equal(requirement.minimum, 1);
  assert.equal(requirement.candidateFactIds.length, 2);
  const candidates = facts.facts.filter((f) => requirement.candidateFactIds.includes(f.id));
  assert.deepEqual(
    candidates.map((f) => f.kind),
    ['nearest-sampled-opponent', 'player-sample-displacement-rate'],
  );
  assert.ok(
    candidates.every((f) =>
      f.evidence.some((r) => r.type === 'frame' && r.id === 'wide-902-frame-8' && r.revision === 2),
    ),
  );
  assert.equal(candidates[0].values.value, 2.8663856810831407);
  for (const candidate of candidates) {
    const chosen = [facts.facts[0].id, candidate.id],
      snapshot = [...chosen];
    assert.equal(validateStoryContext(chosen, requirement), true);
    assert.deepEqual(chosen, snapshot);
  }
  const count = facts.facts.find(
    (f) => f.kind === 'window-event-count' && f.values.category === 'completedPasses',
  );
  assert.throws(() => validateStoryContext([facts.facts[0].id, count.id], requirement));
});

test('real extended recovery and pass buildup qualify for analyst but not spatial coverage', () => {
  const facts = catalog({ kind: 'extended', seed: 17, time: 30, anchorId: 'extended-17-0-shot' }, [
    'get_event_sequence',
    'score_at_moment',
  ]);
  const requirement = storyContextRequirement(facts, 'analyst'),
    candidates = facts.facts.filter((f) => requirement.candidateFactIds.includes(f.id));
  assert.deepEqual(
    candidates.map((f) => f.kind),
    ['recovery-before-shot', 'completed-passes-between'],
  );
  assert.equal(candidates[0].values.seconds, 8);
  assert.equal(candidates[1].values.count, 1);
  assert.deepEqual(
    candidates[1].evidence.map((r) => `${r.id}@${r.revision}`),
    ['extended-17-0-pass@2', 'extended-17-0-recovery@1', 'extended-17-0-shot@2'],
  );
  assert.equal(storyContextRequirement(facts, 'spatial').minimum, 0);
});

test('baseline-only catalogs do not demand unavailable context and newcomer/player requirements remain zero', () => {
  const baseline = catalog(wide, ['get_event_sequence', 'score_at_moment']);
  for (const audience of ['analyst', 'spatial']) {
    const requirement = storyContextRequirement(baseline, audience);
    assert.equal(requirement.minimum, 0);
    assert.deepEqual(requirement.candidateFactIds, []);
    assert.equal(validateStoryContext([baseline.facts[0].id], requirement), true);
  }
  for (const audience of ['newcomer', 'player']) {
    const requirement = storyContextRequirement(catalog(), audience);
    assert.equal(requirement.minimum, 0);
    assert.deepEqual(requirement.candidateFactIds, []);
  }
});

test('zero, unknown, pending, single-shot and future-window context cannot force selection', () => {
  const facts = catalog(wide, ['get_event_sequence', 'score_at_moment', 'get_match_patterns']);
  const pass = facts.facts.find((f) => f.values.category === 'completedPasses'),
    shot = facts.facts.find((f) => f.values.category === 'shots');
  const variants = [
    { ...pass, id: 'zero', values: { ...pass.values, count: 0 } },
    { ...pass, id: 'pending', values: { ...pass.values, category: 'pendingPasses' } },
    { ...pass, id: 'unknown', values: { ...pass.values, category: 'pressure' } },
    { ...pass, id: 'future', values: { ...pass.values, end: 9 } },
    { ...pass, id: 'no-support', evidence: [] },
    shot,
  ];
  const isolated = { ...facts, facts: [facts.facts[0], ...variants] };
  assert.deepEqual(storyContextRequirement(isolated, 'analyst').candidateFactIds, []);
  const multiple = { ...shot, id: 'two-shots', values: { ...shot.values, count: 2 } };
  assert.deepEqual(
    storyContextRequirement({ ...isolated, facts: [multiple] }, 'analyst').candidateFactIds,
    ['two-shots'],
  );
});

test('linked pass and shot sampled displacement facts qualify without inventing full path or peak speed', () => {
  for (const [time, anchorId, expectedKind] of [
    [24, 'extended-17-0-receive', 'pass-endpoint-displacement'],
    [29, 'extended-17-0-flight', 'shot-ball-sample-displacement-rate'],
  ]) {
    const facts = catalog({ kind: 'extended', seed: 17, time, anchorId }, [
      'get_event_sequence',
      'measure_moment',
    ]);
    const requirement = storyContextRequirement(facts, 'spatial'),
      fact = facts.facts.find((f) => f.kind === expectedKind);
    assert.ok(fact);
    assert.ok(requirement.candidateFactIds.includes(fact.id));
    assert.equal(fact.evidence.filter((r) => r.type === 'event').length, 2);
    assert.equal(fact.evidence.filter((r) => r.type === 'frame').length, 2);
  }
});

test('malformed scope, duplicate IDs, invalid audience and impossible requirements fail closed', () => {
  const facts = catalog();
  for (const broken of [
    null,
    { ...facts, scope: { ...facts.scope, observedAt: 7 } },
    { ...facts, scope: { ...facts.scope, eventTime: NaN } },
    { ...facts, facts: [facts.facts[0], facts.facts[0]] },
  ])
    assert.throws(() => storyContextRequirement(broken, 'analyst'), RangeError);
  assert.throws(() => storyContextRequirement(facts, 'unknown'));
  assert.throws(() => validateStoryContext([], { candidateFactIds: [], minimum: 1 }));
  assert.throws(() =>
    validateStoryContext(['duplicate', 'duplicate'], { candidateFactIds: [], minimum: 0 }),
  );
});
