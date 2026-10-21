// Transparent editorial policy for received evidence, not a learned importance score.
export function selectLiveStory(records, time, preferences = {}) {
  const events = [...records].filter(
    (e) => e.time <= time && e.arrivedAt <= time && e.operation !== 'delete',
  );
  const candidates = events.filter(
    (e) =>
      ['shot', 'receive', 'recovery', 'pass'].includes(e.type) &&
      time - e.time < (e.type === 'shot' ? 20 : 10),
  );
  const ranked = candidates
    .map((e) => {
      const favorite =
        e.team === preferences.favoriteClub || e.player === preferences.favoritePlayer;
      const base =
        e.type === 'shot'
          ? e.result === true
            ? 100
            : 70
          : e.type === 'receive'
            ? 35
            : e.type === 'recovery'
              ? 30
              : 20;
      return {
        event: e,
        rank: base + (favorite ? 12 : 0) - (time - e.time),
        reason:
          e.type === 'shot'
            ? e.result === true
              ? 'Recent goal'
              : 'Recent shot'
            : favorite
              ? 'Recent involvement from your selection'
              : 'Recent passage of play',
      };
    })
    .sort(
      (a, b) =>
        b.rank - a.rank || b.event.time - a.event.time || a.event.id.localeCompare(b.event.id),
    );
  return ranked[0] || null;
}

export function momentScene(explanation) {
  if (!explanation) return { frame: null, participants: [], names: {} };
  const anchor = explanation.sequence.find((e) => e.id === explanation.anchorId);
  // Never substitute a newer frame or estimate missing positions for a selected event.
  const frame = explanation.frame?.time === anchor?.time ? explanation.frame : null;
  const participants = [
    ...new Set(explanation.sequence.flatMap((e) => [e.playerId, e.receiverId]).filter(Boolean)),
  ];
  const names = Object.fromEntries(
    explanation.sequence.filter((e) => e.playerId && e.player).map((e) => [e.playerId, e.player]),
  );
  return { frame, participants, names, eventTime: anchor?.time };
}
