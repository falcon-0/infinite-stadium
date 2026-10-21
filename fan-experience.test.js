import test from 'node:test';
import assert from 'node:assert/strict';
import { additionalFanClaims } from './fan-experience.js';

const story = () => ({
  status: 'draft',
  authorship: { wording: 'application-fact-templates' },
  selectedFacts: [
    { id: 'm', kind: 'moment' },
    { id: 'g', kind: 'goal-score-change' },
    { id: 'p', kind: 'window-shot-change' },
  ],
  claims: [
    { factId: 'm', text: 'A player scored.' },
    { factId: 'g', text: 'The team took the lead.' },
    { factId: 'p', text: 'More shots in the recent window.' },
  ],
});

test('AI supplements a visible outcome and score meaning without losing the full source story', () => {
  const draft = story(),
    original = JSON.stringify(draft);
  assert.deepEqual(additionalFanClaims(draft, { current: true, hasScoreMeaning: true }), [
    draft.claims[2],
  ]);
  assert.equal(JSON.stringify(draft), original);
  assert.deepEqual(
    additionalFanClaims(draft, { current: true }),
    draft.claims.slice(1),
    'retain score significance if the card does not show it',
  );
});
test('changed preferences, superseded evidence and withheld stories cannot leave old AI context visible', () => {
  assert.deepEqual(additionalFanClaims(story(), { current: false }), []);
  assert.deepEqual(additionalFanClaims({ ...story(), status: 'withheld' }, { current: true }), []);
});
test('unknown and free-prose claims are not silently treated as duplicate typed facts', () => {
  const draft = story();
  draft.claims.push({ factId: 'unknown', text: 'Unmapped claim' });
  assert.deepEqual(
    additionalFanClaims(draft, { current: true, hasScoreMeaning: true }),
    draft.claims.slice(2),
  );
  draft.authorship.wording = 'model';
  assert.deepEqual(
    additionalFanClaims(draft, { current: true, hasScoreMeaning: true }),
    draft.claims,
  );
});
