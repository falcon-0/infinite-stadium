import { createHash } from 'node:crypto';
import { matchState } from './match-stream.js';
import { momentMeaning } from './moment-meaning.js';
import { validateProducerStories } from './producer-validation.js';

/** Reconstruct every output from the same received fixture. No inference here. */
export function productionPackage(input, { stateFactory = matchState } = {}) {
  if (
    !input ||
    Object.keys(input).some(
      (k) => !['kind', 'seed', 'time', 'anchorId', 'language', 'aiDraft'].includes(k),
    ) ||
    !Number.isSafeInteger(input.seed) ||
    !Number.isFinite(input.time) ||
    input.time < 0 ||
    typeof input.anchorId !== 'string' ||
    input.anchorId.length > 700 ||
    !['es', 'fr', 'pt'].includes(input.language)
  )
    throw new RangeError('Choose a received chance and a supported output language.');
  const base = { kind: input.kind, seed: input.seed, favoriteClub: null, favoritePlayer: null };
  const source = stateFactory({ ...base, time: input.time, audience: 'newcomer', language: 'en' });
  const anchor = source.events.find((e) => e.id === input.anchorId);
  if (!anchor || anchor.type !== 'shot')
    throw new RangeError('Choose a received shot; withdrawn events cannot produce a package.');
  const treatments = [
    { id: 'fan', label: 'Fan story', audience: 'newcomer', language: 'en' },
    { id: 'analyst', label: 'Analyst briefing', audience: 'analyst', language: 'en' },
    {
      id: 'international',
      label: 'International graphic',
      audience: 'newcomer',
      language: input.language,
    },
  ];
  const notices = [];
  const outputs = treatments.map((treatment) => {
    const preferences = { ...base, audience: treatment.audience, language: treatment.language };
    const ai =
      input.aiDraft &&
      input.aiDraft.audience === treatment.audience &&
      input.aiDraft.language === treatment.language;
    const request = {
      reviewId: treatment.id,
      anchorId: input.anchorId,
      source: ai ? 'ai' : 'recorded',
      ...(ai ? { draft: input.aiDraft } : {}),
    };
    let result = validateProducerStories(
      { preferences, time: input.time, items: [request] },
      { stateFactory },
    );
    if (!result.stories.length && ai) {
      notices.push(
        `${treatment.label}: the AI selection is no longer current. A recorded replacement needs review.`,
      );
      result = validateProducerStories(
        {
          preferences,
          time: input.time,
          items: [{ ...request, source: 'recorded', draft: undefined }],
        },
        { stateFactory },
      );
    }
    if (!result.stories.length)
      throw new RangeError('Current output evidence could not be reconstructed.');
    const checked = result.stories[0];
    return {
      ...treatment,
      text: checked.entry.text,
      source: checked.source,
      decisionKey: checked.decisionKey,
      evidence: checked.entry.evidence,
    };
  });
  const meaning = momentMeaning(source.events, input.anchorId, { observedAt: input.time });
  const key =
    'package:' +
    createHash('sha256')
      .update(JSON.stringify(outputs.map((o) => [o.id, o.decisionKey, o.text])))
      .digest('hex');
  return {
    schema: 'infinite-stadium.production-package.v1',
    key,
    matchId: source.metadata.id,
    kind: input.kind,
    seed: input.seed,
    observedAt: source.time,
    anchorId: anchor.id,
    eventTime: anchor.time,
    revision: anchor.revision,
    headline: meaning.headline,
    why: meaning.why,
    buildup: meaning.buildup,
    steps: meaning.steps,
    outputs,
    notices,
    authorship:
      'Recorded output templates; an attached canonical AI selection is used only for its matching audience and language.',
    limitation:
      'Synthetic match. Local graphics preview, not broadcast transmission. Translations require language review.',
  };
}
