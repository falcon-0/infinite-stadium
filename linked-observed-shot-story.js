import { recoveryClassification } from './recovery-classification.js';

// Inputs are the current, nonconflicting canonical event entries. Follow only
// explicit links; temporal proximity never supplies a missing action link.
export function linkedObservedShotStory(
  shot,
  events,
  { observedAt, language = 'en', name, clock } = {},
) {
  const current = (entry) => {
    const row = entry?.row;
    return (
      row &&
      events.get(row.id) === entry &&
      row.operation !== 'delete' &&
      Number.isSafeInteger(row.revision) &&
      row.revision > 0 &&
      Number.isFinite(row.time) &&
      Number.isFinite(row.arrivedAt) &&
      row.time <= observedAt &&
      row.arrivedAt <= observedAt &&
      entry.ref?.type === 'event' &&
      entry.ref.id === row.id &&
      entry.ref.revision === row.revision &&
      entry.proof?.revision === row.revision &&
      entry.proof.eventId === row.id
    );
  };
  if (
    !Number.isFinite(observedAt) ||
    !current(shot) ||
    shot.row.type !== 'shot' ||
    !['saved', 'blocked', 'off-target'].includes(shot.proof.actionOutcome?.status) ||
    !shot.row.passId
  )
    return null;
  const pass = events.get(shot.row.passId);
  if (
    !current(pass) ||
    pass.row.type !== 'pass' ||
    pass.proof.actionOutcome?.status !== 'completed' ||
    pass.proof.recipient?.status !== 'confirmed-recipient' ||
    pass.proof.recipient.playerId !== shot.row.playerId ||
    pass.row.receiverId !== shot.row.playerId ||
    !pass.row.cause
  )
    return null;
  const recovery = events.get(pass.row.cause),
    receptions = [...events.values()].filter(
      (entry) => entry.row.type === 'receive' && entry.row.passId === pass.row.id,
    );
  if (
    !current(recovery) ||
    recoveryClassification(recovery.row) !== 'ball-win' ||
    receptions.length !== 1
  )
    return null;
  const receive = receptions[0],
    chain = [recovery, pass, receive, shot];
  if (
    !current(receive) ||
    receive.row.playerId !== shot.row.playerId ||
    (receive.row.cause && receive.row.cause !== pass.row.id) ||
    recovery.row.playerId !== pass.row.playerId ||
    pass.row.playerId === shot.row.playerId ||
    !['home', 'away'].includes(shot.row.team) ||
    chain.some((entry) => entry.row.team !== shot.row.team) ||
    chain.some((entry, index) => index > 0 && chain[index - 1].row.time >= entry.row.time) ||
    new Set(chain.map((entry) => entry.row.id)).size !== 4
  )
    return null;
  const supplier = name(pass.row.playerId),
    shooter = name(shot.row.playerId);
  if (!supplier || !shooter) return null;
  const [start, delivery, reception, finish] = chain.map((entry) => clock(entry.row.time)),
    outcome = {
      en: { saved: 'was saved', blocked: 'was blocked', 'off-target': 'went off target' },
      es: { saved: 'fue parado', blocked: 'fue bloqueado', 'off-target': 'salió fuera' },
      fr: { saved: 'a été arrêté', blocked: 'a été contré', 'off-target': 'n’était pas cadré' },
      pt: { saved: 'foi defendido', blocked: 'foi bloqueado', 'off-target': 'saiu ao lado' },
    }[language]?.[shot.proof.actionOutcome.status];
  if (!outcome) return null;
  return {
    text: {
      en: `${supplier} recovered the ball at ${start} and completed a pass to ${shooter} at ${delivery}. ${shooter} received the ball at ${reception}; the shot ${outcome} at ${finish}.`,
      es: `${supplier} recuperó el balón a las ${start} y completó un pase a ${shooter} a las ${delivery}. ${shooter} recibió el balón a las ${reception}; el remate ${outcome} a las ${finish}.`,
      fr: `${supplier} a récupéré le ballon à ${start}, puis a réussi une passe à ${shooter} à ${delivery}. ${shooter} a reçu le ballon à ${reception} ; le tir ${outcome} à ${finish}.`,
      pt: `${supplier} recuperou a bola aos ${start} e completou um passe para ${shooter} aos ${delivery}. ${shooter} recebeu a bola aos ${reception}; o remate ${outcome} aos ${finish}.`,
    }[language],
    evidence: chain.map((entry) => entry.ref),
    links: chain.map(({ row }) => ({
      eventId: row.id,
      revision: row.revision,
      eventType: row.type,
      time: row.time,
      playerId: row.playerId,
      team: row.team,
      cause: row.cause ?? null,
      passId: row.passId ?? null,
    })),
  };
}
