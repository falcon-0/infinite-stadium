import test from 'node:test';
import assert from 'node:assert/strict';
import { statisticDefinitionRequestScope } from './statistic-definition-request.js';
const scope = (parts) => statisticDefinitionRequestScope(parts.join(', and '), parts);

test('actual ranking and received outcome requests are not statistical category definitions in four languages', () => {
  for (const parts of [
    ['Who’s had the most shots so far', 'how did they turn out'],
    ['Which player took the latest shot', 'what happened to it'],
    ['Qui a fait le plus de tirs', 'comment se sont-ils terminés'],
    ['¿Quién hizo más tiros', 'cómo terminaron'],
    ['Quem fez mais remates', 'como terminaram'],
    ['How many shots were blocked'],
  ])
    assert.equal(scope(parts), 'match', parts.join(';'));
});
test('genuine definitions and mixed definition-plus-match requests keep their distinct obligations', () => {
  for (const question of [
    'What does a shot on target mean?',
    'Define a saved shot.',
    'What is the statistical difference between blocked attempts and saves?',
    'Are blocked attempts added to saves in these statistics?',
    'Un tir contré compte comme un arrêt ?',
    '¿Qué significa un tiro a puerta?',
    'O que significa um remate defendido?',
  ])
    assert.equal(statisticDefinitionRequestScope(question), 'definition', question);
  for (const parts of [
    ['Who has the most shots', 'what does on target mean'],
    ['Do blocked attempts count as saves', 'how many shots were blocked'],
    ['Que signifie un tir cadré', 'combien de tirs ont été contrés'],
    ['Qué significa un tiro a puerta', 'cuántos tiros hubo'],
    ['O que significa um remate defendido', 'quantos remates houve'],
  ])
    assert.equal(scope(parts), 'mixed', parts.join(';'));
  assert.equal(statisticDefinitionRequestScope('Why did he choose to pass instead?'), 'unknown');
  assert.equal(statisticDefinitionRequestScope('Who is standing out and why?'), 'unknown');
  assert.equal(statisticDefinitionRequestScope('Which keeper has worked harder?'), 'unknown');
});
