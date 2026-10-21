import { recoveryClassification } from './recovery-classification.js';
// Follow only explicit received action links. No nearest-event joins, pressure
// attribution, possession estimates or inferred assist credit.
export function linkedGoalStory(goal, events, { language = 'en', name, clock } = {}) {
  if (goal.proof.actionOutcome?.status !== 'goal' || !goal.row.passId) return null;
  const chain = [goal],
    seen = new Set([goal.row.id]);
  let current = events.get(goal.row.passId),
    receiver = goal.row.playerId,
    recovery = null;
  while (current && chain.length < 12) {
    const row = current.row;
    if (seen.has(row.id) || row.team !== goal.row.team || row.time >= chain.at(-1).row.time)
      return null;
    seen.add(row.id);
    chain.push(current);
    if (row.type === 'pass') {
      if (
        current.proof.actionOutcome?.status !== 'completed' ||
        current.proof.recipient?.status !== 'confirmed-recipient' ||
        current.proof.recipient.playerId !== receiver
      )
        return null;
      receiver = row.playerId;
      current = events.get(row.cause);
    } else if (row.type === 'receive') {
      if (row.playerId !== receiver || !row.passId || (row.cause && row.cause !== row.passId))
        return null;
      current = events.get(row.passId);
    } else if (row.type === 'recovery') {
      if (row.playerId !== receiver || recoveryClassification(row) !== 'ball-win') return null;
      recovery = current;
      break;
    } else return null;
  }
  const passes = chain.filter((item) => item.row.type === 'pass').reverse();
  if (!recovery || passes.length < 1) return null;
  const first = passes[0],
    last = passes.at(-1),
    starter = name(recovery.row.playerId),
    scorer = name(goal.row.playerId),
    at = clock(goal.row.time);
  const start = {
    en: `${starter} recovered the ball and passed to ${name(first.proof.recipient.playerId)}.`,
    es: `${starter} recuperó el balón y pasó a ${name(first.proof.recipient.playerId)}.`,
    fr: `${starter} a récupéré le ballon et a passé à ${name(first.proof.recipient.playerId)}.`,
    pt: `${starter} recuperou a bola e passou a ${name(first.proof.recipient.playerId)}.`,
  }[language];
  const middle = passes.slice(1, -1).map(
    (item) =>
      ({
        en: `${name(item.row.playerId)} passed to ${name(item.proof.recipient.playerId)}.`,
        es: `${name(item.row.playerId)} pasó a ${name(item.proof.recipient.playerId)}.`,
        fr: `${name(item.row.playerId)} a passé à ${name(item.proof.recipient.playerId)}.`,
        pt: `${name(item.row.playerId)} passou a ${name(item.proof.recipient.playerId)}.`,
      })[language],
  );
  const finish = {
    en: `${name(last.row.playerId)} then passed to ${scorer}, who scored at ${at}.`,
    es: `${name(last.row.playerId)} pasó entonces a ${scorer}, que marcó a las ${at}.`,
    fr: `${name(last.row.playerId)} a ensuite passé à ${scorer}, qui a marqué à ${at}.`,
    pt: `${name(last.row.playerId)} passou então a ${scorer}, que marcou aos ${at}.`,
  }[language];
  const single = {
    en: `${starter} recovered the ball and passed to ${scorer}, who scored at ${at}.`,
    es: `${starter} recuperó el balón y pasó a ${scorer}, que marcó a las ${at}.`,
    fr: `${starter} a récupéré le ballon et a passé à ${scorer}, qui a marqué à ${at}.`,
    pt: `${starter} recuperou a bola e passou a ${scorer}, que marcou aos ${at}.`,
  }[language];
  return {
    text: passes.length === 1 ? single : [start, ...middle, finish].join(' '),
    evidence: chain.map((item) => item.ref),
    proof: {
      kind: 'linked-goal-sequence',
      eventType: 'shot',
      eventId: goal.row.id,
      revision: goal.row.revision,
      playerId: goal.row.playerId,
      time: goal.row.time,
      team: goal.row.team,
      links: chain.map((item) => ({
        eventId: item.row.id,
        revision: item.row.revision,
        cause: item.row.cause ?? null,
        passId: item.row.passId ?? null,
      })),
      modelGenerated: false,
    },
  };
}
