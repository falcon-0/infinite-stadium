import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceClubSide,
  normalizeClubActorQuery,
  hasSourcePlayerReference,
} from './club-query-identity.js';
const teams = { home: 'Northbridge', away: 'Harbour Athletic' };
const roster = [{ id: 'home-7', name: 'J. Cole', team: 'home' }];

test('source clubs retain their type despite being proposed as players', () => {
  for (const [name, side] of [
    ['Northbridge', 'home'],
    ['  NORTHBRIDGE ', 'home'],
    ['Harbour Athletic', 'away'],
  ])
    assert.equal(sourceClubSide(name, teams, roster), side);
  for (const name of ['Cole', 'J. Cole', 'Messi', 'Harbour', 'Northbridge Reserves', 'home'])
    assert.equal(sourceClubSide(name, teams, roster), null);
});
test('club actor correction preserves the exact requested event inventory and chronology', () => {
  const query = {
    filters: { player: 'Northbridge', type: 'pass', result: false, bodyPart: 'left-foot' },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
    timeFrom: 12,
    timeTo: 38,
    timeFromExclusive: true,
  };
  const original = structuredClone(query),
    normalized = normalizeClubActorQuery(query, teams, roster);
  assert.deepEqual(normalized, {
    ...query,
    filters: { type: 'pass', result: false, bodyPart: 'left-foot', team: 'home' },
  });
  assert.deepEqual(query, original);
  assert.throws(
    () =>
      normalizeClubActorQuery(
        { ...query, filters: { ...query.filters, team: 'away' } },
        teams,
        roster,
      ),
    /conflicts/,
  );
});
test('unknown people and ambiguous club/player identities cannot become team queries', () => {
  for (const player of ['Messi', 'Cole', 'Harbour']) {
    const query = { filters: { player }, aggregate: 'count' };
    assert.equal(normalizeClubActorQuery(query, teams, roster), query);
  }
  const collision = [...roster, { id: 'away-9', name: 'Northbridge', team: 'away' }];
  assert.equal(sourceClubSide('Northbridge', teams, collision), null);
  const receiver = { filters: { receiver: 'Northbridge' }, aggregate: 'count' };
  assert.equal(normalizeClubActorQuery(receiver, teams, roster), receiver);
});

test('planner player mentions must be grounded in the fan or conversation', () => {
  const roster = [
    { id: 'home-7', name: 'J. Cole' },
    { id: 'home-10', name: 'A. Reed' },
  ];
  assert.ok(
    hasSourcePlayerReference('J. Cole', { question: 'Did Cole help create the goal?' }, roster),
  );
  assert.ok(
    hasSourcePlayerReference(
      'J. Cole',
      { question: 'What did he do?', conversation: [{ answer: 'J. Cole played the pass.' }] },
      roster,
    ),
  );
  assert.ok(hasSourcePlayerReference('Ronaldo', { question: 'Is Ronaldo playing?' }, roster));
  assert.equal(
    hasSourcePlayerReference('A. Reed', { question: 'Who is linking the play together?' }, roster),
    false,
  );
  assert.equal(
    hasSourcePlayerReference('J. Cole', { question: 'Was the collection clean?' }, roster),
    false,
  );
});
