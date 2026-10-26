// A bounded planning obligation, never an answer or source-proof substitute.
// Relative clock windows and hypothetical actions are deliberately excluded.
export function explicitEventRelations(question) {
  if (typeof question !== 'string') return [];
  const text = question.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const boundary =
    /\b(before|after|antes\s+(?:de|del|do|da)|despues\s+(?:de|del)|avant|apres|depois\s+(?:de|do|da))\b(?=([^?;,.!]{0,90}))/g;
  const event =
    /\b(goal|goals|scored|scoring|shot|shots|attempt|pass|passes|recovery|interception|gol|goles|anoto|marco|tiro|disparo|pase|recuperacion|but|buts|tir|passe|recuperation|golo|remate|chute|recuperacao)\b/;
  const hypothetical =
    /\b(could|would|should|can|might|podria|deberia|pueda|pourrait|devrait|poderia|deveria)\b/;
  const demands = [];
  for (const match of text.matchAll(boundary)) {
    const clause = match[2].trim();
    const action = clause.match(event);
    if (
      !action ||
      hypothetical.test(clause) ||
      /^(?:(?:the|el|le|la|os|as)\s+)?(?:\d|kickoff|half[- ]?time|minute|second)/.test(clause)
    )
      continue;
    const relation = /^(?:before|antes|avant)/.test(match[1]) ? 'before' : 'after';
    const anchorType = /^(?:goal|goals|scored|scoring|gol|goles|anoto|marco|but|buts|golo)$/.test(
      action[0],
    )
      ? 'goal'
      : 'other';
    demands.push({ relation, anchorType, requestSpan: (match[0] + clause).trim() });
  }
  return demands;
}

// Select only a unique source-proved keeper/anchor pair from an executed lookup.
// This constrains writer selection; independent coverage and review still apply.
export function relativeKeeperWitnessPair(manifest, relations) {
  if (!Array.isArray(relations) || relations.length !== 1) return null;
  const r = relations[0];
  if (
    !['before', 'after'].includes(r.relation) ||
    r.resultEvents?.length !== 1 ||
    r.query?.filters?.recoveryKind !== 'goalkeeper-hold' ||
    r.query?.filters?.linkedShotOutcome !== 'saved' ||
    r.anchor?.type !== 'event' ||
    !Number.isFinite(r.anchorTime)
  )
    return null;
  const match = (proof, ref) => proof?.eventId === ref?.id && proof?.revision === ref?.revision;
  const facts = manifest?.facts || [];
  const holds = facts.filter(
    (f) =>
      f.proof?.kind === 'linked-goalkeeper-hold' &&
      f.proof.modelGenerated === false &&
      f.proof.linkBasis === 'explicit-cause' &&
      match(f.proof, r.resultEvents[0]) &&
      Number.isFinite(f.proof.time) &&
      (r.relation === 'before' ? f.proof.time < r.anchorTime : f.proof.time > r.anchorTime),
  );
  const anchors = facts.filter(
    (f) =>
      f.proof?.kind === 'ordered-event' &&
      f.proof.modelGenerated === false &&
      match(f.proof.event, r.anchor) &&
      f.proof.event.time === r.anchorTime,
  );
  if (holds.length !== 1 || anchors.length !== 1 || holds[0].id === anchors[0].id) return null;
  return [holds[0].id, anchors[0].id];
}
/** Bounded licenses for a requested equality relation, never an actor answer.
 * Qualifying an anchor as a home/away shot does not require the later player
 * to belong to that team. Deictic wording and executed relational lookups keep
 * their broader review choices; source checks still validate every binding.
 */
export function allowedRelativeEntityBindings(input = {}) {
  const text = String(input.question || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const refs = Array.isArray(input.queryRelations) ? input.queryRelations : [];
  const deictic =
    /\b(?:their|theirs|his|her|hers|its|he|she|they|them|that player|this player|son|sa|ses|leur|leurs|il|elle|ils|elles|su|sus|el|ella|ellos|ellas|seu|sua|seus|suas|ele|ela|eles|elas)\b/u.test(
      text,
    );
  const team =
    deictic ||
    refs.some((ref) => ref.sameTeam === true) ||
    /\b(?:same (?:team|side|club)|that (?:team|side|club)|meme (?:equipe|club)|cette equipe|mism[oa] (?:equipo|club)|es[ea] equipo|mesm[ao] (?:equipa|equipe|time)|essa (?:equipa|equipe))\b/u.test(
      text,
    );
  const player =
    deictic ||
    refs.some((ref) => ref.samePlayer === true) ||
    /\b(?:same (?:player|person)|meme joueur|mismo jugador|mesmo jogador)\b/u.test(text);
  return ['none', ...(team ? ['same-team'] : []), ...(player ? ['same-player'] : [])];
}
