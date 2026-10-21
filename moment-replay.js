import { pitchMotion } from './pitch-motion.js';

const received = (r, time) =>
  r &&
  typeof r.id === 'string' &&
  Number.isSafeInteger(r.revision) &&
  r.revision > 0 &&
  Number.isFinite(r.time) &&
  Number.isFinite(r.arrivedAt) &&
  r.time >= 0 &&
  r.arrivedAt >= r.time &&
  r.time <= time &&
  r.arrivedAt <= time;
const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const validFrame = (f) =>
  f.operation !== 'delete' &&
  f.phase !== 'reset' &&
  finitePoint(f.ball) &&
  Array.isArray(f.players) &&
  f.players.length > 0 &&
  f.players.every((p) => typeof p.id === 'string' && finitePoint(p));
const ref = (row, type) => ({ type, id: row.id, revision: row.revision });
const fingerprint = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
function current(records, time) {
  const rows = new Map();
  for (const row of records || []) {
    if (!received(row, time)) continue;
    const old = rows.get(row.id);
    if (old && row.revision === old.revision && fingerprint(old) !== fingerprint(row)) return null;
    if (!old || row.revision > old.revision) rows.set(row.id, row);
  }
  return rows;
}

/** A small received-only clip. This is display material, never metric evidence.
 * A gap, reset, withdrawal or stale selected anchor makes the clip unavailable.
 */
export function buildMomentReplay(explanation, { events, frames, observedAt } = {}) {
  const unavailable = (reason) => ({ status: 'unavailable', reason, frames: [] });
  if (!Number.isFinite(observedAt) || observedAt < 0 || !explanation?.anchorId)
    return unavailable('missing-selection');
  const eventInventory = current(events, observedAt),
    frameInventory = current(frames, observedAt);
  if (!eventInventory || !frameInventory) return unavailable('conflicting-revisions');
  const anchor = eventInventory.get(explanation.anchorId);
  const selected = explanation.sequence?.find((e) => e.id === explanation.anchorId);
  if (
    !anchor ||
    anchor.operation === 'delete' ||
    !selected ||
    fingerprint(anchor) !== fingerprint(selected)
  )
    return unavailable('selection-changed');
  const inventory = [...frameInventory.values()];
  const captured = explanation.frame;
  if (
    !captured ||
    captured.time !== anchor.time ||
    !inventory.some((f) => fingerprint(f) === fingerprint(captured) && validFrame(f))
  )
    return unavailable('selected-positions-unavailable');
  const start = Math.max(0, anchor.time - 12),
    end = Math.min(observedAt, anchor.time + 2);
  const samples = inventory
    .filter((f) => f.time >= start && f.time <= end)
    .sort((a, b) => a.time - b.time);
  if (samples.length < 2 || !samples.every(validFrame)) return unavailable('incomplete-positions');
  const namespace = (id) => id.replace(/-frame-[0-9]+$/, '');
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1],
      sample = samples[i];
    if (
      sample.time - previous.time !== 1 ||
      namespace(sample.id) !== namespace(previous.id) ||
      sample.players.length !== previous.players.length ||
      sample.players.some((p) => !previous.players.some((q) => p.id === q.id && p.team === q.team))
    )
      return unavailable('discontinuous-positions');
  }
  if (samples[0].time >= anchor.time || !samples.some((f) => f.time === anchor.time))
    return unavailable('no-buildup');
  return {
    status: 'available',
    anchorId: anchor.id,
    anchorTime: anchor.time,
    start: samples[0].time,
    end: samples.at(-1).time,
    frames: samples,
    evidence: [ref(anchor, 'event'), ...samples.map((f) => ref(f, 'frame'))],
    displayOnly: true,
  };
}

export class MomentReplay {
  constructor(clip, wall) {
    if (clip?.status !== 'available') throw new TypeError('A received clip is required.');
    this.clip = clip;
    this.time = clip.start;
    this.wall = wall;
    this.done = false;
  }
  step(wall) {
    const delta = Math.max(0, Math.min(0.1, (wall - this.wall) / 1000));
    this.wall = wall;
    this.time = Math.min(this.clip.end, this.time + delta);
    this.done = this.time >= this.clip.end;
    const before =
      this.clip.frames.filter((f) => f.time <= this.time).at(-1) || this.clip.frames[0];
    const after = this.clip.frames.find((f) => f.time >= this.time) || this.clip.frames.at(-1);
    const frame = pitchMotion(
      before,
      after,
      before.time === after.time ? 1 : (this.time - before.time) / (after.time - before.time),
    );
    return { ...frame, displayTime: this.time, displayOnly: true };
  }
}
