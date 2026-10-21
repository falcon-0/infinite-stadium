import { supportedFixtureKind } from './fixture-settings.js';
const kinds = new Set(['event', 'frame', 'metric']);
const languages = new Set(['en', 'es', 'fr', 'pt']),
  audiences = new Set(['newcomer', 'analyst', 'player', 'spatial']);
const string = (value) => typeof value === 'string' && value.length > 0 && value.length <= 700;
const refKey = (ref) => `${ref.type}:${ref.id}`;
const versionKey = (ref) => `${refKey(ref)}@${ref.revision}`;
const validRef = (ref) =>
  ref &&
  kinds.has(ref.type) &&
  string(ref.id) &&
  Number.isSafeInteger(ref.revision) &&
  ref.revision > 0;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
function normalizedPreferences(value) {
  if (
    !plain(value) ||
    !languages.has(value.language) ||
    !audiences.has(value.audience) ||
    !supportedFixtureKind(value.kind) ||
    !Number.isSafeInteger(value.seed) ||
    value.seed < 0 ||
    value.seed > 100000 ||
    ![undefined, null, 'home', 'away'].includes(value.favoriteClub) ||
    (value.favoritePlayer !== undefined &&
      value.favoritePlayer !== null &&
      (typeof value.favoritePlayer !== 'string' || value.favoritePlayer.length > 100))
  )
    return null;
  return {
    kind: value.kind,
    seed: value.seed,
    language: value.language,
    audience: value.audience,
    favoriteClub: value.favoriteClub ?? null,
    favoritePlayer: value.favoritePlayer?.trim() || null,
  };
}
function validateCue(cue) {
  if (
    !plain(cue) ||
    cue.schema !== 'infinite-stadium.studio-cue.v1' ||
    cue.synthetic !== true ||
    cue.status !== 'human-review-required' ||
    !string(cue.anchorId) ||
    typeof cue.evidenceKey !== 'string' ||
    !cue.evidenceKey ||
    cue.evidenceKey.length > 20000 ||
    !languages.has(cue.language) ||
    !audiences.has(cue.audience) ||
    !['azure-model', 'local-model'].includes(cue.authorship?.selection) ||
    cue.authorship?.wording !== 'application-fact-templates'
  )
    return 'unsupported-cue';
  const timing = cue.timing;
  if (
    !plain(timing) ||
    timing.unit !== 'seconds' ||
    timing.synchronization !== 'received-synthetic-replay' ||
    !Number.isFinite(timing.anchorEventTime) ||
    timing.anchorEventTime < 0 ||
    !Number.isFinite(timing.availableAtObservedTime) ||
    timing.availableAtObservedTime < timing.anchorEventTime ||
    !Number.isFinite(timing.durationSeconds) ||
    timing.durationSeconds < 1 ||
    timing.durationSeconds > 60 ||
    !Number.isFinite(timing.expiresAtObservedTime) ||
    timing.expiresAtObservedTime !== timing.availableAtObservedTime + timing.durationSeconds
  )
    return 'invalid-cue-timing';
  const maximum = ['newcomer', 'player'].includes(cue.audience) ? 3 : 5;
  if (
    !Array.isArray(cue.claims) ||
    cue.claims.length < 1 ||
    cue.claims.length > maximum ||
    !Array.isArray(cue.evidence) ||
    !cue.evidence.length ||
    cue.evidence.length > 10000
  )
    return 'invalid-cue-claims';
  const refs = new Map(),
    facts = new Set();
  for (const claim of cue.claims) {
    if (
      !plain(claim) ||
      !string(claim.factId) ||
      facts.has(claim.factId) ||
      !string(claim.text) ||
      !Array.isArray(claim.evidence) ||
      claim.evidence.length < 1 ||
      claim.evidence.length > 1000 ||
      claim.evidence.some((ref) => !validRef(ref)) ||
      new Set(claim.evidence.map(refKey)).size !== claim.evidence.length
    )
      return 'invalid-cue-claims';
    facts.add(claim.factId);
    for (const ref of claim.evidence) {
      const old = refs.get(refKey(ref));
      if (old && old.revision !== ref.revision) return 'conflicting-cue-revisions';
      refs.set(refKey(ref), ref);
    }
  }
  if (
    cue.evidence.some((ref) => !validRef(ref)) ||
    new Set(cue.evidence.map(refKey)).size !== cue.evidence.length ||
    cue.evidence.length !== refs.size ||
    cue.evidence.some((ref) => refs.get(refKey(ref))?.revision !== ref.revision)
  )
    return 'incomplete-cue-dependencies';
  if (!cue.claims[0].evidence.some((ref) => ref.type === 'event' && ref.id === cue.anchorId))
    return 'missing-leading-anchor';
  return null;
}

/** Capture the trusted export's full preferences, which the v1 cue does not
 * encode. This is a detached local preview snapshot, never an approval token.
 */
export function createStudioPreview(cue, { preferences } = {}) {
  return {
    schema: 'infinite-stadium.studio-preview.v1',
    cue: structuredClone(cue),
    preferences: structuredClone(preferences),
  };
}

/** Read-only live consumer. Materialize current references before calling.
 * Claims are returned only within an event-age-limited display window and
 * while every captured dependency/preference remains current. This validates
 * contract consistency, not signed provenance, template truth or completeness.
 */
export function studioPreviewState(
  preview,
  { time, receivedReferences, preferences, evidenceKey } = {},
) {
  const base = { previewPolicy: 'event-age-limited', publishing: false, claims: [] };
  const fail = (status, reason, extra = {}) => ({ ...base, status, reason, ...extra });
  if (!Number.isFinite(time) || time < 0) return fail('invalid', 'invalid-observation-time');
  if (!plain(preview) || preview.schema !== 'infinite-stadium.studio-preview.v1')
    return fail('invalid', 'invalid-preview-snapshot');
  const cue = preview.cue,
    invalid = validateCue(cue);
  if (invalid) return fail('invalid', invalid);
  const captured = normalizedPreferences(preview.preferences),
    current = normalizedPreferences(preferences);
  if (!captured || !current) return fail('invalid', 'missing-or-invalid-preferences');
  if (captured.language !== cue.language || captured.audience !== cue.audience)
    return fail('invalid', 'cue-preference-mismatch');
  const original = cue.timing,
    effectiveExpiresAt = Math.min(
      original.expiresAtObservedTime,
      original.anchorEventTime + original.durationSeconds,
    );
  const timing = { ...original, effectiveExpiresAt, previewPolicy: 'event-age-limited' };
  const context = {
    timing,
    anchorId: cue.anchorId,
    language: cue.language,
    audience: cue.audience,
    evidenceKey: cue.evidenceKey,
  };
  // Age limits are immutable; even a corrected/re-exported old event cannot revive.
  if (time >= effectiveExpiresAt) return fail('expired', 'event-display-window-ended', context);
  if (time < original.availableAtObservedTime)
    return fail('invalid', 'cue-not-yet-available', context);
  if (JSON.stringify(captured) !== JSON.stringify(current))
    return fail('superseded', 'preferences-changed', context);
  if (evidenceKey !== undefined && evidenceKey !== cue.evidenceKey)
    return fail('superseded', 'evidence-selection-changed', context);
  if (!receivedReferences || typeof receivedReferences[Symbol.iterator] !== 'function')
    return fail('invalid', 'missing-reference-inventory', context);
  const inventory = new Map();
  let count = 0;
  for (const ref of receivedReferences) {
    if (
      ++count > 10000 ||
      !validRef(ref) ||
      ![undefined, 'upsert', 'delete'].includes(ref.operation)
    )
      return fail('invalid', 'invalid-reference-inventory', context);
    if (ref.time !== undefined || ref.arrivedAt !== undefined) {
      if (
        !Number.isFinite(ref.time) ||
        ref.time < 0 ||
        !Number.isFinite(ref.arrivedAt) ||
        ref.arrivedAt < ref.time ||
        ref.time > time ||
        ref.arrivedAt > time
      )
        return fail('invalid', 'unreceived-reference-inventory', context);
    }
    const old = inventory.get(refKey(ref));
    if (
      old &&
      (old.revision !== ref.revision ||
        (old.operation === 'delete') !== (ref.operation === 'delete'))
    )
      return fail('invalid', 'conflicting-reference-inventory', context);
    inventory.set(refKey(ref), ref);
  }
  for (const ref of cue.evidence) {
    const now = inventory.get(refKey(ref));
    if (!now)
      return fail('superseded', 'dependency-unavailable', {
        ...context,
        dependency: { type: ref.type, id: ref.id, revision: ref.revision },
      });
    if (now.operation === 'delete')
      return fail('superseded', 'dependency-withdrawn', {
        ...context,
        dependency: { type: ref.type, id: ref.id, revision: ref.revision },
      });
    if (versionKey(now) !== versionKey(ref))
      return fail('superseded', 'dependency-revised', {
        ...context,
        dependency: { type: ref.type, id: ref.id, revision: ref.revision },
      });
  }
  return {
    ...base,
    ...context,
    status: 'visible',
    reason: 'current-received-cue',
    claims: structuredClone(cue.claims),
    reviewStatus: 'human-review-required',
    authorship: structuredClone(cue.authorship),
    limitation:
      'Local live preview only. A cue download retains its original review-artifact timing; this preview additionally caps display by event age. No publishing or model call occurs. Contract checks do not prove source completeness, provenance or real-world truth.',
  };
}
