import { createHash } from 'node:crypto';
import { integratedMatch } from './match-stream.js';
import { narrativePreferences } from './narratives.js';
import { languagePreference } from './localization.js';
import { GenerationError } from './ai.js';
import { supportedFixtureKind, fixtureTeams } from './fixture-settings.js';
import { isSafePlayerName } from './viewer-preferences.js';
import {
  recoveryClassification,
  recoveryClassificationVersion,
} from './recovery-classification.js';

const order = (a, b) => a.time - b.time || a.id.localeCompare(b.id);
const reference = (e) => ({ type: 'event', id: e.id, revision: e.revision });
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
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const references = (events) => events.map(reference).sort((a, b) => a.id.localeCompare(b.id));

/** Whole supplied-event inventory, separate from a selected moment's rolling
 * window. Application facts describe received synthetic records, not full-match
 * completeness or why a goal occurred. No model calls are made here. */
export function createRecapFacts(input) {
  if (!input || input.source !== 'integrated-match')
    throw new GenerationError('Choose an integrated synthetic segment recap.', 400);
  const audience = input.audience ?? 'newcomer';
  let bundle;
  try {
    bundle = integratedMatch({
      ...input,
      audience: audience === 'spatial' ? 'newcomer' : audience,
    });
  } catch {
    throw new GenerationError('Choose valid synthetic segment recap settings.', 400);
  }
  return buildRecapFacts(bundle, input);
}

/** Exported for received revision/deletion contract tests; derives counts from
 * event inventory rather than trusting aggregate stats supplied in a bundle. */
export function buildRecapFacts(bundle, input = {}) {
  const state = bundle?.state,
    metadata = state?.metadata,
    observedAt = state?.time;
  const audience = input.audience ?? 'newcomer';
  let preferences, language;
  try {
    if (!['newcomer', 'analyst', 'player', 'spatial'].includes(audience)) throw new RangeError();
    language = languagePreference(input.language ?? 'en');
    preferences = {
      ...narrativePreferences({
        ...input,
        audience: audience === 'spatial' ? 'newcomer' : audience,
      }),
      audience,
    };
  } catch {
    throw new GenerationError('Choose valid recap audience, language and preferences.', 400);
  }
  if (
    !state ||
    !Array.isArray(state.events) ||
    !metadata ||
    !supportedFixtureKind(metadata.kind) ||
    !Number.isInteger(metadata.seed) ||
    metadata.seed < 0 ||
    metadata.seed > 100000 ||
    !Number.isFinite(observedAt) ||
    observedAt < 0 ||
    !Number.isFinite(metadata.segmentDuration) ||
    metadata.segmentDuration <= 0 ||
    !Number.isFinite(metadata.observationHorizon) ||
    metadata.observationHorizon < metadata.segmentDuration ||
    observedAt > metadata.observationHorizon
  )
    throw new GenerationError('Provide a valid received synthetic recap scope.', 400);
  const teams = metadata.teams ?? fixtureTeams(metadata.kind, metadata.seed);
  if (
    !teams ||
    typeof teams !== 'object' ||
    Array.isArray(teams) ||
    Object.keys(teams).length !== 2 ||
    !['home', 'away'].every(
      (team) => Object.hasOwn(teams, team) && isSafePlayerName(teams[team]),
    ) ||
    teams.home === teams.away
  )
    throw new GenerationError('Provide bounded current match club names.', 400);
  const latest = new Map(),
    versions = new Map();
  for (const event of state.events) {
    if (
      !event ||
      typeof event.id !== 'string' ||
      !event.id ||
      !Number.isSafeInteger(event.revision) ||
      event.revision < 1 ||
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      !Number.isFinite(event.arrivedAt) ||
      event.arrivedAt < event.time ||
      ![undefined, 'upsert', 'delete'].includes(event.operation) ||
      (event.operation !== 'delete' &&
        (!['home', 'away'].includes(event.team) ||
          !['pass', 'shot', 'recovery', 'receive', 'flight'].includes(event.type)))
    )
      throw new GenerationError('Invalid received recap event record.', 400);
    if (event.arrivedAt > observedAt) continue;
    const identity = `${event.id}@${event.revision}`,
      content = hash(event);
    if (versions.has(identity) && versions.get(identity) !== content)
      throw new GenerationError('Conflicting recap event revision.', 400);
    versions.set(identity, content);
    if (!latest.has(event.id) || latest.get(event.id).revision < event.revision)
      latest.set(event.id, structuredClone(event));
  }
  const events = [...latest.values()]
    .filter((e) => e.operation !== 'delete' && e.time <= observedAt)
    .sort(order);
  if (!events.length)
    throw new GenerationError('No received events are available for this segment recap.', 400);
  const scope = {
    task: 'recap',
    observedAt,
    teams: { home: teams.home, away: teams.away },
    fixture: {
      kind: metadata.kind,
      seed: metadata.seed,
      segmentDuration: metadata.segmentDuration,
      observationHorizon: metadata.observationHorizon,
      synthetic: true,
    },
  };
  const dependencies = references(events),
    facts = [];
  const add = (kind, values, support) => {
    const evidence = references(support),
      id = `recap-fact-${hash({ kind, values, evidence }).slice(0, 24)}`;
    facts.push({ id, kind, values, evidence });
  };
  const goals = events.filter((e) => e.type === 'shot' && e.result === true);
  add(
    'recap-overview',
    {
      home: goals.filter((e) => e.team === 'home').length,
      away: goals.filter((e) => e.team === 'away').length,
      observedAt,
      segmentDuration: metadata.segmentDuration,
      status: observedAt >= metadata.segmentDuration ? 'demo-segment-complete' : 'in-progress',
      eventCount: events.length,
      firstEventTime: events[0].time,
      lastEventTime: events.at(-1).time,
    },
    events,
  );
  for (const team of ['home', 'away']) {
    const shots = events.filter((e) => e.team === team && e.type === 'shot');
    if (shots.length)
      add('recap-team-shots', { team, count: shots.length, start: 0, end: observedAt }, shots);
  }
  for (const team of ['home', 'away']) {
    const passes = events.filter((e) => e.team === team && e.type === 'pass');
    if (passes.length) {
      const completed = passes.filter((e) => e.result === true).length,
        failed = passes.filter((e) => e.result === false).length;
      add(
        'recap-team-passes',
        {
          team,
          total: passes.length,
          known: completed + failed,
          completed,
          failed,
          pending: passes.length - completed - failed,
          start: 0,
          end: observedAt,
        },
        passes,
      );
    }
  }
  const unambiguous = goals
    .filter((goal) => !goals.some((other) => other.id !== goal.id && other.time === goal.time))
    .slice(-3);
  for (const anchor of unambiguous) {
    const through = goals.filter((e) => e.time <= anchor.time),
      before = through.filter((e) => e.id !== anchor.id);
    const beforeHome = before.filter((e) => e.team === 'home').length,
      beforeAway = before.filter((e) => e.team === 'away').length;
    const own = anchor.team === 'home' ? beforeHome : beforeAway,
      other = anchor.team === 'home' ? beforeAway : beforeHome;
    add(
      'recap-goal-score-change',
      {
        anchorId: anchor.id,
        time: anchor.time,
        team: anchor.team,
        player: anchor.player ?? null,
        beforeHome,
        beforeAway,
        afterHome: beforeHome + (anchor.team === 'home' ? 1 : 0),
        afterAway: beforeAway + (anchor.team === 'away' ? 1 : 0),
        effect:
          own === other
            ? 'took-lead'
            : own === other - 1
              ? 'equalized'
              : own > other
                ? 'extended-lead'
                : 'reduced-deficit',
      },
      through,
    );
  }
  if (preferences.favoritePlayer) {
    const player = preferences.favoritePlayer,
      actions = events.filter((e) => e.player === player && e.type !== 'flight');
    // A saved display choice is not roster evidence. Only observed actors get
    // a player recap fact; a stale favourite must not become a zero-action player.
    const identities = [...new Set(actions.map((event) => `${event.team}:${event.playerId}`))];
    const validIds = actions.every(
      (event) =>
        typeof event.playerId === 'string' &&
        event.playerId.length > 0 &&
        event.playerId.length <= 100,
    );
    const actor = actions[0];
    const conflicting =
      actor &&
      events.some(
        (event) =>
          event.playerId === actor.playerId &&
          (event.team !== actor.team || event.player !== player),
      );
    if (actions.length && validIds && identities.length === 1 && !conflicting) {
      const team = actor.team,
        playerId = actor.playerId;
      add(
        'recap-player-actions',
        {
          player,
          playerId,
          team,
          total: actions.length,
          shots: actions.filter((e) => e.type === 'shot').length,
          goals: actions.filter((e) => e.type === 'shot' && e.result === true).length,
          passes: actions.filter((e) => e.type === 'pass').length,
          completedPasses: actions.filter((e) => e.type === 'pass' && e.result === true).length,
          pendingPasses: actions.filter((e) => e.type === 'pass' && typeof e.result !== 'boolean')
            .length,
          recoveries: actions.filter((e) => e.type === 'recovery').length,
          ballWins: actions.filter((e) => recoveryClassification(e) === 'ball-win').length,
          initialControls: actions.filter((e) => recoveryClassification(e) === 'initial-control')
            .length,
          unknownRecoveries: actions.filter((e) => recoveryClassification(e) === 'unknown').length,
          recoveryClassificationVersion,
          involvement: 'recorded',
          start: 0,
          end: observedAt,
        },
        actions,
      );
    }
  }
  const key = `recap:${hash({ scope, preferences, records: [...latest.values()].sort((a, b) => a.id.localeCompare(b.id)) })}`;
  return {
    catalog: {
      facts,
      scope,
      limitation:
        'A recap of the supplied received synthetic segment, not a full match. Counts do not prove feed completeness. Goal score changes describe chronology, not causes or a final real-match winner. Player counts cover named actor records, excluding ball-flight samples.',
    },
    key,
    preferences,
    audience,
    language,
    scope,
    dependencies,
  };
}
