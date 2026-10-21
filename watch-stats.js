import { recoveryClassification } from './recovery-classification.js';
// Compact current received-event totals; revision folding is the caller's job.
export function watchStats(events) {
  const totals = {
    home: { shots: 0, onTarget: 0, completedPasses: 0, ballWins: 0 },
    away: { shots: 0, onTarget: 0, completedPasses: 0, ballWins: 0 },
  };
  for (const e of events) {
    const own = totals[e.team];
    if (!own || e.operation === 'delete') continue;
    if (e.type === 'shot') {
      own.shots++;
      if (e.result === true || (e.result === false && ['saved', 'on-target'].includes(e.outcome)))
        own.onTarget++;
    }
    if (e.type === 'pass' && e.result === true) own.completedPasses++;
    // Opening possession establishes the segment's starting state; no ball was won.
    const recoveryClass = recoveryClassification(e);
    if (recoveryClass === 'ball-win') own.ballWins++;
    if (recoveryClass === 'unknown') own.ballWinsUnknown = (own.ballWinsUnknown || 0) + 1;
  }
  return totals;
}
