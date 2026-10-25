import test from 'node:test';
import assert from 'node:assert/strict';
import { playerPickBasisRequest } from './player-pick-request.js';
const plan = {
  answerFocus: 'player-assessment',
  requestedForm: 'explanation',
  explanationTarget: 'decision-rationale',
  mentionedPlayers: [],
};
const check = (question, components = [question], extra = {}, proposal = plan) =>
  playerPickBasisRequest({ question, ...extra }, proposal, components, [
    { name: 'J. Cole' },
    { name: 'A. Reed' },
  ]);

test('pure qualitative picks separate supporting reasons from action intentions without match-specific names or times', () => {
  for (const [question, parts] of [
    ['Who’s standing out so far, and why?', ['Who’s standing out so far', 'why']],
    ['Which player has impressed you most? Why?', ['Which player has impressed you most', 'Why']],
    ['Who has been the best player so far?', ['Who has been the best player so far']],
    ['Qui se démarque, et pourquoi ?', ['Qui se démarque', 'pourquoi']],
    ['¿Quién está destacando y por qué?', ['Quién está destacando', 'por qué']],
    ['Quem está se destacando e por quê?', ['Quem está se destacando', 'por quê']],
  ])
    assert.equal(check(question, parts), true, question);
});

test('a pick does not erase mixed action motives, alternatives, actor context or malformed planner classifications', () => {
  for (const [question, parts] of [
    [
      'Who stands out, and why did he shoot instead of pass?',
      ['Who stands out', 'why did he shoot instead of pass'],
    ],
    ['Who is best, and could they have passed?', ['Who is best', 'could they have passed']],
    [
      'Who is best, and why was the receiver not ready?',
      ['Who is best', 'why was the receiver not ready'],
    ],
    ['Who took the shot, and why?', ['Who took the shot', 'why']],
    ['Which player forced the mistake and why?', ['Which player forced the mistake', 'why']],
    [
      'Who is the best passer and why did he choose that option?',
      ['Who is the best passer', 'why did he choose that option'],
    ],
    ['Who stands out, and what is the score?', ['Who stands out', 'what is the score']],
    ['Why did Cole not pass?', ['Why did Cole not pass']],
    ['Who is the best, Cole or Reed? Why?', ['Who is the best, Cole or Reed', 'Why']],
  ])
    assert.equal(check(question, parts), false, question);
  assert.equal(check('Who is best?', undefined, { anchorId: 'a-real-action' }), false);
  assert.equal(
    check('Who is best?', undefined, { conversation: [{ question: 'What did he intend?' }] }),
    false,
  );
  for (const malformed of [
    { ...plan, mentionedPlayers: ['J. Cole'] },
    { ...plan, mentionedPlayers: null },
    { ...plan, answerFocus: 'event-actor' },
    { ...plan, explanationTarget: 'causal-attribution' },
    { ...plan, requestedForm: 'fact' },
  ])
    assert.equal(check('Who is best?', undefined, {}, malformed), false);
});
