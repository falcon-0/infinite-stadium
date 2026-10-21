import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRecap, recapViewKey } from './recap-view.js';
const preferences = {
  kind: 'extended',
  seed: 17,
  audience: 'newcomer',
  language: 'en',
  favoriteClub: null,
  favoritePlayer: null,
};
const records = [
  { id: 'early-goal', revision: 2 },
  { id: 'later-pass', revision: 1 },
];
const draft = {
  scope: { task: 'recap', observedAt: 180, fixture: { kind: 'extended', seed: 17 } },
  audience: 'newcomer',
  language: 'en',
  preferences,
  dependencies: records.map((e) => ({ type: 'event', ...e })),
};
const snapshot = {
  records,
  time: 180,
  preferences,
  requestKey: recapViewKey(records, 180, preferences),
};
test('a frozen whole-segment recap stays current with the same inventory regardless of delivery order', () => {
  assert.equal(currentRecap(draft, snapshot), true);
  assert.equal(currentRecap(draft, { ...snapshot, records: [...records].reverse() }), true);
  assert.equal(currentRecap(draft, { ...snapshot, records: records.values() }), true);
});
test('early corrections, withdrawals, new actions and replay movement supersede the recap', () => {
  for (const changed of [
    [{ id: 'early-goal', revision: 3 }, records[1]],
    records.slice(1),
    [...records, { id: 'new-action', revision: 1 }],
  ])
    assert.equal(currentRecap(draft, { ...snapshot, records: changed }), false);
  for (const time of [179, 181]) assert.equal(currentRecap(draft, { ...snapshot, time }), false);
});
test('a result for another scope or audience cannot masquerade as the captured recap', () => {
  for (const replacement of [
    null,
    { ...draft, language: 'fr' },
    { ...draft, audience: 'analyst' },
    { ...draft, scope: { ...draft.scope, observedAt: 181 } },
    { ...draft, scope: { ...draft.scope, fixture: { kind: 'central', seed: 17 } } },
    { ...draft, dependencies: draft.dependencies.slice(1) },
    { ...draft, dependencies: [...draft.dependencies, draft.dependencies[0]] },
  ])
    assert.equal(currentRecap(replacement, snapshot), false);
  assert.equal(
    currentRecap(draft, {
      ...snapshot,
      preferences: { ...preferences, favoritePlayer: 'D. Silva' },
    }),
    false,
  );
});
