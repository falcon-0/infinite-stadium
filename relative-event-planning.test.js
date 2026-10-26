import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitEventRelations, relativeKeeperWitnessPair } from './relative-event-planning.js';
import { sameTeamPredecessorQueries } from './relative-event-planning.js';
import { requiresSavedShotAnchor } from './relative-event-planning.js';
import { executeMatchQuery } from './match-query.js';
import { matchState } from './match-stream.js';
import { resolvePlannedRelation } from './match-question-ai.js';

const predecessorInput = {
  kind: 'duel',
  seed: 1001,
  time: 120,
  question: 'Et le tir précédent de cette même équipe, à quel moment ?',
  conversation: [
    {
      question: 'À quel moment l’équipe à domicile a-t-elle tenté son tir le plus récent ?',
      time: 120,
    },
  ],
};
test('a saved-shot relation requires its shot anchor rather than only a recovery-outcome filter', () => {
  for (const question of [
    'Who collected the ball after the latest saved shot?',
    'Qui a récupéré le ballon après le tir arrêté ?',
    'Quem ficou com a bola depois do remate defendido mais recente?',
    '¿Quién recogió el balón después del tiro atajado?',
  ])
    assert.equal(requiresSavedShotAnchor(question), true);
  for (const question of [
    'Who recovered the ball?',
    'Who collected it after the goal?',
    'Could he collect it after the saved shot?',
    'How many saves has the keeper made?',
  ])
    assert.equal(requiresSavedShotAnchor(question), false);
});
test('explicit predecessor follow-ups bind the source event rather than the conversation pin', () => {
  const plan = sameTeamPredecessorQueries(predecessorInput);
  const scope = {
    kind: predecessorInput.kind,
    seed: predecessorInput.seed,
    time: predecessorInput.time,
  };
  const first = executeMatchQuery(scope, plan.queries[0]);
  assert.equal(first.rows[0].time, 92);
  const state = matchState(predecessorInput);
  const bound = resolvePlannedRelation(
    plan.queries[1],
    [first],
    120,
    [],
    new Map(state.events.map((e) => [e.id, e])),
  );
  const previous = executeMatchQuery(scope, bound.query);
  assert.equal(previous.rows[0].time, 22);
  assert.equal(previous.rows[0].team, 'home');
  assert.equal(bound.query.timeTo, 92);
  assert.equal(bound.query.timeToExclusive, true);
});
test('the bounded predecessor grammar supports four languages without inheriting unknown restrictions', () => {
  for (const [question, prior] of [
    ['When was the previous shot for that same team?', 'When was the latest home shot?'],
    [
      'Et le tir précédent de cette même équipe, à quel moment ?',
      'Quel moment pour le dernier tir à domicile?',
    ],
    [
      '¿A qué hora fue el tiro anterior del mismo equipo?',
      '¿Cuándo fue el último tiro del equipo local?',
    ],
    [
      'Quando foi o remate anterior da mesma equipa?',
      'Quando foi o último remate da equipa da casa?',
    ],
  ]) {
    const plan = sameTeamPredecessorQueries({
      ...predecessorInput,
      question,
      conversation: [{ question: prior, time: 120 }],
    });
    assert.equal(plan?.team, 'home');
    assert.equal(plan?.queries[1].relativeTo.relation, 'before');
  }
  for (const patch of [
    { conversation: [] },
    { question: 'When was the previous shot for that same team and who assisted?' },
    { question: 'When was the previous shot for that same team by Cole?' },
    { conversation: [{ question: 'When was the latest saved home shot?', time: 120 }] },
    { conversation: [{ question: 'When was the latest home shot by Cole?', time: 120 }] },
    { conversation: [{ question: 'When was the latest left-footed home shot?', time: 120 }] },
    { conversation: [{ question: 'When was the latest home shot before 01:00?', time: 120 }] },
    { conversation: [{ question: 'When was the latest home and away shot?', time: 120 }] },
    { conversation: [{ question: 'When was the latest home shot?', time: 121 }] },
  ])
    assert.equal(sameTeamPredecessorQueries({ ...predecessorInput, ...patch }), null);
});

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
