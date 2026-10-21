import { languagePreference } from './localization.js';
import { sourceTeams } from './source-teams.js';

const kinds = [
  'moment',
  'goal-score-change',
  'score',
  'recovery-before-shot',
  'completed-passes-between',
  'nearest-sampled-opponent',
  'player-sample-displacement-rate',
  'pass-endpoint-displacement',
  'shot-ball-sample-displacement-rate',
  'window-event-count',
  'window-shot-change',
];
const team = (t) => ['home', 'away'].includes(t);
const number = (n) => Number.isFinite(n) && n >= 0;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const string = (s) => typeof s === 'string' && s.length > 0 && s.length <= 300;
const nullableString = (s) => s === null || string(s);
const interval = (v) => number(v.start) && number(v.end) && v.start < v.end;
const shotOutcomes = new Set(['off-target', 'saved', 'blocked', 'on-target']);
const clock = (time) =>
  `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
const goalEffect = (v) => {
  const before = v.team === 'home' ? v.beforeHome - v.beforeAway : v.beforeAway - v.beforeHome;
  const after = v.team === 'home' ? v.afterHome - v.afterAway : v.afterAway - v.afterHome;
  return after === 0
    ? 'equalized'
    : before === 0 && after === 1
      ? 'took-lead'
      : before > 0
        ? 'extended-lead'
        : before < 0 && after < 0
          ? 'reduced-deficit'
          : null;
};
const referencesValid = (refs) =>
  Array.isArray(refs) &&
  refs.length > 0 &&
  refs.length <= 1000 &&
  refs.every(
    (r) =>
      r &&
      ['event', 'frame', 'metric'].includes(r.type) &&
      string(r.id) &&
      Number.isSafeInteger(r.revision) &&
      r.revision > 0,
  ) &&
  new Set(refs.map((r) => `${r.type}:${r.id}`)).size === refs.length;

function validFact(fact) {
  if (
    !fact ||
    !string(fact.id) ||
    !kinds.includes(fact.kind) ||
    !referencesValid(fact.evidence) ||
    !fact.values ||
    typeof fact.values !== 'object' ||
    Array.isArray(fact.values)
  )
    return false;
  const v = fact.values,
    refs = fact.evidence,
    eventRefs = refs.filter((r) => r.type === 'event');
  const hasEvent = (id) => eventRefs.some((r) => r.id === id);
  const metricSupport = refs.some((r) => r.type === 'metric') && hasEvent(v.anchorId);
  switch (fact.kind) {
    case 'moment':
      return (
        string(v.anchorId) &&
        number(v.time) &&
        team(v.team) &&
        nullableString(v.player) &&
        nullableString(v.playerId) &&
        ['shot', 'pass', 'recovery', 'receive', 'flight'].includes(v.action) &&
        hasEvent(v.anchorId) &&
        (!Object.hasOwn(v, 'shotOutcome') ||
          (v.action === 'shot' && v.outcome === 'no-goal' && shotOutcomes.has(v.shotOutcome))) &&
        (v.action === 'shot'
          ? ['goal', 'no-goal', 'pending'].includes(v.outcome)
          : v.action === 'pass'
            ? ['completed', 'failed', 'pending'].includes(v.outcome)
            : v.outcome === null)
      );
    case 'score':
      return (
        number(v.time) &&
        integer(v.home) &&
        integer(v.away) &&
        v.home + v.away > 0 &&
        refs.length === eventRefs.length &&
        eventRefs.length === v.home + v.away
      );
    case 'goal-score-change':
      return (
        string(v.anchorId) &&
        number(v.time) &&
        team(v.team) &&
        nullableString(v.player) &&
        [v.beforeHome, v.beforeAway, v.afterHome, v.afterAway].every(integer) &&
        v.afterHome === v.beforeHome + (v.team === 'home' ? 1 : 0) &&
        v.afterAway === v.beforeAway + (v.team === 'away' ? 1 : 0) &&
        v.effect === goalEffect(v) &&
        v.effect !== null &&
        refs.length === eventRefs.length &&
        eventRefs.length === v.afterHome + v.afterAway &&
        hasEvent(v.anchorId)
      );
    case 'recovery-before-shot':
      return (
        string(v.anchorId) &&
        string(v.recoveryId) &&
        team(v.team) &&
        interval(v) &&
        number(v.seconds) &&
        v.seconds === v.end - v.start &&
        refs.length === 2 &&
        eventRefs.length === 2 &&
        hasEvent(v.anchorId) &&
        hasEvent(v.recoveryId)
      );
    case 'completed-passes-between':
      return (
        string(v.anchorId) &&
        string(v.recoveryId) &&
        team(v.team) &&
        interval(v) &&
        integer(v.count) &&
        v.count > 0 &&
        refs.length === v.count + 2 &&
        eventRefs.length === refs.length &&
        hasEvent(v.anchorId) &&
        hasEvent(v.recoveryId)
      );
    case 'nearest-sampled-opponent':
      return (
        string(v.anchorId) &&
        number(v.time) &&
        string(v.playerId) &&
        string(v.opponentId) &&
        number(v.value) &&
        v.unit === 'metres' &&
        v.formula === 'euclidean-distance-v1' &&
        metricSupport &&
        refs.some((r) => r.type === 'frame')
      );
    case 'player-sample-displacement-rate':
      return (
        string(v.anchorId) &&
        string(v.playerId) &&
        interval(v) &&
        number(v.value) &&
        v.unit === 'metres/second' &&
        v.formula === 'sample-displacement-over-time-v1' &&
        metricSupport &&
        refs.filter((r) => r.type === 'frame').length >= 2
      );
    case 'pass-endpoint-displacement':
      return (
        string(v.anchorId) &&
        string(v.passId) &&
        v.anchorId !== v.passId &&
        interval(v) &&
        number(v.value) &&
        v.unit === 'metres' &&
        v.formula === 'ball-endpoint-displacement-v1' &&
        metricSupport &&
        hasEvent(v.passId) &&
        refs.filter((r) => r.type === 'frame').length >= 2
      );
    case 'shot-ball-sample-displacement-rate':
      return (
        string(v.anchorId) &&
        string(v.shotId) &&
        v.anchorId !== v.shotId &&
        interval(v) &&
        number(v.value) &&
        v.unit === 'metres/second' &&
        v.formula === 'shot-sample-displacement-over-time-v1' &&
        metricSupport &&
        hasEvent(v.shotId) &&
        refs.filter((r) => r.type === 'frame').length >= 2
      );
    case 'window-event-count':
      return (
        team(v.team) &&
        ['shots', 'completedPasses', 'pendingPasses', 'recoveries'].includes(v.category) &&
        integer(v.count) &&
        v.count > 0 &&
        number(v.start) &&
        number(v.end) &&
        v.start <= v.end &&
        v.inclusive === true &&
        refs.length === eventRefs.length &&
        refs.length === v.count
      );
    case 'window-shot-change':
      return (
        team(v.team) &&
        integer(v.previousCount) &&
        integer(v.recentCount) &&
        number(v.previousStart) &&
        number(v.previousEnd) &&
        v.previousEnd > v.previousStart &&
        v.recentStart === v.previousEnd &&
        number(v.recentEnd) &&
        v.recentEnd - v.recentStart === v.previousEnd - v.previousStart &&
        refs.length === eventRefs.length &&
        refs.length >= v.previousCount + v.recentCount &&
        ((v.direction === 'increase' &&
          v.recentCount >= 2 &&
          v.recentCount - v.previousCount >= 2) ||
          (v.direction === 'decrease' && v.previousCount >= 2 && v.recentCount === 0))
      );
    default:
      return false;
  }
}

const copy = {
  en: {
    goal: 'scored',
    miss: 'shot but did not score',
    pendingShot: 'took a shot (outcome pending)',
    shotOutcomes: {
      'off-target': 'missed the target',
      saved: 'had a shot saved',
      blocked: 'had a shot blocked',
      'on-target': 'had a shot on target',
    },
    completed: 'completed a pass',
    failed: 'made an unsuccessful pass',
    pendingPass: 'made a pass (outcome pending)',
    recovery: 'won possession',
    receive: 'received the ball',
    moment: (p, a, t, c) => `${p} ${a} for ${c} at ${t}.`,
    flightMoment: (p, t, c) =>
      `A ball-flight sample after ${p}’s shot for ${c} was captured at ${t}.`,
    score: (h, a, t) => `The score at ${t} was ${h}-${a}.`,
    scoreEffects: {
      equalized: 'equalized',
      'took-lead': 'took the lead',
      'extended-lead': 'extended its lead',
      'reduced-deficit': 'reduced the deficit',
    },
    scoreChange: (c, e, t, bh, ba, ah, aa) => `${c} ${e} at ${t}: ${bh}-${ba} → ${ah}-${aa}.`,
    recoveryBefore: (s, e, d, c) =>
      `${c} took a shot at ${e}, ${d} seconds after winning possession at ${s}.`,
    passes: (n, s, e, c) =>
      `${c} completed ${n} ${n === 1 ? 'pass' : 'passes'} between winning possession at ${s} and the shot at ${e}.`,
    player: 'the player',
    nearest: (p, n, t) =>
      `At ${t}, the nearest opponent to ${p} in the sampled positions was ${n} m away.`,
    rate: (p, n, s, e) =>
      `${p} moved at a sample displacement rate of ${n} m/s between ${s} and ${e}.`,
    passEndpoints: (n, s, e) =>
      `The sampled ball positions at the pass’s start and end were ${n} m apart (${s}–${e}).`,
    shotBallRate: (n, s, e) =>
      `After the shot, the ball’s sample displacement rate was ${n} m/s (${s}–${e}).`,
    categories: {
      shots: ['shot', 'shots'],
      completedPasses: ['completed pass', 'completed passes'],
      pendingPasses: ['pass with an unconfirmed outcome', 'passes with unconfirmed outcomes'],
      recoveries: ['possession recovery', 'possession recoveries'],
    },
    count: (c, n, k, s, e) => `${c}: ${n} ${k} from ${s} to ${e}.`,
    change: (c, a, b, s, m, e) =>
      `${c}: ${a} ${a === 1 ? 'shot' : 'shots'} from ${s} to ${m}, then ${b} ${b === 1 ? 'shot' : 'shots'} from ${m} to ${e}.`,
  },
  es: {
    goal: 'marcó',
    miss: 'remató sin marcar',
    pendingShot: 'remató (resultado pendiente)',
    shotOutcomes: {
      'off-target': 'no acertó a puerta',
      saved: 'tuvo un tiro detenido',
      blocked: 'tuvo un tiro bloqueado',
      'on-target': 'remató a puerta',
    },
    completed: 'completó un pase',
    failed: 'falló un pase',
    pendingPass: 'dio un pase (resultado pendiente)',
    recovery: 'recuperó la posesión',
    receive: 'recibió el balón',
    moment: (p, a, t, c) => `${p} ${a} para ${c} en ${t}.`,
    flightMoment: (p, t, c) =>
      `Se captó una muestra del vuelo del balón tras el tiro de ${p} para ${c} en ${t}.`,
    score: (h, a, t) => `El marcador en ${t} era ${h}-${a}.`,
    scoreEffects: {
      equalized: 'empató',
      'took-lead': 'se adelantó',
      'extended-lead': 'amplió su ventaja',
      'reduced-deficit': 'recortó la desventaja',
    },
    scoreChange: (c, e, t, bh, ba, ah, aa) => `${c} ${e} en ${t}: ${bh}-${ba} → ${ah}-${aa}.`,
    recoveryBefore: (s, e, d, c) =>
      `${c} remató en ${e}, ${d} segundos después de recuperar la posesión en ${s}.`,
    passes: (n, s, e, c) =>
      `${c} completó ${n} ${n === 1 ? 'pase' : 'pases'} entre recuperar la posesión en ${s} y el tiro en ${e}.`,
    player: 'el jugador',
    nearest: (p, n, t) =>
      `En ${t}, el rival más cercano a ${p} en las posiciones muestreadas estaba a ${n} m.`,
    rate: (p, n, s, e) =>
      `La tasa de desplazamiento entre muestras de ${p} fue de ${n} m/s entre ${s} y ${e}.`,
    passEndpoints: (n, s, e) =>
      `Las posiciones muestreadas del balón al inicio y al final del pase estaban a ${n} m (${s}–${e}).`,
    shotBallRate: (n, s, e) =>
      `Tras el tiro, la tasa de desplazamiento del balón entre muestras fue de ${n} m/s (${s}–${e}).`,
    categories: {
      shots: ['tiro', 'tiros'],
      completedPasses: ['pase completado', 'pases completados'],
      pendingPasses: ['pase con resultado sin confirmar', 'pases con resultado sin confirmar'],
      recoveries: ['recuperación de posesión', 'recuperaciones de posesión'],
    },
    count: (c, n, k, s, e) => `${c}: ${n} ${k} de ${s} a ${e}.`,
    change: (c, a, b, s, m, e) =>
      `${c}: ${a} ${a === 1 ? 'tiro' : 'tiros'} de ${s} a ${m}, y después ${b} ${b === 1 ? 'tiro' : 'tiros'} de ${m} a ${e}.`,
  },
  fr: {
    goal: 'a marqué',
    miss: 'a tiré sans marquer',
    pendingShot: 'a tiré (résultat en attente)',
    shotOutcomes: {
      'off-target': 'a manqué le cadre',
      saved: 'a vu son tir arrêté',
      blocked: 'a vu son tir contré',
      'on-target': 'a cadré son tir',
    },
    completed: 'a réussi une passe',
    failed: 'a manqué une passe',
    pendingPass: 'a fait une passe (résultat en attente)',
    recovery: 'a récupéré le ballon',
    receive: 'a reçu le ballon',
    moment: (p, a, t, c) => `${p} ${a} pour ${c} à ${t}.`,
    flightMoment: (p, t, c) =>
      `Une position du ballon en vol après le tir de ${p} pour ${c} a été échantillonnée à ${t}.`,
    score: (h, a, t) => `Le score à ${t} était de ${h}-${a}.`,
    scoreEffects: {
      equalized: 'a égalisé',
      'took-lead': 'a pris l’avantage',
      'extended-lead': 'a creusé l’écart',
      'reduced-deficit': 'a réduit l’écart',
    },
    scoreChange: (c, e, t, bh, ba, ah, aa) => `${c} ${e} à ${t} : ${bh}-${ba} → ${ah}-${aa}.`,
    recoveryBefore: (s, e, d, c) =>
      `${c} a tiré à ${e}, ${d} secondes après avoir récupéré le ballon à ${s}.`,
    passes: (n, s, e, c) =>
      `${c} a réussi ${n} ${n === 1 ? 'passe' : 'passes'} entre la récupération à ${s} et le tir à ${e}.`,
    player: 'le joueur',
    nearest: (p, n, t) =>
      `À ${t}, ${p} : adversaire le plus proche à ${n} m dans les positions échantillonnées.`,
    rate: (p, n, s, e) =>
      `${p} : taux de déplacement entre échantillons de ${n} m/s entre ${s} et ${e}.`,
    passEndpoints: (n, s, e) =>
      `Les positions échantillonnées du ballon au départ et à l’arrivée de la passe étaient distantes de ${n} m (${s}–${e}).`,
    shotBallRate: (n, s, e) =>
      `Après le tir, le taux de déplacement du ballon entre échantillons était de ${n} m/s (${s}–${e}).`,
    categories: {
      shots: ['tir', 'tirs'],
      completedPasses: ['passe réussie', 'passes réussies'],
      pendingPasses: ['passe au résultat non confirmé', 'passes aux résultats non confirmés'],
      recoveries: ['récupération du ballon', 'récupérations du ballon'],
    },
    count: (c, n, k, s, e) => `${c} : ${n} ${k} de ${s} à ${e}.`,
    change: (c, a, b, s, m, e) =>
      `${c} : ${a} ${a === 1 ? 'tir' : 'tirs'} de ${s} à ${m}, puis ${b} ${b === 1 ? 'tir' : 'tirs'} de ${m} à ${e}.`,
  },
  pt: {
    goal: 'marcou',
    miss: 'rematou sem marcar',
    pendingShot: 'rematou (resultado pendente)',
    shotOutcomes: {
      'off-target': 'rematou sem acertar na baliza',
      saved: 'teve um remate defendido',
      blocked: 'teve um remate bloqueado',
      'on-target': 'rematou à baliza',
    },
    completed: 'completou um passe',
    failed: 'falhou um passe',
    pendingPass: 'fez um passe (resultado pendente)',
    recovery: 'recuperou a posse',
    receive: 'recebeu a bola',
    moment: (p, a, t, c) => `${p} ${a} pelo ${c} em ${t}.`,
    flightMoment: (p, t, c) =>
      `Foi captada uma amostra do voo da bola após o remate de ${p} pelo ${c} em ${t}.`,
    score: (h, a, t) => `O resultado em ${t} era ${h}-${a}.`,
    scoreEffects: {
      equalized: 'empatou',
      'took-lead': 'passou para a frente',
      'extended-lead': 'ampliou a vantagem',
      'reduced-deficit': 'reduziu a desvantagem',
    },
    scoreChange: (c, e, t, bh, ba, ah, aa) => `${c} ${e} em ${t}: ${bh}-${ba} → ${ah}-${aa}.`,
    recoveryBefore: (s, e, d, c) =>
      `${c} rematou em ${e}, ${d} segundos depois de recuperar a posse em ${s}.`,
    passes: (n, s, e, c) =>
      `${c} completou ${n} ${n === 1 ? 'passe' : 'passes'} entre a recuperação da posse em ${s} e o remate em ${e}.`,
    player: 'o jogador',
    nearest: (p, n, t) =>
      `Em ${t}, ${p}: adversário mais próximo a ${n} m nas posições amostradas.`,
    rate: (p, n, s, e) =>
      `A taxa de deslocamento entre amostras de ${p} foi de ${n} m/s entre ${s} e ${e}.`,
    passEndpoints: (n, s, e) =>
      `As posições amostradas da bola no início e no fim do passe estavam a ${n} m (${s}–${e}).`,
    shotBallRate: (n, s, e) =>
      `Ap’s o remate, a taxa de deslocamento da bola entre amostras foi de ${n} m/s (${s}–${e}).`,
    categories: {
      shots: ['remate', 'remates'],
      completedPasses: ['passe completo', 'passes completos'],
      pendingPasses: ['passe com resultado por confirmar', 'passes com resultado por confirmar'],
      recoveries: ['recuperação de posse', 'recuperações de posse'],
    },
    count: (c, n, k, s, e) => `${c}: ${n} ${k} de ${s} a ${e}.`,
    change: (c, a, b, s, m, e) =>
      `${c}: ${a} ${a === 1 ? 'remate' : 'remates'} de ${s} a ${m}, depois ${b} ${b === 1 ? 'remate' : 'remates'} de ${m} a ${e}.`,
  },
};

function render(fact, language, facts, teams) {
  const v = fact.values,
    c = copy[language],
    club = teams[v.team],
    decimal = new Intl.NumberFormat(language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    });
  const namedMoment = facts.find(
    (candidate) =>
      candidate.kind === 'moment' &&
      candidate.values.anchorId === v.anchorId &&
      candidate.values.playerId === v.playerId &&
      string(candidate.values.player),
  );
  const subject = namedMoment?.values.player || c.player;
  switch (fact.kind) {
    case 'moment': {
      if (v.action === 'flight')
        return c.flightMoment(v.player || v.playerId || club, clock(v.time), club);
      const action =
        v.action === 'shot'
          ? v.outcome === 'goal'
            ? c.goal
            : v.outcome === 'no-goal'
              ? c.shotOutcomes[v.shotOutcome] || c.miss
              : c.pendingShot
          : v.action === 'pass'
            ? v.outcome === 'completed'
              ? c.completed
              : v.outcome === 'failed'
                ? c.failed
                : c.pendingPass
            : c[v.action];
      return c.moment(v.player || v.playerId || club, action, clock(v.time), club);
    }
    case 'score':
      return c.score(v.home, v.away, clock(v.time));
    case 'goal-score-change':
      return c.scoreChange(
        club,
        c.scoreEffects[v.effect],
        clock(v.time),
        v.beforeHome,
        v.beforeAway,
        v.afterHome,
        v.afterAway,
      );
    case 'recovery-before-shot':
      return c.recoveryBefore(clock(v.start), clock(v.end), v.seconds, club);
    case 'completed-passes-between':
      return c.passes(v.count, clock(v.start), clock(v.end), club);
    case 'nearest-sampled-opponent':
      return c.nearest(subject, decimal.format(v.value), clock(v.time));
    case 'player-sample-displacement-rate':
      return c.rate(subject, decimal.format(v.value), clock(v.start), clock(v.end));
    case 'pass-endpoint-displacement':
      return c.passEndpoints(decimal.format(v.value), clock(v.start), clock(v.end));
    case 'shot-ball-sample-displacement-rate':
      return c.shotBallRate(decimal.format(v.value), clock(v.start), clock(v.end));
    case 'window-event-count':
      return c.count(
        club,
        v.count,
        c.categories[v.category][v.count === 1 ? 0 : 1],
        clock(v.start),
        clock(v.end),
      );
    case 'window-shot-change':
      return c.change(
        club,
        v.previousCount,
        v.recentCount,
        clock(v.previousStart),
        clock(v.previousEnd),
        clock(v.recentEnd),
      );
  }
}

/** Render only explicitly selected deterministic facts, never supplied prose.
 * Spatial facts are allowed for every audience when explicitly selected;
 * selection policy belongs to the caller. Returned strings require UI escaping.
 */
export function renderFactStory(
  factCatalog,
  selectedFactIds,
  { language = 'en', audience = 'newcomer' } = {},
) {
  languagePreference(language);
  const teams = sourceTeams(factCatalog?.scope?.teams);
  if (!['newcomer', 'analyst', 'player', 'spatial'].includes(audience))
    throw new RangeError('Choose a supported story audience.');
  if (
    !factCatalog ||
    !Array.isArray(factCatalog.facts) ||
    factCatalog.facts.length > 12 ||
    factCatalog.facts.some((f) => !validFact(f)) ||
    new Set(factCatalog.facts.map((f) => f.id)).size !== factCatalog.facts.length
  )
    throw new TypeError('The fact catalog contains invalid or duplicate typed facts.');
  if (
    !Array.isArray(selectedFactIds) ||
    selectedFactIds.length < 1 ||
    selectedFactIds.length > 5 ||
    selectedFactIds.some((id) => !string(id)) ||
    new Set(selectedFactIds).size !== selectedFactIds.length
  )
    throw new RangeError('Select between one and five unique fact IDs.');
  const catalog = new Map(factCatalog.facts.map((f) => [f.id, f]));
  if (selectedFactIds.some((id) => !catalog.has(id)))
    throw new RangeError('A selected fact ID is not in the current catalog.');
  return {
    source: 'canonical-fact-templates',
    language,
    audience,
    claims: selectedFactIds.map((id) => {
      const fact = catalog.get(id);
      return {
        factId: id,
        text: render(fact, language, factCatalog.facts, teams),
        evidence: structuredClone(fact.evidence),
      };
    }),
    limitation:
      'Canonical wording from selected typed facts; no supplied or model-generated prose is used. Synthetic event order and sampled geometry do not establish tactical pressure, intent or causation. Sample displacement rates are interval measurements, not maximum speed or reconstructed paths. Pass endpoint separation is not path length. Received counts do not establish feed completeness. Measurement values are rounded to one decimal place. Match clocks display whole seconds. Event-count windows include both boundaries; comparative shot windows exclude the start and include the end. Translations have not been verified by native speakers.',
  };
}
