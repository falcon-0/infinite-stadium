import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, explainMoment } from './engine.js';
import { selectNarratives } from './narratives.js';

const event = (id, time, team = 'home', type = 'recovery', result = false) => ({
  id,
  time,
  arrivedAt: time,
  revision: 1,
  team,
  type,
  result,
  player: id,
  ...(type === 'recovery' ? { recoveryKind: 'loose-ball' } : {}),
});
const shot = event('shot', 10, 'home', 'shot');
function views(events) {
  const state = snapshot(10, [...events, shot]);
  return {
    explanation: explainMoment(state, shot.id),
    narrative: selectNarratives(state, { audience: 'newcomer' })[0],
  };
}

test('latest recovery after an opposing turnover supports the regained-possession sequence', () => {
  const { explanation, narrative } = views([
    event('first', 1),
    event('lost', 3, 'away'),
    event('regained', 7),
    event('pass', 8, 'home', 'pass', true),
  ]);
  assert.match(explanation.text, /recovered possession 3 seconds before/);
  assert.match(explanation.text, /1 completed passes/);
  assert.match(narrative.text, /won the ball 3 seconds before the shot/);
  assert.equal(narrative.selectionReason, 'shot after a recorded recovery');
});

test('two own recoveries use the latest timestamp and exclude passes before that boundary', () => {
  const { explanation, narrative } = views([
    event('first', 1),
    event('old-pass', 2, 'home', 'pass', true),
    event('latest', 7),
    event('new-pass', 8, 'home', 'pass', true),
  ]);
  assert.match(explanation.text, /recovered possession 3 seconds before/);
  assert.match(explanation.text, /1 completed passes/);
  assert.match(narrative.text, /won the ball 3 seconds before the shot/);
  assert.ok(!explanation.text.includes('9 seconds before'));
});

test('opposing recoveries at either time boundary suppress an uninterrupted buildup claim', () => {
  for (const time of [7, 10]) {
    const { explanation, narrative } = views([event('own', 7), event('opposing', time, 'away')]);
    assert.ok(!explanation.text.includes('recovered possession'));
    assert.ok(!narrative.text.includes('won the ball'));
    assert.equal(narrative.selectionReason, 'shot');
  }
});

test('same-team recoveries tied at the latest timestamp cannot establish which recovery preceded the shot', () => {
  const { explanation, narrative } = views([
    event('old', 1),
    event('tied-a', 7),
    event('tied-b', 7),
  ]);
  assert.ok(!explanation.text.includes('recovered possession'));
  assert.ok(!narrative.text.includes('won the ball'));
  assert.equal(narrative.selectionReason, 'shot');
});

test('passes strictly between recovery and shot require confirmed completion', () => {
  const { explanation } = views([
    event('own', 4),
    event('at-recovery', 4, 'home', 'pass', true),
    event('confirmed', 6, 'home', 'pass', true),
    event('pending', 7, 'home', 'pass', null),
    event('failed', 8, 'home', 'pass', false),
    event('at-shot', 10, 'home', 'pass', true),
  ]);
  assert.match(explanation.text, /1 completed passes/);
});

test('a recovery at the exact shot timestamp is not described as happening before it', () => {
  const { explanation, narrative } = views([event('same-time', 10)]);
  assert.ok(!explanation.text.includes('recovered possession'));
  assert.ok(!narrative.text.includes('won the ball'));
  assert.equal(narrative.selectionReason, 'shot');
});
