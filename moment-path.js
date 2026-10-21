const validId = (v) => typeof v === 'string' && v.length > 0;
const received = (r, time) =>
  r &&
  validId(r.id) &&
  Number.isSafeInteger(r.revision) &&
  r.revision > 0 &&
  Number.isFinite(r.time) &&
  r.time >= 0 &&
  Number.isFinite(r.arrivedAt) &&
  r.arrivedAt >= r.time &&
  r.time <= time &&
  r.arrivedAt <= time &&
  [undefined, 'upsert', 'delete'].includes(r.operation);
const canonical = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
function records(input, time) {
  if (!input || typeof input[Symbol.iterator] !== 'function') return null;
  const list = input instanceof Map ? [...input.values()] : [...input],
    map = new Map();
  if (list.length > 10000) return null;
  for (const record of list) {
    if (!received(record, time)) return null;
    if (map.has(record.id) && canonical(map.get(record.id)) !== canonical(record)) return null;
    map.set(record.id, record);
  }
  return map;
}
const ref = (r, type) => ({ type, id: r.id, revision: r.revision });
const same = (a, b) => a && b && canonical(a) === canonical(b);
const point = (f) => ({ x: f.ball.x, y: f.ball.y, time: f.time });
const validFrame = (f) =>
  f.operation !== 'delete' &&
  [undefined, 'metres'].includes(f.unit) &&
  [undefined, 'metres'].includes(f.units) &&
  f.phase !== 'reset' &&
  f.ball &&
  Number.isFinite(f.ball.x) &&
  Number.isFinite(f.ball.y) &&
  f.ball.x >= 0 &&
  f.ball.x <= 105 &&
  f.ball.y >= 0 &&
  f.ball.y <= 68;

/** Straight links between exact received ball samples, never trajectories.
 * Both inventories must be the latest materialized state, including tombstones.
 */
export function recordedMomentPath(explanation, { observedAt, currentEvents, currentFrames } = {}) {
  try {
    if (
      !explanation ||
      explanation.source !== 'integrated-match' ||
      !Number.isFinite(observedAt) ||
      observedAt < 0 ||
      !Array.isArray(explanation.sequence) ||
      !Array.isArray(explanation.positions)
    )
      return [];
    const events = records(currentEvents, observedAt),
      frames = records(currentFrames, observedAt);
    if (!events || !frames) return [];
    const captured = explanation.sequence.find((e) => e.id === explanation.anchorId),
      anchor = events.get(explanation.anchorId);
    if (
      !same(captured, anchor) ||
      anchor.operation === 'delete' ||
      !['home', 'away'].includes(anchor.team) ||
      !validId(anchor.playerId)
    )
      return [];
    const frameAt = (time) => {
      const candidates = [...frames.values()].filter((f) => f.time === time);
      if (candidates.length !== 1 || !validFrame(candidates[0])) return null;
      const frame = candidates[0],
        old = explanation.positions.find((f) => f.id === frame.id);
      if (old && !same(old, frame)) return null;
      return frame;
    };
    const selectedFrame = frameAt(anchor.time);
    if (!selectedFrame || !explanation.positions.some((f) => same(f, selectedFrame))) return [];
    const interrupted = (start, end, club) =>
      [...events.values()].some(
        (e) =>
          e.operation !== 'delete' &&
          e.time >= start &&
          e.time <= end &&
          (['possession-change', 'tackle', 'recovery'].includes(e.type) ||
            (e.team !== club && ['pass', 'receive', 'shot'].includes(e.type))),
      ) ||
      [...frames.values()].some(
        (f) =>
          f.time >= start && f.time <= end && (f.phase === 'reset' || f.operation === 'delete'),
      );
    const segment = (kind, a, b, start, end, description) => {
      if (!start || !end || end.time <= start.time || interrupted(start.time, end.time, a.team))
        return null;
      // Frames from unrelated fixtures cannot establish a linked sample interval.
      const namespace = (id) => id.replace(/-frame-[0-9]+$/, '');
      if (namespace(start.id) === start.id || namespace(start.id) !== namespace(end.id))
        return null;
      return {
        kind,
        start: point(start),
        end: point(end),
        evidence: [ref(a, 'event'), ref(b, 'event'), ref(start, 'frame'), ref(end, 'frame')],
        description,
      };
    };
    const active = [...events.values()].filter((e) => e.operation !== 'delete');
    const shot =
      anchor.type === 'shot' ? anchor : anchor.type === 'flight' ? events.get(anchor.shotId) : null;
    const receptions = shot
      ? active
          .filter(
            (e) =>
              e.type === 'receive' &&
              e.team === shot.team &&
              e.playerId === shot.playerId &&
              e.time < shot.time,
          )
          .sort((a, b) => b.time - a.time)
      : [];
    const target =
      anchor.type === 'receive'
        ? anchor
        : receptions[0] && receptions.filter((e) => e.time === receptions[0].time).length === 1
          ? receptions[0]
          : null;
    const result = [];
    if (
      target &&
      explanation.sequence.some((e) => same(e, target)) &&
      !interrupted(target.time, shot?.time ?? target.time, target.team)
    ) {
      const passes = active
        .filter(
          (e) =>
            e.type === 'pass' &&
            e.team === target.team &&
            e.receiverId === target.playerId &&
            e.time < target.time,
        )
        .sort((a, b) => b.time - a.time);
      const pass = passes[0];
      if (
        pass?.result === true &&
        passes.filter((e) => e.time === pass.time).length === 1 &&
        explanation.sequence.some((e) => same(e, pass)) &&
        !active.some(
          (e) =>
            e.type === 'pass' && e.id !== pass.id && e.time >= pass.time && e.time <= target.time,
        )
      ) {
        const line = segment(
          'pass-endpoint-link',
          pass,
          target,
          frameAt(pass.time),
          frameAt(target.time),
          `Recorded completed-pass ball sample endpoints (${pass.time}–${target.time}s); straight link, not the ball trajectory.`,
        );
        if (line) result.push(line);
      }
    }
    if (
      shot &&
      shot.type === 'shot' &&
      shot.operation !== 'delete' &&
      explanation.sequence.some((e) => same(e, shot))
    ) {
      const flights = active
        .filter(
          (e) =>
            e.type === 'flight' &&
            e.shotId === shot.id &&
            e.team === shot.team &&
            e.playerId === shot.playerId &&
            e.time > shot.time,
        )
        .sort((a, b) => a.time - b.time);
      const flight = anchor.type === 'flight' ? anchor : flights[0];
      if (
        flight &&
        flight.shotId === shot.id &&
        flights.filter((e) => e.time === flight.time).length === 1 &&
        !active.some(
          (e) =>
            e.id !== shot.id &&
            e.id !== flight.id &&
            e.time > shot.time &&
            e.time <= flight.time &&
            ['shot', 'pass', 'receive', 'recovery', 'flight'].includes(e.type),
        )
      ) {
        const line = segment(
          'shot-endpoint-link',
          shot,
          flight,
          frameAt(shot.time),
          frameAt(flight.time),
          `Shot-linked ball sample endpoints (${shot.time}–${flight.time}s); straight link, not the ball trajectory.`,
        );
        if (line) result.push(line);
      }
    }
    return result.slice(0, 2);
  } catch {
    return [];
  }
}
