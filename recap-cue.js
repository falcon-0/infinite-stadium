import { createHash } from 'node:crypto';
import { createRecapFacts } from './recap-facts.js';
import { renderRecapFacts } from './recap-renderer.js';
import { currentRecap } from './recap-view.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const validRef = (ref) =>
  object(ref) &&
  ref.type === 'event' &&
  typeof ref.id === 'string' &&
  ref.id.length > 0 &&
  ref.id.length <= 700 &&
  Number.isSafeInteger(ref.revision) &&
  ref.revision > 0;
const refKey = (ref) => `${ref.type}:${ref.id}@${ref.revision}`;
const sameRefs = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every(validRef) &&
  b.every(validRef) &&
  new Set(a.map(refKey)).size === a.length &&
  new Set(b.map(refKey)).size === b.length &&
  equal(a.map(refKey).sort(), b.map(refKey).sort());
const exactFields = (value, fields) =>
  object(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));

/** A detached, server-validated review rundown, never a publishing command.
 * Source snapshots are reconstructed once from the requested synthetic fixture;
 * complete received record bodies are checked as well as their revision IDs.
 * The hash identifies dependencies, not signed authenticity or real-world truth.
 */
export function buildRecapCue(draft, options = {}) {
  if (!exactFields(options, ['records', 'time', 'preferences', 'requestKey']))
    throw new TypeError(
      'Provide only records, time, preferences and requestKey for the recap cue.',
    );
  const { records, time, preferences, requestKey } = options;
  if (
    !object(preferences) ||
    Object.keys(preferences).some(
      (key) =>
        !['kind', 'seed', 'audience', 'language', 'favoriteClub', 'favoritePlayer'].includes(key),
    ) ||
    !['kind', 'seed', 'audience', 'language'].every((field) => Object.hasOwn(preferences, field)) ||
    !Number.isFinite(time) ||
    time < 0 ||
    typeof requestKey !== 'string' ||
    !requestKey ||
    requestKey.length > 30000
  )
    throw new TypeError(
      'Use current fixture, seed, audience, language and favorite preferences with a received time and request identity.',
    );
  if (
    !draft ||
    draft.status !== 'draft' ||
    draft.evidenceSource !== 'integrated-match' ||
    !['azure', 'local'].includes(draft.provider) ||
    draft.source !==
      (draft.provider === 'azure'
        ? 'azure-recap-fact-workflow'
        : 'microsoft-agent-framework-ollama-recap-fact-workflow') ||
    draft.authorship?.selection !== `${draft.provider}-model` ||
    draft.authorship?.additionalContext !== `${draft.provider}-model` ||
    draft.authorship?.mandatoryFacts !== 'application-domain-rules' ||
    draft.authorship?.wording !== 'application-fact-templates'
  )
    throw new TypeError(
      'Only a current canonical AI-selected recap draft can become a review rundown.',
    );
  if (!records || typeof records[Symbol.iterator] !== 'function')
    throw new TypeError('Provide the full current active received event inventory.');
  const active = [],
    ids = new Set();
  for (const record of records) {
    if (
      active.length >= 10000 ||
      !object(record) ||
      typeof record.id !== 'string' ||
      !record.id ||
      record.id.length > 700 ||
      ids.has(record.id) ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1 ||
      ![undefined, 'upsert'].includes(record.operation) ||
      !Number.isFinite(record.time) ||
      record.time < 0 ||
      record.time > time ||
      !Number.isFinite(record.arrivedAt) ||
      record.arrivedAt < record.time ||
      record.arrivedAt > time
    )
      throw new RangeError(
        'The recap cue needs a bounded, materialized active inventory of received event revisions.',
      );
    ids.add(record.id);
    active.push(record);
  }
  if (!currentRecap(draft, { records: active, time, preferences, requestKey }))
    throw new RangeError(
      'The recap is superseded: received inventory, time, fixture or preferences changed.',
    );
  let prepared;
  try {
    prepared = createRecapFacts({
      source: 'integrated-match',
      mode: 'recap',
      time,
      ...preferences,
    });
  } catch {
    throw new RangeError('The requested current synthetic recap scope is invalid or unavailable.');
  }
  const recordKey =
    'recap:' +
    createHash('sha256')
      .update(
        JSON.stringify(
          canonical({
            scope: prepared.scope,
            preferences: prepared.preferences,
            records: [...active].sort((a, b) => a.id.localeCompare(b.id)),
          }),
        ),
      )
      .digest('hex');
  if (
    recordKey !== prepared.key ||
    draft.key !== prepared.key ||
    !equal(draft.scope, prepared.scope) ||
    draft.observedAt !== time ||
    !equal(draft.preferences, prepared.preferences) ||
    !sameRefs(draft.dependencies, prepared.dependencies)
  )
    throw new RangeError(
      'The recap does not match current canonical record contents, scope or complete dependencies.',
    );
  if (
    !Array.isArray(draft.selectedFactIds) ||
    !Array.isArray(draft.selectedFacts) ||
    draft.selectedFacts.length !== draft.selectedFactIds.length
  )
    throw new TypeError('The recap needs its current selected canonical facts.');
  const available = new Map(prepared.catalog.facts.map((fact) => [fact.id, fact]));
  if (
    draft.selectedFacts.some(
      (fact, index) =>
        fact?.id !== draft.selectedFactIds[index] ||
        !available.has(fact.id) ||
        !equal(fact, available.get(fact.id)),
    )
  )
    throw new RangeError('The selected recap facts are unknown, modified or superseded.');
  let rendered;
  try {
    rendered = renderRecapFacts(prepared.catalog, draft.selectedFactIds, {
      language: prepared.language.code,
      audience: prepared.audience,
    });
  } catch {
    throw new RangeError(
      'Select bounded current recap facts with the overview first and goal changes in chronological order.',
    );
  }
  if (
    !Array.isArray(draft.claims) ||
    draft.claims.length !== rendered.claims.length ||
    draft.claims.some(
      (claim, index) =>
        !exactFields(claim, ['factId', 'text', 'evidence']) ||
        claim.factId !== rendered.claims[index].factId ||
        claim.text !== rendered.claims[index].text ||
        !sameRefs(claim.evidence, rendered.claims[index].evidence),
    )
  )
    throw new RangeError(
      'Recap claims must preserve canonical wording and every exact supporting reference.',
    );
  const overview = prepared.catalog.facts[0],
    latest = prepared.catalog.facts.filter((f) => f.kind === 'recap-goal-score-change').at(-1);
  const requiredGoal =
    latest &&
    latest.values.afterHome === overview.values.home &&
    latest.values.afterAway === overview.values.away
      ? latest
      : null;
  const requiredPlayer =
    prepared.audience === 'player'
      ? prepared.catalog.facts.find(
          (f) =>
            f.kind === 'recap-player-actions' &&
            f.values.player === prepared.preferences.favoritePlayer,
        )
      : null;
  if (
    (requiredGoal && !draft.selectedFactIds.includes(requiredGoal.id)) ||
    (requiredPlayer && !draft.selectedFactIds.includes(requiredPlayer.id))
  )
    throw new RangeError(
      'The recap rundown must include the latest supported recorded-score change and any required favorite-player profile.',
    );
  const union = new Map();
  for (const claim of rendered.claims)
    for (const ref of claim.evidence) union.set(refKey(ref), ref);
  const evidence = [...union.values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
  if (!sameRefs(evidence, prepared.dependencies))
    throw new RangeError(
      'The recap overview and claim union must cover the complete current received inventory.',
    );
  const cuePreferences = {
    kind: preferences.kind,
    seed: preferences.seed,
    audience: prepared.audience,
    language: prepared.language.code,
    favoriteClub: prepared.preferences.favoriteClub,
    favoritePlayer: prepared.preferences.favoritePlayer,
  };
  const segments = rendered.claims.map((claim, index) => {
    const fact = available.get(claim.factId),
      values = fact.values;
    return {
      order: index + 1,
      factId: fact.id,
      kind: fact.kind,
      text: claim.text,
      evidence: claim.evidence,
      eventTime: fact.kind === 'recap-goal-score-change' ? values.time : null,
      eventWindow:
        fact.kind === 'recap-goal-score-change'
          ? null
          : { start: values.start ?? 0, end: values.end ?? time, inclusive: true },
      timing: {
        unit: 'seconds',
        startOffsetSeconds: index * 6,
        durationSeconds: 6,
        endOffsetSeconds: (index + 1) * 6,
      },
    };
  });
  // Explicit allowlist: execution traces, access inputs and unverified stylistic
  // suggestions are deliberately absent from this factual review artifact.
  return structuredClone({
    schema: 'infinite-stadium.recap-cue.v1',
    source: 'received-synthetic-segment-recap',
    synthetic: true,
    status: 'human-review-required',
    evidenceKey: prepared.key,
    requestKey,
    scope: prepared.scope,
    preferences: cuePreferences,
    audience: prepared.audience,
    language: prepared.language.code,
    overview: overview.values,
    authorship: {
      selection: draft.authorship.selection,
      mandatoryFacts: 'application-domain-rules',
      additionalContext: draft.authorship.additionalContext,
      wording: 'application-fact-templates',
    },
    dependencies: prepared.dependencies,
    evidence,
    segments,
    timing: {
      unit: 'seconds',
      availableAtObservedTime: time,
      durationSeconds: segments.length * 6,
      synchronization: 'reviewed-rundown-relative',
      pacing: 'proposed-six-seconds-per-segment',
      livePublishing: false,
    },
    limitation:
      'Detached review rundown for a received synthetic segment, not a full match, signed provenance or a publishing command. Six seconds per segment is proposed review pacing, not live overlay availability or expiration. Exact references do not establish feed completeness, real-world truth or translation quality. Human review is required.',
  });
}
