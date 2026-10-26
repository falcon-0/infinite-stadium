import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitEventRelations, relativeKeeperWitnessPair } from './relative-event-planning.js';

function witnesses() {
  return {
    manifest: {
      facts: [
        {
          id: 'hold',
          proof: {
            kind: 'linked-goalkeeper-hold',
            modelGenerated: false,
            linkBasis: 'explicit-cause',
            eventId: 'h',
            revision: 2,
            time: 98,
          },
        },
        {
          id: 'goal',
          proof: {
            kind: 'ordered-event',
            modelGenerated: false,
            event: { eventId: 'g', revision: 3, time: 116 },
          },
        },
      ],
    },
    relations: [
      {
        relation: 'before',
        anchor: { type: 'event', id: 'g', revision: 3 },
        anchorTime: 116,
        resultEvents: [{ type: 'event', id: 'h', revision: 2 }],
        query: { filters: { recoveryKind: 'goalkeeper-hold', linkedShotOutcome: 'saved' } },
      },
    ],
  };
}
test('relative witness selection requires exact event revisions and a unique explicit pair', () => {
  const { manifest, relations } = witnesses();
  assert.deepEqual(relativeKeeperWitnessPair(manifest, relations), ['hold', 'goal']);
  for (const mutate of [
    (m, r) => r[0].anchor.revision++,
    (m, r) => r[0].resultEvents[0].revision++,
    (m) => (m.facts[0].proof.time = 116),
    (m) => (m.facts[0].proof.linkBasis = 'nearest-shot'),
    (m) => (m.facts[0].proof.modelGenerated = true),
    (m) => m.facts.push(structuredClone(m.facts[1])),
    (m, r) => r[0].resultEvents.push({ id: 'other', revision: 1 }),
    (m, r) => r.push(structuredClone(r[0])),
    (m, r) => (r[0].query.filters.linkedShotOutcome = 'goal'),
  ]) {
    const sample = witnesses();
    mutate(sample.manifest, sample.relations);
    assert.equal(relativeKeeperWitnessPair(sample.manifest, sample.relations), null);
  }
});
test('relative witness selection preserves after direction and declines missing anchors', () => {
  const sample = witnesses();
  sample.relations[0].relation = 'after';
  assert.equal(relativeKeeperWitnessPair(sample.manifest, sample.relations), null);
  sample.manifest.facts[0].proof.time = 118;
  assert.deepEqual(relativeKeeperWitnessPair(sample.manifest, sample.relations), ['hold', 'goal']);
  assert.equal(relativeKeeperWitnessPair(sample.manifest, []), null);
});
test('recognizes relative received-event requirements across supported languages', () => {
  for (const q of [
    'Who collected the saved attempt before Reed scored?',
    'Who passed after the shot?',
    '¿Quién recogió el tiro detenido y ocurrió antes del gol de Reed?',
    'Qui a récupéré le ballon avant le but de Reed ?',
    'Quem recolheu a bola antes do golo de Reed?',
  ]) {
    assert.equal(explicitEventRelations(q).length, 1, q);
  }
  assert.equal(explicitEventRelations('Who passed after the shot?')[0].relation, 'after');
  assert.equal(
    explicitEventRelations('Who recovered before the shot and passed after the goal?').length,
    2,
  );
});
test('does not turn clock windows, incidental words or hypothetical acts into event anchors', () => {
  for (const q of [
    'Who passed before 40 seconds?',
    'After 01:20, how many passes?',
    'What is a goal?',
    'Before we start, list the players.',
    'Who passed before he could shoot?',
    'Explain what could happen after he might pass.',
    null,
  ]) {
    assert.deepEqual(explicitEventRelations(q), [], String(q));
  }
});
import { allowedRelativeEntityBindings } from './relative-event-planning.js';
test('relative equality choices distinguish an anchor team from a requested shared actor', () => {
  assert.deepEqual(
    allowedRelativeEntityBindings({
      question:
        'Quem ficou com a bola depois do remate defendido mais recente da equipa visitante?',
    }),
    ['none'],
  );
  assert.deepEqual(
    allowedRelativeEntityBindings({ question: 'Who recovered the ball after the away team shot?' }),
    ['none'],
  );
  assert.ok(
    allowedRelativeEntityBindings({
      question: 'Who from the same team recovered the ball after the shot?',
    }).includes('same-team'),
  );
  assert.ok(
    allowedRelativeEntityBindings({ question: 'What did that player do after his shot?' }).includes(
      'same-player',
    ),
  );
  assert.ok(
    allowedRelativeEntityBindings({
      question: 'What came after the shot?',
      queryRelations: [{ sameTeam: true }],
    }).includes('same-team'),
  );
});
