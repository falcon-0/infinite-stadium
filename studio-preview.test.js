import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioPreview, studioPreviewState } from './studio-preview.js';
import { buildStoryCue } from './producer-cue.js';
import { createInvestigationTools } from './investigation-tools.js';
import { storyFacts } from './story-facts.js';
import { renderFactStory } from './fact-renderer.js';
import { integratedMatch, integratedFeed } from './match-stream.js';

function fixture(observedAt = 330) {
  const input = {
    kind: 'extended',
    seed: 17,
    time: 330,
    anchorId: 'extended-17-10-shot',
    audience: 'analyst',
    language: 'en',
  };
  const registry = createInvestigationTools(input),
    outputs = Object.fromEntries(
      ['get_event_sequence', 'score_at_moment', 'measure_moment', 'get_match_patterns'].map(
        (name) => [name, registry.execute(name, {})],
      ),
    );
  const catalog = storyFacts(outputs, registry.scope),
    selectedFactIds = [
      'moment',
      'score',
      'window-event-count',
      'player-sample-displacement-rate',
    ].map((kind) => catalog.facts.find((f) => f.kind === kind).id);
  const rendered = renderFactStory(catalog, selectedFactIds, { audience: 'analyst' });
  const draft = {
    ...rendered,
    status: 'draft',
    key: registry.key,
    anchorId: input.anchorId,
    selectedFactIds,
    authorship: { selection: 'azure-model', wording: 'application-fact-templates' },
  };
  const receivedReferences = Object.values(outputs).flatMap((output) => output.references),
    preferences = {
      kind: 'extended',
      seed: 17,
      audience: 'analyst',
      language: 'en',
      favoriteClub: 'home',
      favoritePlayer: 'A. Reed',
    };
  const cue = buildStoryCue(draft, integratedMatch(input).explanation, {
    preferencesMatch: true,
    observedAt,
    eventTime: 328,
    receivedReferences,
    factCatalog: catalog,
  });
  return {
    cue,
    preview: createStudioPreview(cue, { preferences }),
    options: { time: observedAt, receivedReferences, preferences, evidenceKey: cue.evidenceKey },
  };
}

test('current exported canonical cue renders complete claims under a distinct event-age display cutoff', () => {
  const f = fixture(),
    state = studioPreviewState(f.preview, f.options);
  assert.equal(state.status, 'visible');
  assert.equal(state.publishing, false);
  assert.equal(state.reviewStatus, 'human-review-required');
  assert.deepEqual(state.claims, f.cue.claims);
  assert.equal(state.timing.expiresAtObservedTime, 350);
  assert.equal(state.timing.effectiveExpiresAt, 348);
  assert.equal(state.previewPolicy, 'event-age-limited');
  assert.equal(f.cue.timing.expiresAtObservedTime, 350);
  assert.ok(
    state.claims[1].evidence.some((r) => r.id === 'extended-17-0-shot'),
    'Old score dependency is retained',
  );
});

test('event display expires at the exact boundary and late correction exports cannot revive old play', () => {
  const f = fixture();
  assert.equal(studioPreviewState(f.preview, { ...f.options, time: 347.999 }).status, 'visible');
  const expired = studioPreviewState(f.preview, { ...f.options, time: 348 });
  assert.equal(expired.status, 'expired');
  assert.deepEqual(expired.claims, []);
  const late = fixture(360),
    state = studioPreviewState(late.preview, late.options);
  assert.equal(state.status, 'expired');
  assert.equal(state.reason, 'event-display-window-ended');
  assert.equal(state.timing.expiresAtObservedTime, 380);
  assert.equal(state.timing.effectiveExpiresAt, 348);
  late.options.receivedReferences = late.options.receivedReferences.map((r) => ({
    ...r,
    revision: r.revision + 1,
  }));
  assert.equal(studioPreviewState(late.preview, late.options).status, 'expired');
});

test('future availability and future received inventories never display', () => {
  const f = fixture();
  const state = studioPreviewState(f.preview, { ...f.options, time: 329 });
  assert.equal(state.status, 'invalid');
  assert.equal(state.reason, 'cue-not-yet-available');
  assert.deepEqual(state.claims, []);
  for (const ref of [
    { ...f.options.receivedReferences[0], time: 329, arrivedAt: 331 },
    { ...f.options.receivedReferences[0], time: 331, arrivedAt: 331 },
  ]) {
    const result = studioPreviewState(f.preview, {
      ...f.options,
      receivedReferences: [ref, ...f.options.receivedReferences.slice(1)],
    });
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'unreceived-reference-inventory');
  }
});

test('any event, frame, metric or older score dependency revision withdraws the preview', () => {
  const f = fixture();
  for (const dependency of [
    f.cue.evidence.find((r) => r.type === 'event'),
    f.cue.evidence.find((r) => r.type === 'frame'),
    f.cue.evidence.find((r) => r.type === 'metric'),
    f.cue.evidence.find((r) => r.id === 'extended-17-0-shot'),
  ]) {
    assert.ok(dependency);
    const refs = f.options.receivedReferences.map((ref) =>
      ref.type === dependency.type && ref.id === dependency.id
        ? { ...ref, revision: ref.revision + 1 }
        : ref,
    );
    const state = studioPreviewState(f.preview, { ...f.options, receivedReferences: refs });
    assert.equal(state.status, 'superseded');
    assert.equal(state.reason, 'dependency-revised');
    assert.deepEqual(state.claims, []);
  }
});

test('withdrawn and unavailable dependencies remove claims immediately', () => {
  const f = fixture(),
    dependency = f.cue.evidence[0],
    match = (ref) => ref.id === dependency.id && ref.type === dependency.type;
  const deleted = studioPreviewState(f.preview, {
    ...f.options,
    receivedReferences: f.options.receivedReferences.map((ref) =>
      match(ref) ? { ...ref, operation: 'delete' } : ref,
    ),
  });
  assert.equal(deleted.reason, 'dependency-withdrawn');
  assert.equal(deleted.status, 'superseded');
  assert.deepEqual(deleted.claims, []);
  const absent = studioPreviewState(f.preview, {
    ...f.options,
    receivedReferences: f.options.receivedReferences.filter((ref) => !match(ref)),
  });
  assert.equal(absent.reason, 'dependency-unavailable');
  assert.deepEqual(absent.claims, []);
});

test('club, player, language, audience and current evidence selection changes supersede the preview', () => {
  const f = fixture();
  for (const changes of [
    { favoriteClub: 'away' },
    { favoritePlayer: 'D. Silva' },
    { language: 'fr' },
    { audience: 'player' },
    { kind: 'wide' },
    { seed: 18 },
  ]) {
    const state = studioPreviewState(f.preview, {
      ...f.options,
      preferences: { ...f.options.preferences, ...changes },
    });
    assert.equal(state.status, 'superseded');
    assert.equal(state.reason, 'preferences-changed');
    assert.deepEqual(state.claims, []);
  }
  assert.equal(
    studioPreviewState(f.preview, { ...f.options, evidenceKey: 'different-scope' }).reason,
    'evidence-selection-changed',
  );
  assert.equal(
    studioPreviewState(f.preview, { ...f.options, preferences: undefined }).status,
    'invalid',
  );
  const bad = structuredClone(f.preview);
  delete bad.preferences;
  assert.equal(studioPreviewState(bad, f.options).reason, 'missing-or-invalid-preferences');
});

test('malformed cue contracts, claim unions and timing fail closed', () => {
  const mutations = [
    (cue) => (cue.schema = 'unknown'),
    (cue) => (cue.synthetic = false),
    (cue) => (cue.status = 'approved'),
    (cue) => (cue.authorship.wording = 'model-prose'),
    (cue) => (cue.timing.durationSeconds = 61),
    (cue) => (cue.timing.availableAtObservedTime = 327),
    (cue) => (cue.timing.expiresAtObservedTime = 351),
    (cue) => (cue.claims[0].text = ''),
    (cue) => (cue.claims[0].evidence = []),
    (cue) => (cue.claims[1].factId = cue.claims[0].factId),
    (cue) => cue.evidence.pop(),
    (cue) => cue.evidence.push({ type: 'event', id: 'invented', revision: 1 }),
    (cue) => cue.claims[0].evidence[0].revision++,
    (cue) =>
      (cue.claims[0].evidence = cue.claims[0].evidence.filter(
        (ref) => ref.type !== 'event' || ref.id !== cue.anchorId,
      )),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.preview.cue);
    const state = studioPreviewState(f.preview, f.options);
    assert.equal(state.status, 'invalid');
    assert.deepEqual(state.claims, []);
  }
});

test('malformed or conflicting active inventories are invalid rather than guessed', () => {
  const f = fixture(),
    first = f.options.receivedReferences[0];
  for (const receivedReferences of [
    undefined,
    [{ ...first, revision: 0 }],
    [first, { ...first, revision: first.revision + 1 }],
    [first, { ...first, operation: 'delete' }],
    [{ ...first, time: 1 }],
    [{ ...first, operation: 'unknown' }],
    Array.from({ length: 10001 }, () => first),
  ]) {
    const state = studioPreviewState(f.preview, { ...f.options, receivedReferences });
    assert.equal(state.status, 'invalid');
    assert.deepEqual(state.claims, []);
  }
});

test('snapshot capture and rendered output never mutate or share caller-owned inputs', () => {
  const f = fixture(),
    before = structuredClone(f),
    state = studioPreviewState(f.preview, f.options);
  assert.deepEqual(f, before);
  state.claims[0].text = 'changed';
  state.claims[0].evidence[0].revision = 999;
  state.timing.effectiveExpiresAt = 999;
  assert.deepEqual(f, before);
  f.cue.claims[0].text = 'original export changed';
  assert.notEqual(f.preview.cue.claims[0].text, f.cue.claims[0].text);
  f.options.preferences.favoritePlayer = 'changed';
  assert.equal(f.preview.preferences.favoritePlayer, 'A. Reed');
});

test('invalid time and local canonical authorship stay explicit', () => {
  const f = fixture();
  for (const time of [-1, NaN, Infinity, undefined])
    assert.equal(
      studioPreviewState(f.preview, { ...f.options, time }).reason,
      'invalid-observation-time',
    );
  f.preview.cue.authorship.selection = 'local-model';
  const state = studioPreviewState(f.preview, f.options);
  assert.equal(state.status, 'visible');
  assert.equal(state.authorship.selection, 'local-model');
});

function currentBundleReferences(bundle) {
  const current = new Map(bundle.state.events.map((e) => [e.id, e]));
  for (const update of bundle.state.updates)
    if (!current.has(update.id) || current.get(update.id).revision < update.revision)
      current.set(update.id, update);
  return [...current.values()]
    .map((e) => ({
      type: 'event',
      id: e.id,
      revision: e.revision,
      time: e.time,
      arrivedAt: e.arrivedAt,
      operation: e.operation,
    }))
    .concat(bundle.explanation?.evidence ?? [], bundle.explanation?.patterns?.evidence ?? []);
}

test('a new late past event supersedes aggregate cue context even when all old cited versions remain current', () => {
  const f = fixture(),
    feed = integratedFeed('extended', 17),
    input = {
      kind: 'extended',
      seed: 17,
      time: 331,
      anchorId: f.cue.anchorId,
      audience: 'analyst',
    };
  const shot = feed.events.find((e) => e.type === 'shot' && e.team === 'away');
  feed.events.push({
    ...shot,
    id: 'late-past-away-goal',
    revision: 1,
    time: 327,
    arrivedAt: 331,
    result: true,
  });
  const before = integratedMatch({ ...input, time: 330 }, feed),
    after = integratedMatch(input, feed),
    refs = currentBundleReferences(after);
  assert.equal(before.explanation.investigationKey, f.cue.evidenceKey);
  assert.notEqual(after.explanation.investigationKey, before.explanation.investigationKey);
  assert.equal(
    after.explanation.patterns.teams.away.shots,
    before.explanation.patterns.teams.away.shots + 1,
  );
  assert.equal(after.state.stats.away.goals, before.state.stats.away.goals + 1);
  for (const old of f.cue.evidence)
    assert.ok(
      refs.some(
        (now) => now.type === old.type && now.id === old.id && now.revision === old.revision,
      ),
      'Every old claim citation is still current',
    );
  const state = studioPreviewState(f.preview, {
    ...f.options,
    time: 331,
    receivedReferences: refs,
    evidenceKey: after.explanation.investigationKey,
  });
  assert.equal(state.status, 'superseded');
  assert.equal(state.reason, 'evidence-selection-changed');
  assert.deepEqual(state.claims, []);
});

test('unrelated future play preserves the anchored dependency key and visible cue before its age cutoff', () => {
  const f = fixture();
  for (const time of [331, 340, 347]) {
    const bundle = integratedMatch({
      kind: 'extended',
      seed: 17,
      time,
      anchorId: f.cue.anchorId,
      audience: 'analyst',
    });
    assert.equal(bundle.explanation.investigationKey, f.cue.evidenceKey);
    assert.equal(bundle.explanation.patterns.window.end, 328);
    const state = studioPreviewState(f.preview, {
      ...f.options,
      time,
      receivedReferences: currentBundleReferences(bundle),
      evidenceKey: bundle.explanation.investigationKey,
    });
    assert.equal(state.status, 'visible');
    assert.deepEqual(state.claims, f.cue.claims);
  }
});

test('a removed anchor with no current explanation still withdraws using its actual received tombstone', () => {
  const f = fixture(),
    feed = integratedFeed('extended', 17);
  const tombstone = {
    id: f.cue.anchorId,
    revision: 3,
    time: 328,
    arrivedAt: 331,
    operation: 'delete',
  };
  feed.events.push(tombstone);
  const bundle = integratedMatch(
    { kind: 'extended', seed: 17, time: 331, anchorId: f.cue.anchorId, audience: 'analyst' },
    feed,
  );
  assert.equal(bundle.explanation, null);
  assert.ok(bundle.state.updates.some((e) => e.id === tombstone.id && e.operation === 'delete'));
  const state = studioPreviewState(f.preview, {
    ...f.options,
    time: 331,
    receivedReferences: currentBundleReferences(bundle),
    evidenceKey: bundle.explanation?.investigationKey,
  });
  assert.equal(state.status, 'superseded');
  assert.equal(state.reason, 'dependency-withdrawn');
  assert.deepEqual(state.claims, []);
});
