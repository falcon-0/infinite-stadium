import { languagePreference } from './localization.js';
import { isSafePlayerName } from './viewer-preferences.js';
import { recoveryClassificationVersion } from './recovery-classification.js';

const kinds = new Set([
  'recap-overview',
  'recap-team-shots',
  'recap-team-passes',
  'recap-goal-score-change',
  'recap-player-actions',
]);
const string = (value) => typeof value === 'string' && value.length > 0 && value.length <= 300;
const number = (value) => Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const team = (value) => value === 'home' || value === 'away';
const refKey = (ref) => `${ref.type}:${ref.id}@${ref.revision}`;
const validRefs = (refs) =>
  Array.isArray(refs) &&
  refs.length > 0 &&
  refs.length <= 10000 &&
  refs.every(
    (ref) =>
      ref &&
      ref.type === 'event' &&
      string(ref.id) &&
      Number.isSafeInteger(ref.revision) &&
      ref.revision > 0,
  ) &&
  new Set(refs.map((ref) => ref.id)).size === refs.length;
const effect = (values) => {
  const before =
    values.team === 'home'
      ? values.beforeHome - values.beforeAway
      : values.beforeAway - values.beforeHome;
  const after =
    values.team === 'home'
      ? values.afterHome - values.afterAway
      : values.afterAway - values.afterHome;
  return after === 0
    ? 'equalized'
    : before === 0
      ? 'took-lead'
      : before > 0
        ? 'extended-lead'
        : 'reduced-deficit';
};
const timestamp = (value) =>
  Number.isInteger(value)
    ? `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    : `${value}s`;
const exactKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const valueKeys = {
  'recap-overview': [
    'home',
    'away',
    'observedAt',
    'segmentDuration',
    'status',
    'eventCount',
    'firstEventTime',
    'lastEventTime',
  ],
  'recap-team-shots': ['team', 'count', 'start', 'end'],
  'recap-team-passes': ['team', 'total', 'known', 'completed', 'failed', 'pending', 'start', 'end'],
  'recap-goal-score-change': [
    'anchorId',
    'time',
    'team',
    'player',
    'beforeHome',
    'beforeAway',
    'afterHome',
    'afterAway',
    'effect',
  ],
  'recap-player-actions': [
    'player',
    'playerId',
    'team',
    'total',
    'shots',
    'goals',
    'passes',
    'completedPasses',
    'pendingPasses',
    'recoveries',
    'ballWins',
    'initialControls',
    'unknownRecoveries',
    'recoveryClassificationVersion',
    'involvement',
    'start',
    'end',
  ],
};
function recoverySummary(v, language) {
  const known = {
    en: `${v.ballWins} ${v.ballWins === 1 ? 'ball win' : 'ball wins'}`,
    es: `${v.ballWins} ${v.ballWins === 1 ? 'balón recuperado' : 'balones recuperados'}`,
    fr: `${v.ballWins} ${v.ballWins === 1 ? 'ballon récupéré' : 'ballons récupérés'}`,
    pt: `${v.ballWins} ${v.ballWins === 1 ? 'bola recuperada' : 'bolas recuperadas'}`,
  }[language];
  const uncertain = {
    en: `ball-win total uncertain (${v.ballWins} classified; ${v.unknownRecoveries} recovery records unclassified)`,
    es: `total de balones recuperados incierto (${v.ballWins} clasificados; ${v.unknownRecoveries} registros de recuperación sin clasificar)`,
    fr: `total de ballons récupérés incertain (${v.ballWins} classés ; ${v.unknownRecoveries} événements de récupération non classés)`,
    pt: `total de bolas recuperadas incerto (${v.ballWins} classificadas; ${v.unknownRecoveries} registros de recuperação sem classificação)`,
  }[language];
  const initial = {
    en: `; ${v.initialControls} ${v.initialControls === 1 ? 'initial-control event' : 'initial-control events'}`,
    es: `; ${v.initialControls} ${v.initialControls === 1 ? 'evento de posesión inicial' : 'eventos de posesión inicial'}`,
    fr: ` ; ${v.initialControls} ${v.initialControls === 1 ? 'événement de possession initiale' : 'événements de possession initiale'}`,
    pt: `; ${v.initialControls} ${v.initialControls === 1 ? 'evento de posse inicial' : 'eventos de posse inicial'}`,
  }[language];
  return (v.unknownRecoveries ? uncertain : known) + (v.initialControls ? initial : '');
}

function validateCatalog(catalog) {
  if (
    !catalog ||
    !Array.isArray(catalog.facts) ||
    catalog.facts.length < 1 ||
    catalog.facts.length > 12 ||
    catalog.facts.some(
      (fact) =>
        !exactKeys(fact, ['id', 'kind', 'values', 'evidence']) ||
        !string(fact.id) ||
        !kinds.has(fact.kind) ||
        !exactKeys(fact.values, valueKeys[fact.kind]) ||
        !validRefs(fact.evidence),
    ) ||
    new Set(catalog.facts.map((fact) => fact.id)).size !== catalog.facts.length
  )
    throw new TypeError('Provide a valid current typed recap catalog.');
  const overviews = catalog.facts.filter((fact) => fact.kind === 'recap-overview');
  if (overviews.length !== 1) throw new TypeError('A recap catalog needs exactly one overview.');
  const overview = overviews[0],
    v = overview.values;
  if (
    ![v.home, v.away, v.eventCount].every(integer) ||
    v.eventCount < 1 ||
    overview.evidence.length !== v.eventCount ||
    v.home + v.away > v.eventCount ||
    !number(v.observedAt) ||
    !number(v.segmentDuration) ||
    v.segmentDuration === 0 ||
    !number(v.firstEventTime) ||
    !number(v.lastEventTime) ||
    v.firstEventTime > v.lastEventTime ||
    v.lastEventTime > v.observedAt ||
    v.status !== (v.observedAt >= v.segmentDuration ? 'demo-segment-complete' : 'in-progress')
  )
    throw new TypeError('The recap overview has inconsistent scores, timing or coverage.');
  if (
    catalog.scope?.task !== 'recap' ||
    catalog.scope.observedAt !== v.observedAt ||
    catalog.scope.fixture?.synthetic !== true ||
    catalog.scope.fixture.segmentDuration !== v.segmentDuration
  )
    throw new TypeError('The recap scope must match its received synthetic overview.');
  if (
    !exactKeys(catalog.scope.teams, ['home', 'away']) ||
    !Object.values(catalog.scope.teams).every(isSafePlayerName) ||
    catalog.scope.teams.home === catalog.scope.teams.away
  )
    throw new TypeError('The recap scope needs bounded current club names.');
  const inventory = new Set(overview.evidence.map(refKey));
  for (const fact of catalog.facts) {
    const values = fact.values,
      refs = fact.evidence;
    if (refs.some((ref) => !inventory.has(refKey(ref))))
      throw new TypeError('A recap fact cites unknown or stale received evidence.');
    const window = values.start === 0 && values.end === v.observedAt;
    switch (fact.kind) {
      case 'recap-overview':
        break;
      case 'recap-team-shots':
        if (
          !team(values.team) ||
          !integer(values.count) ||
          values.count < 1 ||
          refs.length !== values.count ||
          !window
        )
          throw new TypeError('Invalid recap shot count.');
        break;
      case 'recap-team-passes':
        if (
          !team(values.team) ||
          ![values.total, values.known, values.completed, values.failed, values.pending].every(
            integer,
          ) ||
          values.total < 1 ||
          values.completed + values.failed !== values.known ||
          values.known + values.pending !== values.total ||
          refs.length !== values.total ||
          !window
        )
          throw new TypeError('Invalid recap known-outcome pass counts.');
        break;
      case 'recap-goal-score-change':
        if (
          !team(values.team) ||
          !string(values.anchorId) ||
          !(values.player === null || string(values.player)) ||
          !number(values.time) ||
          values.time > v.observedAt ||
          ![values.beforeHome, values.beforeAway, values.afterHome, values.afterAway].every(
            integer,
          ) ||
          values.afterHome !== values.beforeHome + (values.team === 'home' ? 1 : 0) ||
          values.afterAway !== values.beforeAway + (values.team === 'away' ? 1 : 0) ||
          values.effect !== effect(values) ||
          refs.length !== values.afterHome + values.afterAway ||
          !refs.some((ref) => ref.id === values.anchorId) ||
          values.afterHome > v.home ||
          values.afterAway > v.away
        )
          throw new TypeError('Invalid recap goal score change or incomplete support.');
        break;
      case 'recap-player-actions':
        if (
          !isSafePlayerName(values.player) ||
          !string(values.playerId) ||
          values.playerId.length > 100 ||
          !team(values.team) ||
          ![
            values.total,
            values.shots,
            values.goals,
            values.passes,
            values.completedPasses,
            values.pendingPasses,
            values.recoveries,
            values.ballWins,
            values.initialControls,
            values.unknownRecoveries,
          ].every(integer) ||
          values.recoveries !==
            values.ballWins + values.initialControls + values.unknownRecoveries ||
          values.recoveryClassificationVersion !== recoveryClassificationVersion ||
          values.goals > values.shots ||
          values.completedPasses + values.pendingPasses > values.passes ||
          values.shots + values.passes + values.recoveries > values.total ||
          !window ||
          values.involvement !== 'recorded' ||
          values.total === 0 ||
          refs.length !== values.total
        )
          throw new TypeError('Invalid recap player action counts or no-involvement support.');
        break;
    }
  }
  return overview;
}

const copy = {
  en: {
    minutes: 'minutes',
    overview: (h, a, duration, t, done, clubs) =>
      `Synthetic segment through ${t}: ${clubs.home} ${h}-${a} ${clubs.away}. ${done ? 'Demo segment complete' : 'Demo segment in progress'} (${duration}).`,
    shots: (club, n, end) =>
      `${club}: ${n} ${n === 1 ? 'shot' : 'shots'} from 00:00 to ${timestamp(end)}.`,
    passes: (club, v, percent) =>
      `${club}: ${v.completed} ${v.completed === 1 ? 'pass' : 'passes'} completed, ${v.failed} unsuccessful${percent === null ? '' : ` (${percent}% completion)`}${v.pending ? `; ${v.pending} ${v.pending === 1 ? 'pass awaits' : 'passes await'} confirmation` : ''} (00:00–${timestamp(v.end)}).`,
    effects: {
      equalized: 'equalized',
      'took-lead': 'took the lead',
      'extended-lead': 'extended the lead',
      'reduced-deficit': 'reduced the deficit',
    },
    change: (club, action, v) =>
      `${club} ${action} at ${timestamp(v.time)}: ${v.beforeHome}-${v.beforeAway} → ${v.afterHome}-${v.afterAway}.`,
    player: (v) =>
      `${v.player}, 00:00–${timestamp(v.end)}: ${v.total} ${v.total === 1 ? 'action' : 'actions'}; ${v.shots} ${v.shots === 1 ? 'shot' : 'shots'} (${v.goals} ${v.goals === 1 ? 'goal' : 'goals'}), ${v.passes} ${v.passes === 1 ? 'pass' : 'passes'} (${v.completedPasses} completed${v.pendingPasses ? `, ${v.pendingPasses} awaiting confirmation` : ''}), ${recoverySummary(v, 'en')}.`,
    none: (v) => `No actions shown for ${v.player} in this segment (00:00–${timestamp(v.end)}).`,
  },
  es: {
    minutes: 'minutos',
    overview: (h, a, duration, t, done, clubs) =>
      `Segmento sintético hasta ${t}: ${clubs.home} ${h}-${a} ${clubs.away}. ${done ? 'Segmento de demostración completado' : 'Segmento de demostración en curso'} (${duration}).`,
    shots: (club, n, end) =>
      `${club}: ${n} ${n === 1 ? 'tiro' : 'tiros'} de 00:00 a ${timestamp(end)}.`,
    passes: (club, v, percent) =>
      `${club}: ${v.completed} ${v.completed === 1 ? 'pase completado' : 'pases completados'}, ${v.failed} fallidos${percent === null ? '' : ` (${percent}% completados)`}${v.pending ? `; ${v.pending} ${v.pending === 1 ? 'pase pendiente' : 'pases pendientes'} de confirmación` : ''} (00:00–${timestamp(v.end)}).`,
    effects: {
      equalized: 'igualó el marcador',
      'took-lead': 'se adelantó',
      'extended-lead': 'amplió su ventaja',
      'reduced-deficit': 'redujo su desventaja',
    },
    change: (club, action, v) =>
      `${club} ${action} a los ${timestamp(v.time)}: ${v.beforeHome}-${v.beforeAway} → ${v.afterHome}-${v.afterAway}.`,
    player: (v) =>
      `${v.player}, 00:00–${timestamp(v.end)}: ${v.total} ${v.total === 1 ? 'acción' : 'acciones'}; ${v.shots} ${v.shots === 1 ? 'tiro' : 'tiros'} (${v.goals} ${v.goals === 1 ? 'gol' : 'goles'}), ${v.passes} ${v.passes === 1 ? 'pase' : 'pases'} (${v.completedPasses} completados${v.pendingPasses ? `, ${v.pendingPasses} pendientes de confirmación` : ''}), ${recoverySummary(v, 'es')}.`,
    none: (v) =>
      `No se muestran acciones de ${v.player} en este segmento (00:00–${timestamp(v.end)}).`,
  },
  fr: {
    minutes: 'minutes',
    overview: (h, a, duration, t, done, clubs) =>
      `Segment synthétique jusqu’à ${t} : ${clubs.home} ${h}-${a} ${clubs.away}. ${done ? 'Segment de démonstration terminé' : 'Segment de démonstration en cours'} (${duration}).`,
    shots: (club, n, end) =>
      `${club} : ${n} ${n === 1 ? 'tir' : 'tirs'} de 00:00 à ${timestamp(end)}.`,
    passes: (club, v, percent) =>
      `${club} : ${v.completed} ${v.completed === 1 ? 'passe réussie' : 'passes réussies'}, ${v.failed} manquées${percent === null ? '' : ` (${percent} % de réussite)`}${v.pending ? ` ; ${v.pending} ${v.pending === 1 ? 'passe en attente' : 'passes en attente'} de confirmation` : ''} (00:00–${timestamp(v.end)}).`,
    effects: {
      equalized: 'a égalisé',
      'took-lead': 'a pris l’avantage',
      'extended-lead': 'a augmenté son avance',
      'reduced-deficit': 'a réduit son retard',
    },
    change: (club, action, v) =>
      `${club} ${action} à ${timestamp(v.time)} : ${v.beforeHome}-${v.beforeAway} → ${v.afterHome}-${v.afterAway}.`,
    player: (v) =>
      `${v.player}, 00:00–${timestamp(v.end)} : ${v.total} ${v.total === 1 ? 'action' : 'actions'} ; ${v.shots} ${v.shots === 1 ? 'tir' : 'tirs'} (${v.goals} ${v.goals === 1 ? 'but' : 'buts'}), ${v.passes} ${v.passes === 1 ? 'passe' : 'passes'} (${v.completedPasses} réussies${v.pendingPasses ? `, ${v.pendingPasses} en attente de confirmation` : ''}), ${recoverySummary(v, 'fr')}.`,
    none: (v) =>
      `Aucune action affichée pour ${v.player} dans ce segment (00:00–${timestamp(v.end)}).`,
  },
  pt: {
    minutes: 'minutos',
    overview: (h, a, duration, t, done, clubs) =>
      `Segmento sintético até ${t}: ${clubs.home} ${h}-${a} ${clubs.away}. ${done ? 'Segmento de demonstração concluído' : 'Segmento de demonstração em curso'} (${duration}).`,
    shots: (club, n, end) =>
      `${club}: ${n} ${n === 1 ? 'remate' : 'remates'} de 00:00 a ${timestamp(end)}.`,
    passes: (club, v, percent) =>
      `${club}: ${v.completed} ${v.completed === 1 ? 'passe completado' : 'passes completados'}, ${v.failed} falhados${percent === null ? '' : ` (${percent}% de conclusão)`}${v.pending ? `; ${v.pending} ${v.pending === 1 ? 'passe aguarda' : 'passes aguardam'} confirmação` : ''} (00:00–${timestamp(v.end)}).`,
    effects: {
      equalized: 'igualou o resultado',
      'took-lead': 'passou para a frente',
      'extended-lead': 'ampliou a vantagem',
      'reduced-deficit': 'reduziu a desvantagem',
    },
    change: (club, action, v) =>
      `${club} ${action} aos ${timestamp(v.time)}: ${v.beforeHome}-${v.beforeAway} → ${v.afterHome}-${v.afterAway}.`,
    player: (v) =>
      `${v.player}, 00:00–${timestamp(v.end)}: ${v.total} ${v.total === 1 ? 'ação' : 'ações'}; ${v.shots} ${v.shots === 1 ? 'remate' : 'remates'} (${v.goals} ${v.goals === 1 ? 'golo' : 'golos'}), ${v.passes} ${v.passes === 1 ? 'passe' : 'passes'} (${v.completedPasses} completados${v.pendingPasses ? `, ${v.pendingPasses} aguardam confirmação` : ''}), ${recoverySummary(v, 'pt')}.`,
    none: (v) =>
      `Não são mostradas ações de ${v.player} neste segmento (00:00–${timestamp(v.end)}).`,
  },
};

export function renderRecapFacts(
  catalog,
  selectedFactIds,
  { language = 'en', audience = 'newcomer' } = {},
) {
  languagePreference(language);
  if (!['newcomer', 'analyst', 'player', 'spatial'].includes(audience))
    throw new RangeError('Choose a supported recap audience.');
  const overview = validateCatalog(catalog),
    maximum = ['newcomer', 'player'].includes(audience) ? 3 : 5;
  if (
    !Array.isArray(selectedFactIds) ||
    selectedFactIds.length < 1 ||
    selectedFactIds.length > maximum ||
    selectedFactIds.some((id) => !string(id)) ||
    new Set(selectedFactIds).size !== selectedFactIds.length
  )
    throw new RangeError('Choose a bounded set of unique current recap fact IDs.');
  const facts = new Map(catalog.facts.map((fact) => [fact.id, fact]));
  if (selectedFactIds.some((id) => !facts.has(id)) || selectedFactIds[0] !== overview.id)
    throw new RangeError('The current recap overview must be selected first.');
  const highlights = selectedFactIds
    .map((id) => facts.get(id))
    .filter((fact) => fact.kind === 'recap-goal-score-change');
  if (
    highlights.length > 3 ||
    highlights.some(
      (fact, index) => index > 0 && fact.values.time < highlights[index - 1].values.time,
    )
  )
    throw new RangeError('Select no more than three goal highlights in chronological order.');
  const c = copy[language],
    clubs = catalog.scope.teams,
    decimal = new Intl.NumberFormat(language, { maximumFractionDigits: 1, useGrouping: false });
  const claims = selectedFactIds.map((id) => {
    const fact = facts.get(id),
      v = fact.values;
    let text;
    switch (fact.kind) {
      case 'recap-overview':
        text = c.overview(
          v.home,
          v.away,
          v.segmentDuration % 60 === 0
            ? `${v.segmentDuration / 60} ${c.minutes}`
            : `${v.segmentDuration}s`,
          timestamp(v.observedAt),
          v.status === 'demo-segment-complete',
          clubs,
        );
        break;
      case 'recap-team-shots':
        text = c.shots(clubs[v.team], v.count, v.end);
        break;
      case 'recap-team-passes':
        text = c.passes(
          clubs[v.team],
          v,
          v.known ? decimal.format((v.completed / v.known) * 100) : null,
        );
        break;
      case 'recap-goal-score-change':
        text = c.change(
          v.player === null ? clubs[v.team] : `${v.player} (${clubs[v.team]})`,
          c.effects[v.effect],
          v,
        );
        break;
      case 'recap-player-actions':
        text = v.involvement === 'none-recorded' ? c.none(v) : c.player(v);
        break;
    }
    return { factId: id, text, evidence: structuredClone(fact.evidence) };
  });
  return {
    source: 'canonical-recap-fact-templates',
    language,
    audience,
    claims,
    limitation:
      'Canonical recap of a received synthetic segment, not a full match or a prediction of its winner. Counts describe the supplied event inventory, not proof of feed completeness. Recorded sequences do not establish tactical causes. Percentage denominators include only known pass outcomes. Translations have not been verified by native speakers.',
  };
}
