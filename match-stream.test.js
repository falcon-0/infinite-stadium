import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedFeed, integratedMatch } from './match-stream.js';
import { buildRequest, validateDraft, generateDraft } from './ai.js';
import { recapChanges } from './narratives.js';
import { createInvestigationTools } from './investigation-tools.js';
import { broadcastFrame } from './broadcast.js';
import { applyStream, emptyStream } from './stream-state.js';
import { catchup } from './catchup.js';
import { validateFixture } from './fixture-validation.js';
import { storyFacts } from './story-facts.js';
import { renderFactStory } from './fact-renderer.js';
import { buildStoryCue } from './producer-cue.js';
import { createStudioPreview, studioPreviewState } from './studio-preview.js';
import { createServer } from './server.js';
import { once } from 'node:events';

const input = { kind: 'central', seed: 17 };
test('short fixture pass endpoints stay unknown until reception and then match its received sample', () => {
  for (const kind of ['central', 'wide']) {
    const before = integratedMatch({ kind, seed: 101, time: 2 });
    const pending = before.state.events.find((e) => e.type === 'pass');
    assert.equal(pending.result, null);
    assert.equal(pending.endX, null);
    assert.equal(pending.endY, null);
    const after = integratedMatch({ kind, seed: 101, time: 4 });
    const completed = after.state.events.find((e) => e.type === 'pass'),
      receive = after.state.events.find((e) => e.type === 'receive');
    const frame = after.state.frames.find((f) => f.time === receive.time);
    assert.equal(completed.result, true);
    assert.equal(completed.endX, (frame.ball.x / 105) * 100);
    assert.equal(completed.endY, (frame.ball.y / 68) * 100);
    assert.notEqual(completed.endX, completed.x);
  }
});
test('agent selection keys agree and include score revisions outside the moment window', () => {
  const request = { ...input, time: 10, anchorId: 'central-17-shot' };
  assert.equal(
    createInvestigationTools(request).key,
    integratedMatch(request).explanation.investigationKey,
  );
  const feed = integratedFeed('extended', 17);
  const goals = feed.events
    .filter((e) => e.type === 'shot' && e.result && e.revision === 1)
    .sort((a, b) => a.time - b.time);
  const previous = goals[0],
    anchor = goals[1];
  const observation = anchor.time + 2;
  feed.events.push({ ...previous, revision: 3, result: false, arrivedAt: observation + 1 });
  const settings = { kind: 'extended', seed: 17, anchorId: anchor.id };
  const before = integratedMatch({ ...settings, time: observation }, feed);
  const after = integratedMatch({ ...settings, time: observation + 1 }, feed);
  assert.equal(before.explanation.key, after.explanation.key);
  assert.notEqual(before.explanation.investigationKey, after.explanation.investigationKey);
  assert.equal(
    before.recap.score.home + before.recap.score.away,
    after.recap.score.home + after.recap.score.away + 1,
  );
});
test('one stream aligns event/player IDs and coordinates with received positional revisions', () => {
  for (const time of [0, 2, 4, 7, 8, 10, 12]) {
    const { state, explanation, recap } = integratedMatch({ ...input, time });
    assert.ok(state.events.every((e) => e.time <= time && e.arrivedAt <= time));
    assert.ok(state.frames.every((f) => f.time <= time && f.arrivedAt <= time));
    for (const event of state.events) {
      const frame = state.frames.find((f) => f.time === event.time),
        player = frame.players.find((p) => p.id === event.playerId);
      assert.ok(Math.abs((event.x / 100) * 105 - player.x) < 1e-9);
      assert.ok(Math.abs((event.y / 100) * 68 - player.y) < 1e-9);
    }
    if (explanation)
      assert.ok(
        explanation.evidence.every(
          (r) =>
            r.type === 'metric' ||
            [...state.events, ...state.frames].some(
              (e) => e.id === r.id && e.revision === r.revision,
            ),
        ),
      );
    assert.equal(recap.status, time >= 8 ? 'demo-segment-complete' : 'in-progress');
  }
});
test('pass accuracy waits for a known outcome and displacement waits for reception', () => {
  const before = integratedMatch({ ...input, time: 2 }),
    after = integratedMatch({ ...input, time: 4 });
  assert.deepEqual(before.state.passOutcomes, {
    attempts: 1,
    pending: 1,
    completed: 0,
    accuracy: null,
    denominator: 'passes with a known outcome',
  });
  assert.equal(after.state.passOutcomes.accuracy, 100);
  assert.equal(
    before.explanation.metrics.some((m) => m.kind === 'pass-displacement'),
    false,
  );
  const metric = after.explanation.metrics.find((m) => m.kind === 'pass-displacement');
  assert.ok(Math.abs(metric.value - 13.8) < 1e-9);
  assert.deepEqual(metric.interval, { start: 2, end: 4 });
  assert.ok(metric.inputs.some((r) => r.id === 'central-17-pass' && r.revision === 2));
  const shot = integratedMatch({ ...input, time: 10 });
  assert.ok(
    Math.abs(
      shot.explanation.metrics.find((m) => m.kind === 'player-displacement-rate').value - 1.7,
    ) < 1e-9,
  );
});
test('correction repairs spatial measurements, recap dependencies and stale metric citations', () => {
  const before = integratedMatch({ ...input, time: 8, audience: 'analyst' }),
    after = integratedMatch({ ...input, time: 10, audience: 'analyst' });
  assert.deepEqual(before.recap.score, after.recap.score);
  assert.notEqual(before.explanation.metrics[0].id, after.explanation.metrics[0].id);
  assert.notEqual(before.recap.entries[0].text, after.recap.entries[0].text);
  assert.equal(recapChanges(before.recap, after.recap).upserts.length, 1);
  assert.throws(() =>
    validateDraft(
      {
        claims: [
          {
            text: 'Old distance',
            evidence: [{ id: before.explanation.metrics[0].id, revision: 1 }],
          },
        ],
      },
      after.explanation,
    ),
  );
  assert.deepEqual(integratedMatch({ ...input, time: 8, audience: 'analyst' }), before);
});
test('missing exact samples suppress geometry and reordered duplicates cannot change output', () => {
  const stream = integratedFeed();
  assert.deepEqual(
    integratedMatch(
      { ...input, time: 10 },
      {
        events: [...stream.events, ...stream.events].reverse(),
        frames: [...stream.frames, ...stream.frames].reverse(),
      },
    ),
    integratedMatch({ ...input, time: 10 }),
  );
  stream.frames = stream.frames.filter((f) => f.time !== 8);
  const bundle = integratedMatch({ ...input, time: 8 }, stream);
  assert.equal(bundle.explanation.frame, null);
  assert.deepEqual(bundle.explanation.metrics, []);
  assert.match(bundle.explanation.text, /unavailable/);
});
test('integrated AI drafting uses a single received contract for moments and recaps', async () => {
  const request = {
    ...input,
    time: 8,
    source: 'integrated-match',
    mode: 'recap',
    audience: 'analyst',
  };
  const { explanation } = buildRequest(request);
  assert.equal(explanation.positions.length, 9);
  assert.equal(explanation.sequence.length, 3);
  assert.throws(() => buildRequest({ ...request, time: 0 }), /No match events/);
  assert.throws(
    () => buildRequest({ ...request, mode: 'moment', anchorId: 'central-17-shot', time: 7 }),
    /has arrived/,
  );
  const draft = await generateDraft(request, {
    config: { url: 'https://test.openai.azure.com', key: 'test', deployment: 'test' },
    fetcher: async (url, options) => {
      const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
      assert.match(payload.task, /recap/);
      assert.ok(payload.positions.every((f) => f.arrivedAt <= 8 && f.revision === 1));
      assert.ok(payload.metrics.length >= 2);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  claims: [
                    { text: 'A. Reed scored.', evidence: [{ id: 'central-17-shot', revision: 1 }] },
                  ],
                }),
              },
            },
          ],
        }),
      );
    },
  });
  assert.equal(draft.key, explanation.key);
  assert.equal(draft.evidenceSource, 'integrated-match');
});

test('withdrawal fixture has its own IDs and an actual minimal provider tombstone', () => {
  const base = integratedFeed('central', 17),
    withdrawal = integratedFeed('withdrawal', 17);
  const deletion = {
    id: 'withdrawal-17-shot',
    revision: 3,
    time: 8,
    arrivedAt: 11,
    operation: 'delete',
    reason: 'Synthetic provider withdraws the goal event.',
  };
  assert.deepEqual(withdrawal.events.at(-1), deletion);
  assert.equal(Object.hasOwn(deletion, 'team'), false);
  assert.equal(Object.hasOwn(deletion, 'type'), false);
  assert.ok(
    [...withdrawal.events, ...withdrawal.frames].every((r) => r.id.startsWith('withdrawal-17-')),
  );
  assert.deepEqual(
    withdrawal.frames.map((frame) => ({
      ...frame,
      id: frame.id.replace(/^withdrawal-/, 'central-'),
    })),
    base.frames,
  );
  assert.deepEqual(
    withdrawal.events
      .slice(0, -1)
      .map((event) => ({ ...event, id: event.id.replace(/^withdrawal-/, 'central-') })),
    base.events,
  );
  assert.equal(validateFixture(withdrawal).valid, true);
  assert.deepEqual(integratedFeed('central', 17), base);
  const before = integratedMatch({ kind: 'withdrawal', seed: 17, time: 8 }),
    corrected = integratedMatch({ kind: 'withdrawal', seed: 17, time: 10 }),
    after = integratedMatch({ kind: 'withdrawal', seed: 17, time: 11 });
  assert.equal(before.state.events.find((e) => e.type === 'shot').revision, 1);
  assert.equal(corrected.state.events.find((e) => e.type === 'shot').revision, 2);
  assert.deepEqual(before.recap.score, { home: 1, away: 0 });
  assert.deepEqual(corrected.recap.score, before.recap.score);
  assert.deepEqual(after.recap.score, { home: 0, away: 0 });
  assert.equal(after.state.stats.home.shots, 0);
  assert.deepEqual(
    after.state.events.map((e) => e.type),
    ['pass', 'receive'],
  );
  assert.equal(after.state.passOutcomes.accuracy, 100);
  assert.equal(after.state.frames.find((f) => f.time === 8).revision, 2);
  assert.deepEqual(after.recap.entries, []);
  assert.match(after.state.limit, /provider withdrawing/);
  assert.doesNotMatch(after.state.limit, /VAR|offside|referee/i);
  assert.deepEqual(integratedMatch({ kind: 'withdrawal', seed: 17, time: 8 }), before);
});

test('authored goal withdrawal repairs broadcast, recap, overlay and catch-up using exact received history', () => {
  const settings = { kind: 'withdrawal', seed: 17 },
    feed = integratedFeed(settings.kind, settings.seed),
    saved = structuredClone(feed);
  let state = emptyStream(),
    previous = null;
  const snapshots = [];
  for (const time of [8, 10, 11]) {
    const frame = broadcastFrame({ ...settings, time }, previous, feed);
    state = applyStream(state, frame.message);
    snapshots.push({ state, message: frame.message });
    previous = frame.bundle;
  }
  const shotId = 'withdrawal-17-shot',
    narrativeId = `narrative-${shotId}`,
    deletion = feed.events.at(-1);
  assert.equal(snapshots[0].state.score.home, 1);
  assert.equal(snapshots[1].state.score.home, 1);
  assert.equal(state.score.home, 0);
  assert.equal(state.stats.home.shots, 0);
  assert.deepEqual(snapshots[2].message.events.withdrawalRecords, [deletion]);
  assert.ok(snapshots[2].message.events.withdrawals.includes(shotId));
  assert.ok(snapshots[2].message.overlays.withdrawals.includes(narrativeId));
  assert.ok(snapshots[2].message.recap.withdrawals.includes(narrativeId));
  assert.equal(state.recap.size, 0);
  assert.equal(state.overlays.size, 0);
  for (const revision of [1, 2, 3])
    assert.equal(state.eventHistory.get(`${shotId}@${revision}`).revision, revision);
  assert.deepEqual(state.eventHistory.get(`${shotId}@3`), deletion);
  assert.equal(snapshots[1].state.eventHistory.has(`${shotId}@3`), false);
  assert.equal(snapshots[1].state.events.get(shotId).revision, 2);
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const result = catchup(state.eventHistory.values(), 11, 9, { language });
    assert.deepEqual(result.scoreAtSince, { home: 1, away: 0 });
    assert.deepEqual(result.scoreNow, { home: 0, away: 0 });
    assert.equal(result.counts.goals, 0);
    assert.deepEqual(result.highlights, []);
    assert.equal(result.updates[0].withdrawn, true);
    assert.deepEqual(result.updates[0].evidence, [{ type: 'event', id: shotId, revision: 3 }]);
  }
  const seek = applyStream(
    emptyStream(),
    broadcastFrame({ ...settings, time: 11 }, null, feed).message,
  );
  assert.deepEqual(seek.eventHistory.get(`${shotId}@3`), deletion);
  assert.equal(seek.events.has(shotId), false);
  assert.deepEqual(catchup(seek.eventHistory.values(), 11, 9).scoreAtSince, { home: 1, away: 0 });
  assert.deepEqual(feed, saved);
});

test('withdrawn authored anchor cannot create a new investigation and retracts an existing studio preview without a model call', () => {
  const request = {
    source: 'integrated-match',
    kind: 'withdrawal',
    seed: 17,
    time: 10,
    anchorId: 'withdrawal-17-shot',
    audience: 'newcomer',
    language: 'en',
  };
  const registry = createInvestigationTools(request),
    output = registry.execute('get_event_sequence', {}),
    catalog = storyFacts({ get_event_sequence: output }, registry.scope);
  const selectedFactIds = [catalog.facts[0].id],
    rendered = renderFactStory(catalog, selectedFactIds);
  // Construct a canonical contract fixture; no model is invoked by this test.
  const draft = {
    ...rendered,
    status: 'draft',
    key: registry.key,
    anchorId: request.anchorId,
    selectedFactIds,
    authorship: { selection: 'local-model', wording: 'application-fact-templates' },
  };
  const preferences = {
    kind: 'withdrawal',
    seed: 17,
    language: 'en',
    audience: 'newcomer',
    favoriteClub: null,
    favoritePlayer: null,
  };
  const cue = buildStoryCue(draft, integratedMatch(request).explanation, {
    preferencesMatch: true,
    observedAt: 10,
    eventTime: 8,
    receivedReferences: output.references,
    factCatalog: catalog,
  });
  const preview = createStudioPreview(cue, { preferences });
  assert.equal(
    studioPreviewState(preview, { time: 10, receivedReferences: output.references, preferences })
      .status,
    'visible',
  );
  const after = integratedMatch({ ...request, time: 11 }),
    deletion = integratedFeed('withdrawal', 17).events.at(-1);
  const currentReferences = [
    ...after.state.events.map((e) => ({ type: 'event', id: e.id, revision: e.revision })),
    { ...deletion, type: 'event' },
  ];
  const hidden = studioPreviewState(preview, {
    time: 11,
    receivedReferences: currentReferences,
    preferences,
  });
  assert.equal(hidden.status, 'superseded');
  assert.equal(hidden.reason, 'dependency-withdrawn');
  assert.deepEqual(hidden.claims, []);
  assert.throws(
    () => createInvestigationTools({ ...request, time: 11 }),
    (error) => error.status === 400,
  );
  assert.throws(
    () => buildRequest({ ...request, time: 11 }),
    (error) => error.status === 400,
  );
});

test('withdrawal fixture is available through actual loopback match and SSE routes without inference', async (t) => {
  let inferenceCalls = 0;
  const forbidden = () => {
    inferenceCalls++;
    throw new Error('This fixture check must not invoke inference.');
  };
  const server = createServer({ env: {}, fetcher: forbidden, localRunner: forbidden });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const time of [8, 11]) {
    const response = await fetch(`${base}/api/match?kind=withdrawal&seed=17&time=${time}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.state.metadata.kind, 'withdrawal');
    assert.equal(payload.recap.score.home, time === 8 ? 1 : 0);
    assert.equal(payload.state.stats.home.shots, time === 8 ? 1 : 0);
  }
  const response = await fetch(`${base}/api/stream?kind=withdrawal&seed=17&time=8&speed=12`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /event-stream/);
  const text = await response.text();
  assert.match(text, /event: complete/);
  const frames = [...text.matchAll(/^data: (.+)$/gm)]
    .map((match) => JSON.parse(match[1]))
    .filter((frame) => frame.schemaVersion === 1);
  assert.deepEqual(
    frames.map((frame) => frame.time),
    [8, 9, 10, 11, 12],
  );
  assert.ok(
    frames
      .filter((frame) => frame.time < 11)
      .every((frame) => frame.events.withdrawalRecords.length === 0),
  );
  assert.deepEqual(frames.find((frame) => frame.time === 11).events.withdrawalRecords, [
    integratedFeed('withdrawal', 17).events.at(-1),
  ]);
  const received = frames.reduce(applyStream, emptyStream());
  assert.equal(received.score.home, 0);
  assert.equal(received.events.size, 2);
  assert.equal(received.eventHistory.get('withdrawal-17-shot@3').operation, 'delete');
  assert.equal(inferenceCalls, 0);
});

test('legacy roster frames retain the same source identity labels as their events', () => {
  for (const kind of ['central', 'wide', 'withdrawal']) {
    const feed = integratedFeed(kind, 17);
    assert.ok(
      feed.frames.every((frame) =>
        frame.players.every((player) => typeof player.name === 'string' && player.name.length > 0),
      ),
    );
    for (const event of feed.events.filter((event) => event.operation !== 'delete')) {
      const player = feed.frames[0].players.find((player) => player.id === event.playerId);
      assert.equal(player.name, event.player);
    }
  }
});
