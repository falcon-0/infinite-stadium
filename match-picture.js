import {
  recoveryClassification,
  recoveryClassificationVersion,
} from './recovery-classification.js';
import { sourceTeams } from './source-teams.js';
const labels = {
  en: {
    title: 'Match picture',
    team: 'Team',
    goals: 'Goals',
    shots: 'Shots',
    onTarget: 'Shots on target',
    completedPasses: 'Completed passes',
    passAccuracy: 'Pass accuracy',
    recoveries: 'Possession recoveries',
    unknown: 'Unknown shot outcomes',
    pending: 'Pending passes',
    scope: 'Received events so far',
  },
  es: {
    title: 'Panorama del partido',
    team: 'Equipo',
    goals: 'Goles',
    shots: 'Tiros',
    onTarget: 'Tiros a puerta',
    completedPasses: 'Pases completados',
    passAccuracy: 'Precisión de pases',
    recoveries: 'Recuperaciones de posesión',
    unknown: 'Resultados de tiros desconocidos',
    pending: 'Pases pendientes',
    scope: 'Eventos recibidos hasta ahora',
  },
  fr: {
    title: 'Vue du match',
    team: 'Équipe',
    goals: 'Buts',
    shots: 'Tirs',
    onTarget: 'Tirs cadrés',
    completedPasses: 'Passes réussies',
    passAccuracy: 'Précision des passes',
    recoveries: 'Récupérations du ballon',
    unknown: 'Résultats de tirs inconnus',
    pending: 'Passes en attente',
    scope: 'Événements reçus jusqu’ici',
  },
  pt: {
    title: 'Panorama do jogo',
    team: 'Equipa',
    goals: 'Golos',
    shots: 'Remates',
    onTarget: 'Remates à baliza',
    completedPasses: 'Passes completos',
    passAccuracy: 'Precisão dos passes',
    recoveries: 'Recuperações de posse',
    unknown: 'Resultados de remates desconhecidos',
    pending: 'Passes pendentes',
    scope: 'Eventos recebidos até agora',
  },
};
const limitations = {
  en: 'Counts cover received synthetic events, not proof of a complete match feed. Unknown shot outcomes and pending passes are shown separately. Pass accuracy uses only confirmed outcomes; blocked shots are not counted as on target. No possession share, expected goals or tactical pressure is inferred.',
  es: 'Los recuentos cubren eventos sintéticos recibidos y no garantizan datos completos. Los tiros de resultado desconocido y los pases pendientes se muestran por separado. La precisión usa solo pases confirmados; los tiros bloqueados no cuentan como tiros a puerta. No se infieren posesión, goles esperados ni presión táctica.',
  fr: 'Les comptes portent sur les événements synthétiques reçus, sans garantir un flux complet. Les tirs au résultat inconnu et les passes en attente sont séparés. La précision utilise les passes confirmées ; les tirs contrés ne sont pas cadrés. Aucune possession, probabilité de but ou pression tactique n’est déduite.',
  pt: 'As contagens abrangem eventos sintéticos recebidos, sem garantir dados completos. Remates de resultado desconhecido e passes pendentes aparecem separados. A precisão usa apenas passes confirmados; remates bloqueados não contam como remates à baliza. Não se inferem posse, golos esperados ou pressão tática.',
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const ref = (row) => ({ type: 'event', id: row.id, revision: row.revision });
const refs = (rows) => rows.map(ref).sort((a, b) => a.id.localeCompare(b.id));
const cell = (rows) => ({ value: rows.length, evidence: refs(rows) });

/** Pure comparison over received fictional event revisions. A current active
 * inventory is folded before any counting; historical versions never add up.
 */
export function matchPicture(records, time, { language = 'en', teams: explicitTeams } = {}) {
  if (
    !Array.isArray(records) ||
    records.length > 10000 ||
    !Number.isFinite(time) ||
    time < 0 ||
    !Object.hasOwn(labels, language)
  )
    throw new RangeError(
      'Provide bounded synthetic event records, a received time and a supported language.',
    );
  const versions = new Map(),
    latest = new Map(),
    encoder = new TextEncoder();
  let bytes = 0;
  for (const row of records) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.length > 300 ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !Number.isFinite(row.time) ||
      row.time < 0 ||
      !Number.isFinite(row.arrivedAt) ||
      row.arrivedAt < row.time ||
      !['upsert', 'delete', undefined].includes(row.operation) ||
      (row.operation !== 'delete' &&
        (!['shot', 'pass', 'receive', 'recovery', 'flight'].includes(row.type) ||
          !['home', 'away'].includes(row.team) ||
          (['shot', 'pass'].includes(row.type) &&
            ![true, false, null, undefined].includes(row.result))))
    )
      throw new RangeError('The synthetic event inventory contains an invalid revision.');
    let raw;
    try {
      raw = JSON.stringify(row);
      if (!raw || raw.length > 16384) throw new Error();
      bytes += encoder.encode(raw).length;
      if (bytes > 8388608) throw new Error();
    } catch {
      throw new RangeError('The synthetic event inventory exceeds its structural bound.');
    }
    if (row.time > time || row.arrivedAt > time) continue;
    const detached = JSON.parse(raw),
      content = JSON.stringify(canonical(detached)),
      identity = `${row.id}@${row.revision}`;
    if (versions.has(identity) && versions.get(identity) !== content)
      throw new RangeError('Conflicting contents share a received event revision.');
    versions.set(identity, content);
    if (!latest.has(row.id) || latest.get(row.id).revision < row.revision)
      latest.set(row.id, detached);
  }
  const active = [...latest.values()]
    .filter((row) => row.operation !== 'delete')
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const clubNames = sourceTeams(explicitTeams, active);
  const teams = ['home', 'away'].map((id) => {
    const own = active.filter((row) => row.team === id),
      shots = own.filter((row) => row.type === 'shot'),
      passes = own.filter((row) => row.type === 'pass');
    const goals = shots.filter((row) => row.result === true),
      onTarget = shots.filter(
        (row) =>
          row.result === true ||
          (row.result === false && ['saved', 'on-target'].includes(row.outcome)),
      );
    const knownShots = shots.filter(
      (row) =>
        row.result === true ||
        (row.result === false &&
          ['saved', 'on-target', 'blocked', 'off-target'].includes(row.outcome)),
    );
    const unknownShots = shots.filter((row) => !knownShots.includes(row));
    const completed = passes.filter((row) => row.result === true),
      knownPasses = passes.filter((row) => typeof row.result === 'boolean'),
      pending = passes.filter((row) => typeof row.result !== 'boolean');
    return {
      id,
      name: clubNames[id],
      cells: {
        goals: cell(goals),
        shots: cell(shots),
        onTarget: {
          ...cell(onTarget),
          knownCount: knownShots.length,
          unknownCount: unknownShots.length,
          knownEvidence: refs(knownShots),
          unknownEvidence: refs(unknownShots),
        },
        completedPasses: {
          ...cell(completed),
          pendingCount: pending.length,
          pendingEvidence: refs(pending),
        },
        passAccuracy: {
          value: knownPasses.length ? (completed.length / knownPasses.length) * 100 : null,
          knownCount: knownPasses.length,
          pendingCount: pending.length,
          evidence: refs(knownPasses),
          pendingEvidence: refs(pending),
        },
        recoveries: {
          ...cell(own.filter((row) => recoveryClassification(row) === 'ball-win')),
          unknownCount: own.filter((row) => recoveryClassification(row) === 'unknown').length,
          unknownEvidence: refs(own.filter((row) => recoveryClassification(row) === 'unknown')),
          complete: !own.some((row) => recoveryClassification(row) === 'unknown'),
          measurementVersion: recoveryClassificationVersion,
        },
      },
    };
  });
  const scope = { start: 0, end: time, observedAt: time, inclusive: true },
    evidence = refs(active);
  // Exact metric-relevant identity is synchronous and browser compatible.
  // This is a cache identity, not signed provenance or a security digest.
  const key =
    'match-picture:' +
    JSON.stringify(
      canonical({
        scope,
        teams: clubNames,
        records: active.map((row) => ({
          id: row.id,
          revision: row.revision,
          time: row.time,
          arrivedAt: row.arrivedAt,
          type: row.type,
          team: row.team,
          result: row.result ?? null,
          outcome: row.outcome ?? null,
          recoveryKind: row.recoveryKind ?? null,
        })),
      }),
    );
  return {
    source: 'received-synthetic-match-picture',
    synthetic: true,
    time,
    scope,
    labels: { ...labels[language] },
    language,
    teams,
    evidence,
    key,
    limitation: limitations[language],
  };
}
