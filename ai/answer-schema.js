// Shared structured answer contracts. No model calls or mutable runtime state.
export const strictObject = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const referenceSchema = strictObject({
  type: { type: 'string', enum: ['event', 'scope'] },
  id: { type: 'string' },
  revision: { type: 'integer' },
});
export const answerSchema = strictObject({
  premiseCheck: strictObject({
    questionAssumption: { type: 'string' },
    recordedAction: { type: 'string' },
    conclusion: {
      type: 'string',
      enum: ['supported', 'contradicted', 'unknown', 'not-applicable'],
    },
  }),
  scope: { type: 'string', enum: ['match', 'general', 'clarify'] },
  claims: {
    type: 'array',
    items: strictObject({
      text: { type: 'string' },
      kind: { type: 'string', enum: ['observation', 'interpretation', 'general', 'limitation'] },
      evidence: {
        type: 'array',
        items: referenceSchema,
        description:
          'Direct match evidence. An interpretation may instead explicitly depend on observation claims.',
      },
      dependsOn: {
        type: 'array',
        maxItems: 3,
        items: { type: 'integer', minimum: 0, maximum: 3 },
        description:
          'Interpretations only: distinct zero-based indices of observation claims supporting this conclusion, earlier or later. All other claim kinds use [].',
      },
    }),
  },
  followUp: { type: 'string', enum: [''] },
});
