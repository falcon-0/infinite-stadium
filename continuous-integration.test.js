import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedMatch } from './match-stream.js';
import { comparisonFixture } from './comparison-fixture.js';
import { broadcastFrame } from './broadcast.js';
import { emptyStream, applyStream } from './stream-state.js';
import { createRecapFacts } from './recap-facts.js';
import { exportSyntheticDataset } from './dataset-export.js';
import {
  emptyProducerReview,
  addProducerStory,
  decideProducerStory,
  exportProducerRundown,
  loadProducerReview,
  saveProducerReview,
} from './producer-review.js';

test('continuous passages work across replay, recap facts, dataset and local human review', () => {
  for (const kind of ['sustained', 'interrupted', 'quiet']) {
    const preferences = {
      kind,
      seed: 17,
      audience: 'newcomer',
      language: 'en',
      favoriteClub: null,
      favoritePlayer: null,
    };
    const bundle = integratedMatch({ ...preferences, time: 120 });
    assert.equal(bundle.state.metadata.observationHorizon, 120);
    assert.equal(bundle.state.metadata.segmentDuration, 120);
    const state = applyStream(emptyStream(), broadcastFrame({ ...preferences, time: 120 }).message);
    assert.equal(state.positionHistory.size, 121);
    assert.ok(state.positions.size <= 31);
    const dataset = exportSyntheticDataset({ kind, seed: 17, observedAt: 120 });
    assert.equal(dataset.resets.enabled, false);
    assert.ok(dataset.received.phaseLabels.every((p) => !p.scriptedReset));
    assert.ok(
      createRecapFacts({ source: 'integrated-match', ...preferences, time: 120 }).catalog.facts
        .length,
    );
    if (!state.recap.size) continue;
    const store = emptyProducerReview(),
      entry = [...state.recap.values()][0],
      item = addProducerStory(store, entry, state, preferences);
    decideProducerStory(
      store,
      item.id,
      'approved',
      'Reviewed synthetic passage.',
      state,
      preferences,
    );
    assert.equal(exportProducerRundown(store, state, preferences).document.segments.length, 1);
    let raw;
    const storage = {
      setItem: (_key, value) => {
        raw = value;
      },
      getItem: () => raw,
    };
    assert.equal(saveProducerReview(store, storage), true);
    assert.equal(loadProducerReview(storage).store.items.length, 1);
  }
});

test('pruned tracking still has immutable received bodies and rejects old revision conflicts', () => {
  const initial = broadcastFrame({ kind: 'extended', seed: 17, time: 122 }).message;
  const state = applyStream(emptyStream(), initial),
    old = [...state.positionHistory.values()].find((f) => f.time === 28);
  assert.ok(old);
  assert.equal(state.positions.has(old.id), false);
  const conflict = {
    ...initial,
    time: 123,
    events: { upserts: [], withdrawals: [] },
    positions: { upserts: [{ ...old, ball: { ...old.ball, x: old.ball.x + 1 } }] },
  };
  assert.throws(() => applyStream(state, conflict), /position revision/);
  assert.notEqual(state.positionHistory.get(`${old.id}@${old.revision}`).ball.x, old.ball.x + 1);
});

test('investigation identity retains unchanged windows but invalidates revised older reception evidence', () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 119,
    anchorId: 'comparison-sustained-17-shot-116',
  };
  const feed = comparisonFixture(17),
    original = integratedMatch(input, feed);
  const unchanged = integratedMatch({ ...input, time: 120 }, feed);
  assert.equal(original.explanation.investigationKey, unchanged.explanation.investigationKey);
  const received = feed.events.find((event) => event.id === 'comparison-sustained-17-receive-72');
  assert.ok(received);
  const revised = {
    ...feed,
    events: [
      ...feed.events,
      {
        ...received,
        revision: received.revision + 1,
        arrivedAt: 120,
        reason: 'Received correction to older reception.',
      },
    ],
  };
  const corrected = integratedMatch({ ...input, time: 120 }, revised);
  assert.equal(
    corrected.explanation.key,
    unchanged.explanation.key,
    'Immediate selected scene is unchanged',
  );
  assert.notEqual(
    corrected.explanation.investigationKey,
    unchanged.explanation.investigationKey,
    'Earlier comparative support invalidates a saved investigation',
  );
});
