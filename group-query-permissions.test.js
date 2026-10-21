import test from 'node:test';
import assert from 'node:assert/strict';
import { licensedGroupCounts, groupCountAllowed } from './group-query-permissions.js';
test('group thresholds follow explicit action quantities, including inclusive and exclusive bounds', () => {
  for (const [question, expected] of [
    ['Who has at least two completed passes?', { min: 2 }],
    ['Players with more than 3 shots', { min: 4 }],
    ['Who has fewer than five receptions?', { max: 4 }],
    ['Who has exactly one assist?', { min: 1, max: 1 }],
    ['Players with between 2 and 4 attempts', { min: 2, max: 4 }],
    ['Who has 3 or more saves?', { min: 3 }],
    ['Who has at most 2 goals?', { max: 2 }],
  ]) {
    assert.deepEqual(licensedGroupCounts(question), [expected]);
    assert.ok(groupCountAllowed(question, { groupCount: expected }));
    assert.equal(groupCountAllowed(question, { groupCount: { min: 1, max: 3 } }), false);
  }
});
test('ordinary assessments and time intervals cannot invent group bounds', () => {
  for (const question of [
    "Who's linking Northbridge's play together?",
    'Who contributed most in the last two minutes?',
    'Who scored between 2 and 4 minutes?',
    'Who received the ball most often?',
    'Who played more than 3 minutes?',
  ]) {
    assert.deepEqual(licensedGroupCounts(question), []);
    assert.equal(groupCountAllowed(question, { groupCount: { min: 1, max: 3 } }), false);
    assert.ok(groupCountAllowed(question, {}));
  }
  assert.deepEqual(licensedGroupCounts('Who has fewer than zero shots?'), []);
  assert.deepEqual(licensedGroupCounts('Between 4 and 2 shots'), []);
});
