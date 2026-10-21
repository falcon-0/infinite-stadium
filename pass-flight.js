// Authored synthetic flight, not a measurement or a physical ball model.
export function passFlight(
  from,
  to,
  progress,
  { passType = 'short', technique = 'standard' } = {},
) {
  const t = Math.max(0, Math.min(1, progress)),
    arc = Math.sin(Math.PI * t);
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  const bend = technique === 'trivela' ? 4 : passType === 'cross' ? 2 : 0;
  const height =
    passType === 'long' ? 4 : passType === 'cross' ? 3 : technique === 'trivela' ? 1 : 0;
  return {
    x: from.x + dx * t + (length ? (-dy / length) * bend * arc : 0),
    y: from.y + dy * t + (length ? (dx / length) * bend * arc : 0),
    height: height * arc,
  };
}
