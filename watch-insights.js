import { matchPicture } from './match-picture.js';
import { momentMeaning } from './moment-meaning.js';

/** Editorial selection, not model-generated commentary. Pass the complete
 * received event history to preserve corrections and withdrawals. A quiet
 * result explicitly tells the view to remove its previous automatic insight.
 * Explicitly selected historical moments belong to a separate UI state.
 */
export function chooseWatchInsight(records, observedAt, { language = 'en', duration = 12 } = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30)
    throw new RangeError('Insight duration must be between 0 and 30 seconds.');
  const picture = matchPicture(records, observedAt, { language });
  const inventory = new Map(
    records
      .filter((row) => row.arrivedAt <= observedAt && row.time <= observedAt)
      .map((row) => [`${row.id}@${row.revision}`, row]),
  );
  const active = picture.evidence.map((ref) => inventory.get(`${ref.id}@${ref.revision}`));
  const rank = (row) =>
    row.type === 'shot' ? (row.result === true ? 3 : 2) : row.type === 'recovery' ? 1 : 0;
  // A recovery is promoted only when a recent opposing unsuccessful pass is
  // recorded. This is a sequence, not proof the recovery caused that failure.
  const turnover = (row) =>
    active.find(
      (previous) =>
        previous.type === 'pass' &&
        previous.result === false &&
        previous.team !== row.team &&
        previous.time < row.time &&
        previous.time >= row.time - 6,
    );
  const eligible = active.filter(
    (row) =>
      rank(row) > 0 &&
      observedAt < row.arrivedAt + duration &&
      (row.type !== 'recovery' || turnover(row)),
  );
  eligible.sort(
    (a, b) =>
      rank(b) - rank(a) || b.time - a.time || b.arrivedAt - a.arrivedAt || a.id.localeCompare(b.id),
  );
  const event = eligible[0];
  if (!event)
    return {
      status: 'quiet',
      anchorId: null,
      revision: null,
      key: 'watch:quiet',
      event: null,
      meaning: null,
      reason: 'no-recent-significant-event',
      expiresAt: null,
    };
  const meaning = momentMeaning(records, event.id, { observedAt, language });
  const reason =
    event.type === 'shot' ? (event.result === true ? 'goal' : 'shot') : 'possession-recovery';
  // Include evidence revisions so corrections to buildup or score also refresh
  // the displayed interpretation, even if the anchor itself did not change.
  const key = JSON.stringify({
    anchorId: event.id,
    revision: event.revision,
    language,
    evidence: meaning.evidence,
    headline: meaning.headline,
    why: meaning.why,
    buildup: meaning.buildup,
  });
  return {
    status: 'insight',
    anchorId: event.id,
    revision: event.revision,
    key,
    event: structuredClone(event),
    meaning,
    reason,
    expiresAt: event.arrivedAt + duration,
  };
}

// Compact automatic context for the Watch banner. This is deterministic match
// explanation, not model prose; the action headline remains independently live.
export function watchExplanation(records, observedAt, { language = 'en', playbackRate = 1 } = {}) {
  if (!Number.isFinite(playbackRate) || playbackRate < 1 || playbackRate > 12)
    throw new RangeError('Choose a replay rate between 1 and 12.');
  const rows = Array.from(records),
    insight = chooseWatchInsight(rows, observedAt, {
      language,
      duration: Math.min(30, 8 * playbackRate),
    });
  const event = insight.event;
  if (!event || !insight.meaning?.why) return null;
  // Never announce an outcome while the displayed ball is still in flight,
  // or interpret an unconfirmed shot as a miss.
  if (event.type === 'shot' && (event.result === null || observedAt < event.time + 1)) return null;
  const goal = event.type === 'shot' && event.result === true;
  return {
    anchorId: event.id,
    revision: event.revision,
    time: event.time,
    expiresAt: insight.expiresAt,
    text: goal ? insight.meaning.title + '. ' + insight.meaning.why : insight.meaning.why,
    evidence: insight.meaning.evidence,
  };
}
