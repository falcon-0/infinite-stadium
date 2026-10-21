// Interpret only a roster-backed identity choice, never football facts or free prose.
const words = (value) =>
  String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function resolvePlayerClarification(input, roster, teams) {
  const pending = input.clarification;
  if (!pending || pending.time > input.time) return null;
  const reply = words(input.question),
    old = words(pending.question),
    choices = [];
  if (!reply.length || reply.length > 15) return null;
  for (const player of roster) {
    const name = words(player.name),
      surname = name.at(-1);
    if (
      !surname ||
      !old.includes(surname) ||
      roster.filter((p) => words(p.name).at(-1) === surname).length < 2
    )
      continue;
    const start = reply.findIndex((_word, i) => name.every((word, j) => reply[i + j] === word));
    if (start < 0) continue;
    const remainder = reply.filter((_word, i) => i < start || i >= start + name.length);
    const allowed = new Set([
      ...words(teams[player.team]),
      'the',
      'one',
      'from',
      'of',
      'celui',
      'de',
      'du',
      'el',
      'la',
      'do',
      'da',
      'o',
      'a',
    ]);
    if (!remainder.every((word) => allowed.has(word))) continue;
    // A full name in the original request was already unambiguous.
    if (old.some((_word, i) => name.every((word, j) => old[i + j] === word))) continue;
    const originalSurname = player.name.trim().split(/\s+/).at(-1);
    const resolved = pending.question.replace(
      new RegExp('\\b' + escape(originalSurname) + '\\b', 'giu'),
      player.name,
    );
    if (resolved !== pending.question && resolved.length <= 400)
      choices.push({
        question: resolved,
        playerId: player.id,
        playerName: player.name,
        originalQuestion: pending.question,
        clarifiedAt: input.time,
      });
  }
  return choices.length === 1 ? choices[0] : null;
}
