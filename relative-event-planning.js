// A bounded planning obligation, never an answer or source-proof substitute.
// Relative clock windows and hypothetical actions are deliberately excluded.
// Recognize only a small, explicit same-team predecessor/time grammar. This
// binds two read-only lookups, never an answer, player or guessed timestamp.
export function sameTeamPredecessorQueries(input, teams = {}) {
  const normalize = (value) =>
    String(value || '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const current = normalize(input.question);
  const prior = input.conversation?.at(-1);
  if (!prior || prior.time > input.time || current.split(' ').length > 22) return null;
  const allowed = new Set(
    (
      'and et y e the that this same team side previous shot pass one when what about time at was did s for ' +
      'le la l de du cette meme equipe tir passe precedent precedente a quel moment quelle heure ' +
      'el del ese mismo equipo tiro disparo pase anterior que hora cuando fue ' +
      'o da do mesma mesmo equipa remate chute quando minuto foi'
    ).split(' '),
  );
  if (current.split(' ').some((word) => !allowed.has(word))) return null;
  if (
    !/\b(previous|precedent|precedente|anterior)\b/.test(current) ||
    !/\b(same (?:team|side)|meme equipe|mismo equipo|mesm[ao] (?:equipa|equipe))\b/.test(current) ||
    !/\b(when|what time|quel moment|quelle heure|cuando|que hora|quando|que minuto)\b/.test(current)
  )
    return null;
  const old = normalize(prior.question);
  const priorAllowed = new Set([
    ...allowed,
    ...(
      'latest last most recent plus dernier ultimo mas reciente mais home away domicile local casa exterieur visitante fora ' +
      'who took made take did occur happen happened shots tirs passes t elle il tente son sa pour'
    ).split(' '),
    ...Object.values(teams).flatMap((name) => normalize(name).split(' ')),
  ]);
  // Unknown names, technique/outcome qualifiers and numeric windows stay with
  // the semantic planner instead of silently broadening the inherited anchor.
  if (old.split(' ').some((word) => !priorAllowed.has(word))) return null;
  if (
    !/\b(latest|last|most recent|plus recent|dernier|ultimo|mas reciente|mais recente)\b/.test(
      old,
    ) ||
    /\b(goal|scored|saved|blocked|successful|completed|defendu|arrete|reussi|but|gol|golo|defendido|certo)\b/.test(
      old,
    )
  )
    return null;
  const types = [
    ['shot', /\b(shot|shots|tir|tirs|tiro|disparo|remate|chute)\b/],
    ['pass', /\b(pass|passes|passe|pase)\b/],
  ];
  const selected = types.filter(([, pattern]) => pattern.test(current) && pattern.test(old));
  if (
    selected.length !== 1 ||
    types.some(([type, pattern]) => type !== selected[0][0] && pattern.test(old))
  )
    return null;
  const sides = [
    ['home', /\b(home|domicile|local|casa)\b/],
    ['away', /\b(away|exterieur|visitante|fora)\b/],
  ].filter(
    ([side, pattern]) =>
      pattern.test(old) ||
      (normalize(teams[side]) && (' ' + old + ' ').includes(' ' + normalize(teams[side]) + ' ')),
  );
  if (sides.length !== 1) return null;
  const type = selected[0][0],
    team = sides[0][0];
  return {
    type,
    team,
    queries: [
      { filters: { type, team }, aggregate: 'list', order: 'desc', limit: 1 },
      {
        filters: { type },
        aggregate: 'list',
        order: 'desc',
        limit: 1,
        relativeTo: {
          queryIndex: 0,
          relation: 'before',
          sameTeam: true,
          samePlayer: false,
          anchorOrdinal: null,
        },
      },
    ],
  };
}

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
    demands.push({ relation, anchorType, requestSpan: (match[0] + ' ' + clause).trim() });
  }
  return demands;
}

// A collection's linked-shot outcome does not prove which requested shot
// anchors an after-relation. Require the shot lookup before composing prose.
export function requiresSavedShotAnchor(question) {
  if (
    /\b(could|would|should|might|podria|deberia|pourrait|devrait|poderia|deveria)\b/i.test(
      String(question),
    )
  )
    return false;
  return explicitEventRelations(question).some(
    (demand) =>
      demand.relation === 'after' &&
      /\b(shot|shots|tir|remate|tiro|disparo|chute)\b/.test(demand.requestSpan) &&
      /\b(saved|stopped|defendu|arrete|defendido|parado|atajado)\b/.test(demand.requestSpan),
  );
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
