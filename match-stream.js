import { createHash } from 'node:crypto';
import { sceneFeed, observed } from './evidence.js';
import { snapshot, explainMoment, teams } from './engine.js';
import { recapFromState, selectNarratives, narrativePreferences } from './narratives.js';
import { extendedFeed } from './extended-fixture.js';
import { matchPatterns } from './pattern-insights.js';
import { comparisonFixture } from './comparison-fixture.js';
import { fixtureSettings, supportedFixtureKind, fixtureTeams } from './fixture-settings.js';

const names = { 'home-7': 'J. Cole', 'home-10': 'A. Reed' };
const name = (id) =>
  names[id] || `${id.startsWith('home') ? 'Northbridge' : 'Harbour'} #${id.split('-').at(-1)}`;
const reference = (record, type) => ({ id: record.id, revision: record.revision, type });
const unique = (refs) => [...new Map(refs.map((r) => [`${r.type}:${r.id}`, r])).values()];

// One server-owned synthetic fixture. All consumers use received revisions.
export function integratedFeed(kind = 'central', seed = 17) {
  if (['sustained', 'interrupted', 'quiet', 'counter', 'duel'].includes(kind))
    return comparisonFixture(seed, { scenario: kind });
  if (kind === 'extended') return extendedFeed(seed);
  if (kind === 'withdrawal') {
    const source = integratedFeed('central', seed),
      prefix = `central-${seed}-`,
      replacement = `withdrawal-${seed}-`;
    // Give the separate replay its own event/frame IDs and any linked IDs,
    // while preserving roster IDs and the authored positional geometry.
    const namespace = (value) =>
      typeof value === 'string' && value.startsWith(prefix)
        ? replacement + value.slice(prefix.length)
        : Array.isArray(value)
          ? value.map(namespace)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, namespace(item)]))
            : value;
    const feed = namespace(source);
    feed.events.push({
      id: `withdrawal-${seed}-shot`,
      revision: 3,
      time: 8,
      arrivedAt: 11,
      operation: 'delete',
      reason: 'Synthetic provider withdraws the goal event.',
    });
    return feed;
  }
  const stream = sceneFeed(kind, seed);
  const events = stream.events.map((event) => {
    const frame = stream.frames.find((f) => f.time === event.time && f.revision === 1);
    const player = frame.players.find((p) => p.id === event.playerId);
    return {
      ...event,
      team: player.team,
      player: name(player.id),
      x: (player.x / 105) * 100,
      y: (player.y / 68) * 100,
      endX: event.type === 'pass' ? null : (player.x / 105) * 100,
      endY: event.type === 'pass' ? null : (player.y / 68) * 100,
      result: event.type === 'shot' ? true : event.type === 'pass' ? null : false,
    };
  });
  const pass = events.find((e) => e.type === 'pass'),
    receive = events.find((e) => e.type === 'receive');
  const receptionFrame = stream.frames.find((f) => f.time === receive.time && f.revision === 1);
  events.push({
    ...pass,
    revision: 2,
    arrivedAt: receive.arrivedAt,
    result: true,
    endX: (receptionFrame.ball.x / 105) * 100,
    endY: (receptionFrame.ball.y / 68) * 100,
    reason: 'Provider confirms the pass was received.',
  });
  const shot = events.find((e) => e.type === 'shot'),
    corrected = stream.frames.find((f) => f.time === shot.time && f.revision === 2);
  const player = corrected.players.find((p) => p.id === shot.playerId);
  events.push({
    ...shot,
    revision: 2,
    arrivedAt: corrected.arrivedAt,
    x: (player.x / 105) * 100,
    y: (player.y / 68) * 100,
    endX: (player.x / 105) * 100,
    endY: (player.y / 68) * 100,
    reason: 'Shot location corrected with its positional sample.',
  });
  return { events, frames: stream.frames };
}

function metric(anchor, kind, value, unit, formula, inputs, details = {}) {
  // Content-addressed identity prevents stale citations when different input revisions
  // happen to share the same maximum revision number.
  const content = { anchorId: anchor.id, kind, value, unit, formula, inputs, ...details };
  const version = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32);
  return { id: `${anchor.id}-${kind}-${version}`, revision: 1, ...content };
}

export function matchState({ kind = 'central', seed = 17, time = 0 } = {}, messages) {
  const extended = kind === 'extended',
    { horizon, duration } = fixtureSettings(kind);
  if (
    !supportedFixtureKind(kind) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 100000 ||
    !Number.isFinite(time) ||
    time < 0 ||
    time > horizon
  )
    throw new RangeError(
      'Choose a supported fixture, integer seed and time within its observation horizon.',
    );
  const stream = messages || integratedFeed(kind, seed);
  const state = snapshot(time, stream.events),
    frames = observed(stream.frames, time);
  const metadata = {
    id: `spatial-match-${kind}-${seed}`,
    kind,
    seed,
    teams: fixtureTeams(kind, seed),
    pitch: { length: 105, width: 68, unit: 'metres' },
    segmentDuration: duration,
    observationHorizon: horizon,
    synthetic: true,
  };
  const passes = state.events.filter((e) => e.type === 'pass'),
    known = passes.filter((e) => typeof e.result === 'boolean');
  return {
    ...state,
    source: 'integrated-match',
    metadata,
    frames,
    passOutcomes: {
      attempts: passes.length,
      pending: passes.length - known.length,
      completed: known.filter((e) => e.result).length,
      accuracy: known.length ? (known.filter((e) => e.result).length / known.length) * 100 : null,
      denominator: 'passes with a known outcome',
    },
    limit: `A ${extended ? 'six-minute scripted segment with explicit reset intervals' : horizon === 120 ? 'two-minute continuously sampled authored passage' : kind === 'withdrawal' ? 'scripted eight-second sequence with a synthetic provider withdrawing the goal event at received time 11 seconds' : 'scripted eight-second sequence'}. This is synthetic data, not a validated football simulator or full match. Positions are sampled in metres; event coordinates are normalized. Geometry and displacement rates do not establish intent, tactical pressure, causation or maximum speed.`,
  };
}

export function matchExplanation(state, anchorId) {
  const explanation = explainMoment(state, anchorId);
  if (!explanation) return null;
  const anchor = state.events.find((e) => e.id === anchorId);
  const positions = state.frames.filter((f) => f.time >= anchor.time - 8 && f.time <= anchor.time);
  const frame = positions.find((f) => f.time === anchor.time);
  const player = frame?.players.find((p) => p.id === anchor.playerId);
  const metrics = [];
  if (player) {
    const opponent = frame.players
      .filter((p) => p.team !== player.team)
      .map((p) => ({ ...p, distance: Math.hypot(p.x - player.x, p.y - player.y) }))
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
    if (opponent)
      metrics.push(
        metric(
          anchor,
          'nearest-opponent',
          opponent.distance,
          'metres',
          'euclidean-distance-v1',
          [reference(anchor, 'event'), reference(frame, 'frame')],
          { playerId: player.id, opponentId: opponent.id },
        ),
      );
    const previous = positions.filter((f) => f.time < anchor.time).at(-1),
      before = previous?.players.find((p) => p.id === player.id);
    if (before)
      metrics.push(
        metric(
          anchor,
          'player-displacement-rate',
          Math.hypot(player.x - before.x, player.y - before.y) / (frame.time - previous.time),
          'metres/second',
          'sample-displacement-over-time-v1',
          [reference(anchor, 'event'), reference(previous, 'frame'), reference(frame, 'frame')],
          { playerId: player.id, interval: { start: previous.time, end: frame.time } },
        ),
      );
  }
  if (anchor.type === 'receive') {
    const pass = explanation.sequence
      .filter((e) => e.type === 'pass' && e.receiverId === anchor.playerId && e.time < anchor.time)
      .at(-1);
    const start = pass && positions.find((f) => f.time === pass.time);
    if (start && frame)
      metrics.push(
        metric(
          anchor,
          'pass-displacement',
          Math.hypot(frame.ball.x - start.ball.x, frame.ball.y - start.ball.y),
          'metres',
          'ball-endpoint-displacement-v1',
          [
            reference(pass, 'event'),
            reference(anchor, 'event'),
            reference(start, 'frame'),
            reference(frame, 'frame'),
          ],
          { passId: pass.id, interval: { start: pass.time, end: anchor.time } },
        ),
      );
  }
  if (anchor.type === 'flight') {
    const shot = explanation.sequence.find((e) => e.id === anchor.shotId),
      start = shot && positions.find((f) => f.time === shot.time);
    if (start && frame)
      metrics.push(
        metric(
          anchor,
          'shot-ball-displacement-rate',
          Math.hypot(frame.ball.x - start.ball.x, frame.ball.y - start.ball.y) /
            (frame.time - start.time),
          'metres/second',
          'shot-sample-displacement-over-time-v1',
          [
            reference(shot, 'event'),
            reference(anchor, 'event'),
            reference(start, 'frame'),
            reference(frame, 'frame'),
          ],
          { shotId: shot.id, interval: { start: shot.time, end: anchor.time } },
        ),
      );
  }
  const evidence = unique([
    ...explanation.evidence.map((r) => ({ ...r, type: 'event' })),
    ...positions.map((f) => reference(f, 'frame')),
    ...metrics.map((m) => reference(m, 'metric')),
  ]);
  const nearest = metrics.find((m) => m.kind === 'nearest-opponent');
  const key = evidence.map((r) => `${r.type}:${r.id}@${r.revision}`).join('|');
  const goals = state.events.filter((e) => e.type === 'shot' && e.result && e.time <= anchor.time);
  const patterns = matchPatterns(state.events, state.time, { anchorTime: anchor.time });
  const patternKey = patterns.evidence.map((r) => `${r.id}@${r.revision}`).join('|');
  const comparisonInputs = state.events.filter(
    (e) => e.time > anchor.time - 60 && e.time <= anchor.time,
  );
  const comparisonKey = createHash('sha256').update(JSON.stringify(comparisonInputs)).digest('hex');
  return {
    ...explanation,
    source: 'integrated-match',
    kind: state.metadata.kind,
    seed: state.metadata.seed,
    positions,
    frame: frame || null,
    metrics,
    evidence,
    key,
    patterns,
    investigationKey:
      key +
      '|score:' +
      goals.map((e) => `${e.id}@${e.revision}`).join('|') +
      '|patterns:' +
      patternKey +
      '|comparison:' +
      comparisonKey,
    text:
      explanation.text +
      (nearest
        ? ` The nearest sampled opponent is ${nearest.value.toFixed(1)} m from ${anchor.player} at the recorded moment.`
        : ' Exact positional evidence is unavailable.'),
    limit: state.limit,
    updated: explanation.updated || positions.some((f) => f.revision > 1),
  };
}

function enrichRecordedStory(state, entry, preferences) {
  const context = matchExplanation(state, entry.anchorId),
    evidence = unique([
      ...entry.evidence.map((r) => ({ ...r, type: 'event' })),
      ...context.evidence,
    ]);
  const nearest = context.metrics.find((m) => m.kind === 'nearest-opponent');
  return {
    entry: {
      ...entry,
      evidence,
      metrics: context.metrics,
      key: entry.key + '|' + context.key,
      text:
        entry.text +
        (preferences.audience === 'analyst' && nearest
          ? ` ${preferences.language === 'es' ? 'Rival más cercano en la muestra' : preferences.language === 'fr' ? 'Adversaire le plus proche dans l’échantillon' : preferences.language === 'pt' ? 'Adversário mais próximo na amostra' : 'Nearest sampled opponent'}: ${nearest.value.toFixed(1)} m.`
          : ''),
      timing: {
        ...entry.timing,
        availableAt: Math.max(
          entry.timing.availableAt,
          ...context.positions.map((f) => f.arrivedAt),
        ),
      },
    },
    positions: context.positions,
  };
}

export function recordedStoryEntry(state, anchorId, input = {}) {
  const preferences = narrativePreferences(input),
    entry = selectNarratives(state, preferences, { anchorId })[0];
  return entry ? enrichRecordedStory(state, entry, preferences).entry : null;
}

export function integratedMatch(input = {}, messages) {
  const state = matchState(input, messages);
  const explanation = matchExplanation(state, input.anchorId || state.events.at(-1)?.id);
  const recap = recapFromState(
    state,
    {
      audience: input.audience ?? 'newcomer',
      favoriteClub: input.favoriteClub ?? null,
      favoritePlayer: input.favoritePlayer ?? null,
      limit: input.limit ?? 5,
      language: input.language ?? 'en',
    },
    state.metadata,
  );
  const recapPositions = new Map();
  recap.entries = recap.entries.map((entry) => {
    const enriched = enrichRecordedStory(state, entry, recap.preferences);
    enriched.positions
      .filter(
        (f) =>
          state.metadata.kind !== 'extended' ||
          enriched.entry.metrics.some((m) => m.inputs.some((r) => r.id === f.id)),
      )
      .forEach((f) => recapPositions.set(f.id, f));
    return enriched.entry;
  });
  recap.positions = [...recapPositions.values()].sort((a, b) => a.time - b.time);
  recap.evidence = unique([
    ...recap.evidence.map((r) => ({ ...r, type: 'event' })),
    ...recap.entries.flatMap((e) => e.evidence),
  ]);
  recap.key += '|' + recap.evidence.map((r) => `${r.type}:${r.id}@${r.revision}`).join('|');
  recap.limitation = state.limit;
  recap.overlays = recap.entries
    .filter((e) => e.timing.availableAt <= state.time && e.timing.expiresAt > state.time)
    .map((e) => ({
      schemaVersion: 1,
      id: e.id,
      key: e.key,
      anchorId: e.anchorId,
      title: e.title,
      text: e.text,
      evidence: e.evidence,
      timing: e.timing,
      audience: recap.preferences.audience,
      review: 'Deterministic template; not AI-generated.',
    }));
  state.frames = state.frames.filter((f) => f.time >= state.time - 30);
  return { state, explanation, recap };
}
