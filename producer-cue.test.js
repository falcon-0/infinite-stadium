import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryCue } from './producer-cue.js';
import { createInvestigationTools } from './investigation-tools.js';
import { storyFacts } from './story-facts.js';
import { renderFactStory } from './fact-renderer.js';
import { integratedMatch } from './match-stream.js';

function fixture() {
  const input = {
    kind: 'extended',
    seed: 17,
    time: 330,
    anchorId: 'extended-17-10-shot',
    audience: 'analyst',
  };
  const registry = createInvestigationTools(input),
    outputs = Object.fromEntries(
      ['get_event_sequence', 'score_at_moment', 'measure_moment', 'get_match_patterns'].map(
        (name) => [name, registry.execute(name, {})],
      ),
    );
  const catalog = storyFacts(outputs, registry.scope),
    facts = ['moment', 'score', 'window-event-count', 'player-sample-displacement-rate'].map(
      (kind) => catalog.facts.find((f) => f.kind === kind),
    );
  const selectedFactIds = facts.map((f) => f.id),
    rendered = renderFactStory(catalog, selectedFactIds, { audience: 'analyst' });
  const draft = {
    ...rendered,
    status: 'draft',
    key: registry.key,
    anchorId: input.anchorId,
    selectedFactIds,
    authorship: { selection: 'azure-model', wording: 'application-fact-templates' },
  };
  const explanation = integratedMatch(input).explanation;
  const options = {
    preferencesMatch: true,
    observedAt: 330,
    eventTime: 328,
    receivedReferences: Object.values(outputs).flatMap((output) => output.references),
    language: 'en',
    audience: 'analyst',
    factCatalog: catalog,
  };
  return { draft, explanation, options };
}

test('cue keeps complete score and pattern support beyond the moment window with explicit replay timing', () => {
  const { draft, explanation, options } = fixture(),
    cue = buildStoryCue(draft, explanation, options);
  assert.equal(cue.status, 'human-review-required');
  assert.equal(cue.synthetic, true);
  assert.deepEqual(cue.timing, {
    unit: 'seconds',
    anchorEventTime: 328,
    availableAtObservedTime: 330,
    durationSeconds: 20,
    expiresAtObservedTime: 350,
    synchronization: 'received-synthetic-replay',
  });
  assert.equal(cue.claims.length, 4);
  const oldGoal = { type: 'event', id: 'extended-17-0-shot', revision: 2 };
  assert.ok(!explanation.evidence.some((ref) => ref.id === oldGoal.id));
  assert.ok(cue.evidence.some((ref) => ref.id === oldGoal.id));
  assert.deepEqual(cue.claims[1].evidence, draft.claims[1].evidence);
  assert.match(cue.limitation, /not a broadcast publishing command/);
});

test('export is pure and detached from draft, explanation and received input objects', () => {
  const f = fixture(),
    before = structuredClone(f),
    cue = buildStoryCue(f.draft, f.explanation, f.options);
  assert.deepEqual(f, before);
  cue.claims[0].evidence[0].revision = 99;
  cue.claims[0].text = 'changed';
  assert.deepEqual(f, before);
});

test('superseded selections, changed preferences and noncanonical drafts cannot become cues', () => {
  for (const change of [
    (f) => (f.draft.key = 'old'),
    (f) => (f.draft.anchorId = 'wrong'),
    (f) => (f.options.preferencesMatch = false),
    (f) => (f.draft.status = 'withheld'),
    (f) => (f.draft.status = 'pending'),
    (f) => (f.draft.authorship.wording = 'azure-model'),
    (f) => (f.options.language = 'fr'),
    (f) => (f.options.audience = 'newcomer'),
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options));
  }
});

test('unknown and stale support fail closed, even when the story key still matches', () => {
  for (const alter of [
    (f) => f.draft.claims[0].evidence.push({ type: 'event', id: 'unknown', revision: 1 }),
    (f) => f.draft.claims[1].evidence[0].revision++,
    (f) => (f.options.receivedReferences = f.explanation.evidence),
  ]) {
    const f = fixture();
    alter(f);
    assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options), /unknown|superseded/);
  }
});

test('catalog validation rejects incomplete citations instead of exporting an apparently supported score', () => {
  const f = fixture();
  f.draft.claims[1].evidence.pop();
  assert.throws(
    () => buildStoryCue(f.draft, f.explanation, f.options),
    /complete catalog fact references/,
  );
});

test('conflicting current revision lists and missing reference inventories are rejected', () => {
  const f = fixture();
  f.options.receivedReferences.push({ ...f.options.receivedReferences[0], revision: 99 });
  assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options), /conflicting revisions/);
  delete f.options.receivedReferences;
  assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options), /Supply current/);
});

test('cue time cannot masquerade as current play and duration is bounded', () => {
  for (const options of [
    { eventTime: 330 },
    { observedAt: 327 },
    { durationSeconds: 0 },
    { durationSeconds: 61 },
    { observedAt: Infinity },
  ]) {
    const f = fixture();
    Object.assign(f.options, options);
    assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options), RangeError);
  }
  const f = fixture();
  f.options.durationSeconds = 5;
  assert.equal(buildStoryCue(f.draft, f.explanation, f.options).timing.expiresAtObservedTime, 335);
});

test('empty, duplicated, mismatched and oversized canonical selections are rejected', () => {
  for (const alter of [
    (f) => (f.draft.claims = []),
    (f) => (f.draft.selectedFactIds[1] = f.draft.selectedFactIds[0]),
    (f) => (f.draft.claims[0].factId = 'wrong'),
    (f) => (f.draft.audience = 'newcomer'),
  ]) {
    const f = fixture();
    delete f.options.audience;
    alter(f);
    assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options));
  }
});

test('local canonical model selections keep their own authorship in studio cues', () => {
  const f = fixture();
  f.draft.authorship.selection = 'local-model';
  const cue = buildStoryCue(f.draft, f.explanation, f.options);
  assert.deepEqual(cue.authorship, {
    selection: 'local-model',
    wording: 'application-fact-templates',
  });
  f.draft.authorship.selection = 'unrecognized-model';
  assert.throws(() => buildStoryCue(f.draft, f.explanation, f.options), /canonical/i);
});
