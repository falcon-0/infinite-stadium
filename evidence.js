import { createScenario } from './scenarios.js';

// This module stays on the server. The browser receives only observed evidence.
export function sceneFeed(kind = 'central', seed = 17) {
  const world = createScenario(kind, seed);
  const frames = world.frames.map((f) => structuredClone(f));
  const final = frames.at(-1);
  const runner = final.players.find((p) => p.id === 'home-10');
  // Deliberately inaccurate provider position; the canonical position is corrected later.
  runner.x -= 3;
  final.ball.x -= 3;
  return {
    events: world.events.map((e) => ({ ...e, operation: 'upsert' })),
    frames: [
      ...frames.map((f) => ({ ...f, operation: 'upsert' })),
      {
        ...structuredClone(world.frames.at(-1)),
        revision: 2,
        arrivedAt: 10,
        operation: 'upsert',
        reason: 'Tracking provider corrects home #10’s shot position by three metres.',
      },
    ],
  };
}

export function observed(records, time) {
  const active = new Map();
  for (const record of records) {
    if (record.time > time || record.arrivedAt > time) continue;
    const previous = active.get(record.id);
    if (!previous || record.revision > previous.revision) active.set(record.id, record);
  }
  return [...active.values()]
    .filter((r) => r.operation !== 'delete')
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function sceneState({ kind = 'central', seed = 17, time = 0 }, messages) {
  if (
    !['central', 'wide'].includes(kind) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 100000 ||
    !Number.isFinite(time) ||
    time < 0 ||
    time > 12
  )
    throw new RangeError('Choose a valid scene, seed and time between 0 and 12.');
  const stream = messages || sceneFeed(kind, seed);
  const frames = observed(stream.frames, time),
    events = observed(stream.events, time);
  return {
    source: 'scene',
    kind,
    seed,
    time,
    events,
    frames,
    frame: frames.at(-1) || null,
    updates: frames.filter((f) => f.revision > 1),
    limit:
      'Scripted synthetic positions in metres on a 105 × 68 m pitch. Only received samples are available. Geometry does not establish intent, pressure, shot quality or a tactical cause.',
  };
}

export function explainScene(state, anchorId) {
  const anchor = state.events.find((e) => e.id === anchorId);
  if (!anchor) return null;
  const sequence = state.events.filter((e) => e.time >= anchor.time - 8 && e.time <= anchor.time);
  const positions = state.frames.filter((f) => f.time >= anchor.time - 8 && f.time <= anchor.time);
  // Do not silently treat an earlier sample as the position at the anchor time.
  const frame = positions.find((f) => f.time === anchor.time);
  const runner = frame?.players.find((p) => p.id === anchor.playerId);
  const opponents = runner
    ? frame.players
        .filter((p) => p.team !== runner.team)
        .map((p) => ({
          id: p.id,
          number: p.number,
          value: Math.hypot(p.x - runner.x, p.y - runner.y),
        }))
        .sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))
    : [];
  const nearest = opponents[0];
  const metrics = nearest
    ? [
        {
          id: `${frame.id}-nearest-${runner.id}`,
          revision: frame.revision,
          formula: 'euclidean-distance-v1',
          unit: 'metres',
          value: nearest.value,
          playerId: runner.id,
          opponentId: nearest.id,
          inputs: [{ id: frame.id, revision: frame.revision }],
        },
      ]
    : [];
  const evidence = [
    ...sequence.map((e) => ({ id: e.id, revision: e.revision, type: 'event' })),
    ...positions.map((f) => ({ id: f.id, revision: f.revision, type: 'frame' })),
    ...metrics.map((m) => ({ id: m.id, revision: m.revision, type: 'metric' })),
  ];
  const key = [anchorId, ...evidence.map((e) => `${e.type}:${e.id}@${e.revision}`)].join('|');
  const text = nearest
    ? `At the recorded ${anchor.type} at ${anchor.time}s, home #${runner.number} is at (${runner.x.toFixed(1)}, ${runner.y.toFixed(1)}) m. Away #${nearest.number} is the nearest opponent, ${nearest.value.toFixed(1)} m away.`
    : `The ${anchor.type} at ${anchor.time}s is recorded, but its exact player-position sample is unavailable. A nearest-opponent distance cannot be established.`;
  return {
    source: 'scene',
    kind: state.kind,
    seed: state.seed,
    anchorId,
    key,
    evidence,
    sequence,
    positions,
    metrics,
    frame: frame || null,
    title: `Inspect the ${anchor.type}`,
    text,
    limit: state.limit,
    updated: positions.some((f) => f.revision > 1),
    recap: `${anchor.time}s: home ${anchor.type} by #${anchor.playerId.split('-').at(-1)}. ${nearest ? `Nearest opponent: ${nearest.value.toFixed(1)} m at the recorded moment.` : 'Exact positional sample unavailable.'}`,
  };
}

export function sceneInvestigation(input, messages) {
  const state = sceneState(input, messages),
    anchorId = input.anchorId || state.events.at(-1)?.id;
  return { state, explanation: explainScene(state, anchorId) };
}
