import test from 'node:test';
import assert from 'node:assert/strict';
import { productionPackage } from './production-package.js';
import { ProductionDesk } from './production-desk-state.js';
import { matchState } from './match-stream.js';
import { createInvestigationTools } from './investigation-tools.js';
import { storyFacts } from './story-facts.js';
import { renderFactStory } from './fact-renderer.js';
const input = {
  kind: 'sustained',
  seed: 17,
  time: 96,
  anchorId: 'comparison-sustained-17-shot-96',
  language: 'es',
};
test('one chance produces genuinely distinct audience treatments and exact references', () => {
  const p = productionPackage(input);
  assert.equal(p.outputs.length, 3);
  assert.equal(new Set(p.outputs.map((o) => o.text)).size, 3);
  assert.match(p.outputs[0].text, /off target/);
  assert.match(p.outputs[1].text, /15-second window/);
  assert.match(p.outputs[2].text, /portería/);
  for (const o of p.outputs)
    assert.ok(o.evidence.some((r) => r.id === input.anchorId && r.revision === 1));
  assert.deepEqual(
    p.steps.map((s) => s.time),
    [90, 94, 96],
  );
  assert.equal(
    p.key,
    productionPackage({ ...input, time: 97 }).key,
    'clock-only advancement preserves the review identity',
  );
});
test('provider correction changes every dependent output and irreversibly withdraws the old approval', () => {
  const desk = new ProductionDesk(),
    old = productionPackage(input);
  desk.receive(old);
  desk.approve(true);
  desk.preview();
  assert.ok(desk.graphic);
  desk.beginCheck();
  assert.equal(desk.graphic, null, 'hide while checking');
  const corrected = productionPackage({ ...input, time: 98 });
  desk.receive(corrected);
  assert.equal(desk.status, 'withdrawn');
  assert.equal(desk.graphic, null);
  assert.throws(() => desk.export(), /Approve/);
  assert.ok(corrected.outputs.every((o, i) => o.decisionKey !== old.outputs[i].decisionKey));
  assert.match(corrected.outputs[0].text, /saved/);
  desk.receive(old);
  assert.equal(desk.status, 'withdrawn', 'rewinding cannot restore a revoked approval');
  desk.receive(corrected);
  desk.reviewReplacement();
  assert.equal(desk.status, 'review');
  assert.throws(() => desk.approve(false), /Review/);
  desk.approve(true);
  desk.preview();
  assert.match(desk.graphic.outputs[0].text, /saved/);
  const exported = desk.export();
  assert.equal(exported.outputs[2].language, 'es');
  assert.equal(exported.humanReview.action, 'approved');
});
test('changing language or a same-revision source body invalidates an approval', () => {
  const before = productionPackage(input),
    fr = productionPackage({ ...input, language: 'fr' });
  assert.notEqual(before.key, fr.key);
  const changed = productionPackage(input, {
    stateFactory: (args) => {
      const s = matchState(args);
      s.events.find((e) => e.id === input.anchorId).outcome = 'saved';
      return s;
    },
  });
  assert.notEqual(changed.key, before.key);
});
test('invalid and withdrawn anchors fail instead of manufacturing a replacement', () => {
  for (const value of [
    { ...input, language: 'xx' },
    { ...input, time: 95 },
    { ...input, anchorId: 'not-an-event' },
    { ...input, extra: true },
  ])
    assert.throws(() => productionPackage(value));
});
test('failed revalidation clears preview and blocks approval and export', () => {
  const desk = new ProductionDesk();
  desk.receive(productionPackage(input));
  desk.approve(true);
  desk.preview();
  desk.beginCheck();
  desk.failCheck();
  assert.equal(desk.graphic, null);
  assert.throws(() => desk.preview());
  assert.throws(() => desk.export());
});

test('canonical AI selection is confined to its audience and falls back explicitly after correction', () => {
  const preferences = {
    ...input,
    audience: 'newcomer',
    language: 'en',
    favoriteClub: null,
    favoritePlayer: null,
  };
  const registry = createInvestigationTools(preferences);
  const outputs = Object.fromEntries(
    ['get_event_sequence', 'score_at_moment'].map((name) => [name, registry.execute(name, {})]),
  );
  const catalog = storyFacts(outputs, registry.scope),
    selectedFacts = [catalog.facts.find((f) => f.kind === 'moment')];
  const selectedFactIds = selectedFacts.map((f) => f.id),
    rendered = renderFactStory(catalog, selectedFactIds, preferences);
  const aiDraft = {
    status: 'draft',
    evidenceSource: 'integrated-match',
    anchorId: input.anchorId,
    key: registry.key,
    audience: 'newcomer',
    language: 'en',
    selectedFactIds,
    selectedFacts,
    claims: rendered.claims,
    authorship: { selection: 'azure-model', wording: 'application-fact-templates' },
  };
  const p = productionPackage({ ...input, aiDraft });
  assert.equal(p.outputs[0].source, 'ai');
  assert.equal(p.outputs[1].source, 'recorded');
  assert.equal(p.outputs[2].source, 'recorded');
  const corrected = productionPackage({ ...input, time: 98, aiDraft });
  assert.equal(corrected.outputs[0].source, 'recorded');
  assert.match(corrected.notices[0], /no longer current/);
  assert.match(corrected.outputs[0].text, /saved/);
  const tampered = structuredClone(aiDraft);
  tampered.claims[0].text = 'Invented goal';
  const rejected = productionPackage({ ...input, aiDraft: tampered });
  assert.equal(rejected.outputs[0].source, 'recorded');
  assert.doesNotMatch(rejected.outputs[0].text, /Invented/);
});
