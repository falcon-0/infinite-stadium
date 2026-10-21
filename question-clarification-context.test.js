import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlayerClarification } from './question-clarification-context.js';
import { validateMatchQuestionInput } from './match-questions.js';
const roster = [
    { id: 'h', name: 'E. Costa', team: 'home' },
    { id: 'a', name: 'M. Costa', team: 'away' },
  ],
  teams = { home: 'Northbridge', away: 'Harbour Athletic' };
const input = {
  kind: 'sustained',
  seed: 17,
  time: 70,
  question: 'M. Costa, celui de Harbour Athletic.',
  clarification: { question: 'Qui a récupéré le ballon après la passe ratée de Costa ?', time: 69 },
};
test('a roster-backed selection restores the pending question, not a player profile', () => {
  const value = resolvePlayerClarification(input, roster, teams);
  assert.equal(value.playerId, 'a');
  assert.match(value.question, /passe ratée de M\. Costa/);
  assert.equal(value.clarifiedAt, 70);
  assert.equal(value.originalObservedAt, 69);
  validateMatchQuestionInput(input);
});
test('new questions, guesses, duplicate choices and future context cannot overwrite intent', () => {
  for (const question of [
    'Why did M. Costa not pass?',
    'M. Costa scored ten goals',
    'Costa',
    'M. Costa and E. Costa',
  ])
    assert.equal(resolvePlayerClarification({ ...input, question }, roster, teams), null);
  assert.equal(resolvePlayerClarification({ ...input, time: 68 }, roster, teams), null);
  assert.equal(
    resolvePlayerClarification({ ...input, clarification: undefined }, roster, teams),
    null,
  );
});
test('clarification envelopes are bounded and cannot inject additional fields', () => {
  for (const clarification of [
    { question: 'Costa', time: 71 },
    { question: 'Costa', time: 70, goals: 10 },
    { question: 'x'.repeat(401), time: 70 },
    [],
  ])
    assert.throws(() => validateMatchQuestionInput({ ...input, clarification }), RangeError);
});

test('a valid long pending question is bounded at the same 400 characters as a match question', () => {
  validateMatchQuestionInput({ ...input, clarification: { question: 'x'.repeat(400), time: 70 } });
});
