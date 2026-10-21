import { matchPicture } from './match-picture.js';

// Use revision history, not the newest inventory: a correction received ahead
// of the display cursor must not reveal a goal or save before the viewer sees it.
export function watchSnapshot(records, time) {
  const picture = matchPicture(Array.from(records), time);
  const score = {},
    totals = {};
  for (const team of picture.teams) {
    const cells = team.cells;
    score[team.id] = cells.goals.value;
    totals[team.id] = {
      shots: cells.shots.value,
      onTarget: cells.onTarget.value,
      completedPasses: cells.completedPasses.value,
      ballWins: cells.recoveries.value,
      ...(cells.recoveries.unknownCount ? { ballWinsUnknown: cells.recoveries.unknownCount } : {}),
    };
  }
  return { time, score, totals };
}
