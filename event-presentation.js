import { isSafePlayerName } from './viewer-preferences.js';
/** A semantic presentation proposal changes wording, never the source query,
 * actor identity, outcome, revision, ordering or evidence requirements. */
export const eventPresentationSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['actor', 'recipient'] },
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          items: { type: 'string', enum: ['name', 'time'] },
        },
      },
      required: ['role', 'fields'],
      additionalProperties: false,
    },
  ],
  description:
    'For explicit name-only or name/time identity requests. actor performs; recipient receives a confirmed completed pass. Use null for extra facts, multiple actions, counts or explanations. Formatting is not an extra factual demand; a target is not a confirmed recipient.',
};

export function normalizeEventPresentation(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !['actor', 'recipient'].includes(value.role) ||
    !Array.isArray(value.fields) ||
    !value.fields.includes('name') ||
    value.fields.length < 1 ||
    value.fields.length > 2 ||
    new Set(value.fields).size !== value.fields.length ||
    value.fields.some((field) => !['name', 'time'].includes(field))
  )
    return null;
  return { role: value.role, fields: [...value.fields] };
}

export function presentEventFields(proposal, event, player) {
  const shape = normalizeEventPresentation(proposal);
  if (
    !shape ||
    event?.kind !== 'event' ||
    event.modelGenerated !== false ||
    !Number.isSafeInteger(event.revision) ||
    event.revision < 1 ||
    !Number.isFinite(event.time) ||
    event.time < 0
  )
    return null;
  let id = event.playerId;
  if (shape.role === 'recipient') {
    if (
      event.eventType !== 'pass' ||
      event.actionOutcome?.status !== 'completed' ||
      event.recipientStatus !== 'confirmed-recipient' ||
      event.recipient?.status !== 'confirmed-recipient' ||
      !event.recipient.playerId
    )
      return null;
    id = event.recipient.playerId;
  }
  const person = player(id);
  if (!person || person.id !== id || !isSafePlayerName(person.name)) return null;
  const time = `${String(Math.floor(event.time / 60)).padStart(2, '0')}:${String(Math.floor(event.time % 60)).padStart(2, '0')}`;
  return {
    text: shape.fields.includes('time') ? `${person.name} · ${time}.` : `${person.name}.`,
    proof: { ...shape, playerId: id, modelGenerated: false },
  };
}
