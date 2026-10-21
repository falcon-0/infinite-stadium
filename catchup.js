import { languagePreference } from './localization.js';
import { momentHeadline } from './viewer-copy.js';
import { sourceTeams } from './source-teams.js';

const teamIds = new Set(['home', 'away']);
const ref = (event) => ({ type: 'event', id: event.id, revision: event.revision });
const compare = (a, b) => a.time - b.time || a.id.localeCompare(b.id);
const score = (events) => ({
  home: events.filter((e) => e.team === 'home' && e.type === 'shot' && e.result === true).length,
  away: events.filter((e) => e.team === 'away' && e.type === 'shot' && e.result === true).length,
});
const copies = {
  en: {
    empty: 'No new recorded actions in this interval.',
    summary: (n, g, s) =>
      `${n} new recorded ${n === 1 ? 'action' : 'actions'}: ${g} ${g === 1 ? 'goal' : 'goals'} and ${s} ${s === 1 ? 'shot' : 'shots'}.`,
    goal: 'scored',
    shot: 'shot without scoring',
    pending: 'shot; outcome pending',
    pass: 'passed',
    receive: 'received the ball',
    recovery: 'won possession',
    other: 'recorded action',
    correction: 'Correction to an earlier action; not a new action.',
    late: 'An earlier action arrived late; not a new action.',
    withdrawal:
      'The provider withdrew a recorded event. It is excluded from current action counts; this withdrawal is not a new action.',
    uncertainWithdrawal:
      'The provider withdrew a recorded event. Earlier revision history is missing, so its original interval membership is unknown; it is excluded from new-action counts.',
    uncertain:
      'Earlier revision history is missing. This correction may concern an action before or after the interval; it is excluded from new-action counts.',
    limit:
      'Synthetic event data. This catch-up reports received actions, not tactical causes or a full match. Historical score is unavailable when earlier revisions are missing.',
  },
  es: {
    empty: 'No hay acciones nuevas registradas en este intervalo.',
    summary: (n, g, s) => `${n} acciones nuevas registradas: ${g} goles y ${s} tiros.`,
    goal: 'marcó',
    shot: 'disparó sin marcar',
    pending: 'disparó; resultado pendiente',
    pass: 'dio un pase',
    receive: 'recibió el balón',
    recovery: 'recuperó la posesión',
    other: 'acción registrada',
    correction: 'Corrección de una acción anterior; no es una acción nueva.',
    late: 'Una acción anterior llegó tarde; no es una acción nueva.',
    withdrawal:
      'El proveedor retiró un evento registrado. Se excluye del recuento actual de acciones; la retirada no es una acción nueva.',
    uncertainWithdrawal:
      'El proveedor retiró un evento registrado. Faltan revisiones anteriores, por lo que se desconoce su pertenencia original al intervalo; se excluye del recuento de acciones nuevas.',
    uncertain:
      'Faltan revisiones anteriores. Esta corrección puede referirse a una acción anterior o posterior al inicio del intervalo; se excluye del recuento de acciones nuevas.',
    limit:
      'Datos de eventos sintéticos. Este resumen describe acciones recibidas, no causas tácticas ni un partido completo. El marcador histórico no está disponible si faltan revisiones anteriores.',
  },
  fr: {
    empty: 'Aucune nouvelle action enregistrée dans cet intervalle.',
    summary: (n, g, s) => `${n} nouvelles actions enregistrées : ${g} buts et ${s} tirs.`,
    goal: 'a marqué',
    shot: 'a tiré sans marquer',
    pending: 'a tiré ; résultat en attente',
    pass: 'a fait une passe',
    receive: 'a reçu le ballon',
    recovery: 'a récupéré la possession',
    other: 'action enregistrée',
    correction: 'Correction d’une action antérieure ; ce n’est pas une nouvelle action.',
    late: 'Une action antérieure est arrivée en retard ; ce n’est pas une nouvelle action.',
    withdrawal:
      'Le fournisseur a retiré un événement enregistré. Il est exclu du compte actuel des actions ; ce retrait n’est pas une nouvelle action.',
    uncertainWithdrawal:
      'Le fournisseur a retiré un événement enregistré. Les révisions antérieures manquent, donc son appartenance initiale à l’intervalle est inconnue ; il est exclu du compte des nouvelles actions.',
    uncertain:
      'Les révisions antérieures manquent. Cette correction peut concerner une action avant ou après le début de l’intervalle ; elle est exclue du compte des nouvelles actions.',
    limit:
      'Données d’événements synthétiques. Ce résumé décrit les actions reçues, pas les causes tactiques ni un match complet. Le score historique est indisponible si des révisions antérieures manquent.',
  },
  pt: {
    empty: 'Não há novas ações registadas neste intervalo.',
    summary: (n, g, s) => `${n} novas ações registadas: ${g} golos e ${s} remates.`,
    goal: 'marcou',
    shot: 'rematou sem marcar',
    pending: 'rematou; resultado pendente',
    pass: 'fez um passe',
    receive: 'recebeu a bola',
    recovery: 'recuperou a posse',
    other: 'ação registada',
    correction: 'Correção de uma ação anterior; não é uma nova ação.',
    late: 'Uma ação anterior chegou tarde; não é uma nova ação.',
    withdrawal:
      'O fornecedor retirou um evento registado. É excluído da contagem atual de ações; esta retirada não é uma nova ação.',
    uncertainWithdrawal:
      'O fornecedor retirou um evento registado. Faltam revisões anteriores, por isso a sua pertença original ao intervalo é desconhecida; é excluído da contagem de novas ações.',
    uncertain:
      'Faltam revisões anteriores. Esta correção pode referir-se a uma ação antes ou depois do início do intervalo; é excluída da contagem de novas ações.',
    limit:
      'Dados de eventos sintéticos. Este resumo descreve ações recebidas, não causas táticas nem um jogo completo. O resultado histórico está indisponível quando faltam revisões anteriores.',
  },
};

const footballCopy = {
  en: {
    shots: (s, g) =>
      g
        ? `${s} ${s === 1 ? 'shot' : 'shots'}, including ${g === 1 ? 'a goal' : `${g} goals`}.`
        : `${s} ${s === 1 ? 'shot' : 'shots'}; no confirmed goal.`,
    noShots: 'No shots in this interval.',
    lead: (club, a, b) => `${club} lead ${a}–${b} at the end of this interval.`,
    level: (a, b) => `The score is level at ${a}–${b} at the end of this interval.`,
  },
  es: {
    shots: (s, g) =>
      g
        ? `${s} ${s === 1 ? 'tiro' : 'tiros'}, con ${g === 1 ? 'un gol' : `${g} goles`}.`
        : `${s} ${s === 1 ? 'tiro' : 'tiros'}; ningún gol confirmado.`,
    noShots: 'No hubo tiros en este intervalo.',
    lead: (club, a, b) => `${club} gana ${a}–${b} al final de este intervalo.`,
    level: (a, b) => `El marcador está empatado ${a}–${b} al final de este intervalo.`,
  },
  fr: {
    shots: (s, g) =>
      g
        ? `${s} ${s === 1 ? 'tir' : 'tirs'}, dont ${g === 1 ? 'un but' : `${g} buts`}.`
        : `${s} ${s === 1 ? 'tir' : 'tirs'} ; aucun but confirmé.`,
    noShots: 'Aucun tir dans cet intervalle.',
    lead: (club, a, b) => `${club} mène ${a}–${b} à la fin de cet intervalle.`,
    level: (a, b) => `Le score est de ${a}–${b}, à égalité à la fin de cet intervalle.`,
  },
  pt: {
    shots: (s, g) =>
      g
        ? `${s} ${s === 1 ? 'remate' : 'remates'}, incluindo ${g === 1 ? 'um golo' : `${g} golos`}.`
        : `${s} ${s === 1 ? 'remate' : 'remates'}; nenhum golo confirmado.`,
    noShots: 'Não houve remates neste intervalo.',
    lead: (club, a, b) => `${club} vence por ${a}–${b} no final deste intervalo.`,
    level: (a, b) => `O resultado está empatado a ${a}–${b} no final deste intervalo.`,
  },
};

function materialize(records, time) {
  const active = new Map();
  for (const record of records) {
    if (record.time > time || record.arrivedAt > time) continue;
    const previous = active.get(record.id);
    if (!previous || record.revision > previous.revision) active.set(record.id, record);
  }
  return active;
}
const visible = (active) =>
  [...active.values()].filter((e) => e.operation !== 'delete').sort(compare);

/** Pure received-evidence catch-up. Interval is (since, observedAt].
 * Accepts raw revision history or materialized current records (Map.values()).
 * A current-only revision cannot establish its previous contents: in that case
 * scoreAtSince is null, rather than silently treating a correction as a goal.
 * Revised records without their original received history are excluded from
 * new-action counts: a timestamp repair may have moved them across the boundary.
 * Highlights and displayed updates are bounded; counts cite every input.
 */
export function catchup(events, observedAt, since, preferences = {}) {
  if (!Number.isFinite(observedAt) || !Number.isFinite(since) || since < 0 || observedAt < since)
    throw new RangeError('Choose a finite catch-up interval with 0 <= since <= observedAt.');
  const { language = 'en', favoriteClub = null, favoritePlayer = null, limit = 3 } = preferences;
  languagePreference(language);
  if (
    (favoriteClub !== null && !teamIds.has(favoriteClub)) ||
    (favoritePlayer !== null &&
      (typeof favoritePlayer !== 'string' ||
        !favoritePlayer.trim() ||
        favoritePlayer.length > 100)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5
  )
    throw new RangeError('Choose a valid club, player and highlight limit from 1 to 5.');
  if (!events || typeof events[Symbol.iterator] !== 'function')
    throw new TypeError('Provide an iterable of received event records.');
  const records = [];
  for (const event of events) {
    if (records.length >= 10000)
      throw new RangeError('Catch-up input exceeds 10000 received records.');
    if (
      !event ||
      typeof event.id !== 'string' ||
      !event.id ||
      !Number.isInteger(event.revision) ||
      event.revision < 1 ||
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      !Number.isFinite(event.arrivedAt) ||
      event.arrivedAt < event.time ||
      ![undefined, 'upsert', 'delete'].includes(event.operation) ||
      (event.operation !== 'delete' &&
        (!teamIds.has(event.team) || typeof event.type !== 'string' || !event.type))
    )
      throw new TypeError(
        'Each record needs an id, positive revision and arrival no earlier than event time; non-deletions also need home/away team and type.',
      );
    records.push({ ...event });
  }
  const currentMap = materialize(records, observedAt),
    beforeMap = materialize(records, since);
  const received = records.filter((e) => e.time <= observedAt && e.arrivedAt <= observedAt);
  const histories = new Map();
  for (const record of received) {
    const history = histories.get(record.id) || { hasOriginal: false, hasEarlierTime: false };
    history.hasOriginal ||= record.revision === 1;
    history.hasEarlierTime ||= record.time <= since;
    histories.set(record.id, history);
  }
  const uncertain = [...currentMap.values()].filter(
    (e) => e.revision > 1 && !beforeMap.has(e.id) && !histories.get(e.id)?.hasOriginal,
  );
  const uncertainIds = new Set(uncertain.map((e) => e.id));
  // Preserve action identity when a correction also changes its timestamp.
  // Flight records are positional samples, not additional football actions.
  const wasOld = (event) =>
    event.time <= since ||
    beforeMap.has(event.id) ||
    uncertainIds.has(event.id) ||
    histories.get(event.id)?.hasEarlierTime;
  const current = visible(currentMap),
    before = visible(beforeMap),
    newActions = current.filter((e) => !wasOld(e) && e.type !== 'flight');
  const clubNames = sourceTeams(preferences.teams, current);
  // A received withdrawal remains news even if the now-retracted original
  // action occurred inside this interval. It is never a new football action.
  const oldUpdates = [...currentMap.values()]
    .filter((e) => (wasOld(e) || e.operation === 'delete') && e.arrivedAt > since)
    .sort((a, b) => b.arrivedAt - a.arrivedAt || a.id.localeCompare(b.id));
  const missingHistory = oldUpdates.filter(
    (e) => e.revision > 1 && !beforeMap.has(e.id) && uncertainIds.has(e.id),
  );
  const baselineComplete = missingHistory.length === 0;
  const text = copies[language];
  const subsets = {
    actions: newActions,
    goals: newActions.filter((e) => e.type === 'shot' && e.result === true),
    shots: newActions.filter((e) => e.type === 'shot'),
    passes: newActions.filter((e) => e.type === 'pass'),
    completedPasses: newActions.filter((e) => e.type === 'pass' && e.result === true),
    pendingPasses: newActions.filter((e) => e.type === 'pass' && typeof e.result !== 'boolean'),
    recoveries: newActions.filter((e) => e.type === 'recovery'),
  };
  const counts = Object.fromEntries(
    Object.entries(subsets).map(([key, value]) => [key, value.length]),
  );
  const countsEvidence = Object.fromEntries(
    Object.entries(subsets).map(([key, value]) => [key, value.map(ref)]),
  );
  const highlights = newActions
    .filter((e) => ['shot', 'pass', 'recovery', 'receive'].includes(e.type))
    .map((event) => {
      const favorite =
        event.team === favoriteClub ||
        event.player === favoritePlayer ||
        event.playerId === favoritePlayer;
      const priority =
        (event.type === 'shot'
          ? event.result === true
            ? 100
            : 40
          : event.type === 'recovery'
            ? 20
            : 10) + (favorite ? 15 : 0);
      const action = text[event.type] || text.other;
      const headline =
        event.type === 'shot'
          ? momentHeadline(event, language)
          : `${event.player || clubNames[event.team]} ${action}`;
      return {
        anchorId: event.id,
        time: event.time,
        arrivedAt: event.arrivedAt,
        priority,
        preferenceMatch: favorite,
        text: `${headline} (${clubNames[event.team]}).`,
        evidence: [ref(event)],
      };
    })
    .sort(
      (a, b) => b.priority - a.priority || b.time - a.time || a.anchorId.localeCompare(b.anchorId),
    )
    .slice(0, limit)
    .sort((a, b) => a.time - b.time || a.anchorId.localeCompare(b.anchorId));
  const updates = oldUpdates.slice(0, limit).map((event) => ({
    anchorId: event.id,
    time: event.time,
    arrivedAt: event.arrivedAt,
    kind: event.revision > 1 ? 'correction' : 'late-arrival',
    withdrawn: event.operation === 'delete',
    intervalMembership: uncertainIds.has(event.id)
      ? 'unknown'
      : wasOld(event)
        ? 'before-or-at-since'
        : 'within-interval',
    text:
      event.operation === 'delete'
        ? uncertainIds.has(event.id)
          ? text.uncertainWithdrawal
          : text.withdrawal
        : uncertainIds.has(event.id)
          ? text.uncertain
          : event.revision > 1
            ? text.correction
            : text.late,
    evidence: [ref(event)],
    previousEvidence: beforeMap.has(event.id)
      ? [ref(beforeMap.get(event.id))]
      : event.operation === 'delete'
        ? received
            .filter(
              (record) =>
                record.id === event.id &&
                record.revision < event.revision &&
                record.operation !== 'delete' &&
                record.arrivedAt <= event.arrivedAt,
            )
            .sort((a, b) => b.revision - a.revision)
            .slice(0, 1)
            .map(ref)
        : [],
  }));
  const goalRefs = (list) => list.filter((e) => e.type === 'shot' && e.result === true).map(ref);
  const finalScore = score(current),
    football = footballCopy[language];
  const consequence = counts.goals
    ? finalScore.home === finalScore.away
      ? football.level(finalScore.home, finalScore.away)
      : finalScore.home > finalScore.away
        ? football.lead(clubNames.home, finalScore.home, finalScore.away)
        : football.lead(clubNames.away, finalScore.away, finalScore.home)
    : null;
  return {
    source: 'received-event-template',
    synthetic: true,
    since,
    observedAt,
    interval: '(since, observedAt]',
    teams: clubNames,
    preferences: { language, favoriteClub, favoritePlayer, limit },
    counts,
    countsEvidence,
    scoreAtSince: baselineComplete ? score(before) : null,
    scoreNow: score(current),
    baselineComplete,
    scoreEvidence: { since: baselineComplete ? goalRefs(before) : [], now: goalRefs(current) },
    highlights,
    updates,
    updateCount: oldUpdates.length,
    correctionCount: oldUpdates.filter((e) => e.revision > 1).length,
    uncertainUpdateCount: uncertain.length,
    lateArrivalCount: oldUpdates.filter((e) => e.revision === 1).length,
    updatesTruncated: oldUpdates.length > limit,
    missingHistory: missingHistory.map(ref),
    summary: counts.shots
      ? football.shots(counts.shots, counts.goals)
      : newActions.length
        ? football.noShots
        : text.empty,
    accounting: newActions.length
      ? text.summary(counts.actions, counts.goals, counts.shots)
      : text.empty,
    consequence,
    consequenceEvidence: consequence ? goalRefs(current) : [],
    limitation: text.limit,
    key:
      JSON.stringify({
        since,
        observedAt,
        language,
        favoriteClub,
        favoritePlayer,
        limit,
        teams: clubNames,
      }) +
      '|' +
      [...currentMap.values()]
        .sort(compare)
        .map((e) => `${e.id}@${e.revision}:${e.operation || 'upsert'}`)
        .join('|') +
      '|history:' +
      [...new Set(received.map((e) => `${e.id}@${e.revision}:${e.time}:${e.arrivedAt}`))]
        .sort()
        .join('|'),
  };
}
