import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedObservedShotStory } from './linked-observed-shot-story.js';

function fixture() {
  const rows = [
    { id: 'win', type: 'recovery', time: 5, playerId: 'supplier', recoveryKind: 'interception' },
    {
      id: 'delivery',
      type: 'pass',
      time: 9,
      playerId: 'supplier',
      receiverId: 'shooter',
      cause: 'win',
      result: true,
    },
    {
      id: 'control',
      type: 'receive',
      time: 12,
      playerId: 'shooter',
      passId: 'delivery',
      cause: 'delivery',
    },
    {
      id: 'attempt',
      type: 'shot',
      time: 14,
      playerId: 'shooter',
      passId: 'delivery',
      result: false,
      outcome: 'blocked',
    },
  ].map((row) => ({ ...row, team: 'home', revision: 2, operation: 'upsert', arrivedAt: row.time }));
  const entries = rows.map((row) => ({
    row,
    ref: { type: 'event', id: row.id, revision: row.revision },
    proof: {
      eventId: row.id,
      revision: row.revision,
      actionOutcome: {
        status: row.type === 'pass' ? 'completed' : row.type === 'shot' ? 'blocked' : null,
      },
      ...(row.type === 'pass'
        ? { recipient: { status: 'confirmed-recipient', playerId: 'shooter' } }
        : {}),
    },
  }));
  const events = new Map(entries.map((entry) => [entry.row.id, entry]));
  return {
    events,
    shot: events.get('attempt'),
    options: {
      observedAt: 20,
      name: (id) => ({ supplier: 'M. Vale', shooter: 'N. Stone' })[id],
      clock: (seconds) => '00:' + String(seconds).padStart(2, '0'),
    },
  };
}

for (const language of ['en', 'es', 'fr', 'pt'])
  test(`explicit observed shot buildup cites four chronological current source rows (${language})`, () => {
    const { shot, events, options } = fixture();
    const story = linkedObservedShotStory(shot, events, { ...options, language });
    assert.ok(story);
    assert.deepEqual(
      story.evidence.map((ref) => ref.id),
      ['win', 'delivery', 'control', 'attempt'],
    );
    assert.ok(story.evidence.every((ref) => ref.revision === 2));
    assert.deepEqual(
      story.links.map((link) => link.time),
      [5, 9, 12, 14],
    );
    assert.match(story.text, /M\. Vale/);
    assert.match(story.text, /N\. Stone/);
    for (const time of ['00:05', '00:09', '00:12', '00:14'])
      assert.equal(story.text.split(time).length - 1, 1);
    assert.doesNotMatch(story.text, /assist|pressure|intention|forced|last pass/i);
  });

test('observed shot buildup never fills absent, ambiguous, stale, unreceived or incompatible source links', () => {
  const changes = [
    ({ events }) => events.delete('win'),
    ({ events }) => delete events.get('delivery').row.cause,
    ({ events }) => (events.get('attempt').row.passId = 'unlinked'),
    ({ events }) => (events.get('delivery').row.receiverId = 'someone-else'),
    ({ events }) => (events.get('delivery').proof.actionOutcome.status = 'failed'),
    ({ events }) => (events.get('delivery').proof.recipient.status = 'recorded-target'),
    ({ events }) => (events.get('win').row.recoveryKind = 'segment-start'),
    ({ events }) => (events.get('win').row.playerId = 'someone-else'),
    ({ events }) => (events.get('win').row.team = 'away'),
    ({ events }) => (events.get('win').row.arrivedAt = 21),
    ({ events }) => (events.get('delivery').row.operation = 'delete'),
    ({ events }) => (events.get('delivery').row.revision = 3),
    ({ events }) => (events.get('control').row.playerId = 'someone-else'),
    ({ events }) => (events.get('control').row.cause = 'other-pass'),
    ({ events }) => (events.get('control').row.passId = 'other-pass'),
    ({ events }) => (events.get('control').row.time = 14),
    ({ events }) => (events.get('control').row.arrivedAt = 21),
    ({ events }) => {
      const duplicate = structuredClone(events.get('control'));
      duplicate.row.id = 'other-control';
      events.set('other-control', duplicate);
    },
    ({ events }) => (events.get('attempt').row.time = 8),
    ({ events }) => (events.get('attempt').proof.actionOutcome.status = 'pending'),
    ({ events }) => (events.get('attempt').ref.revision = 1),
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.equal(linkedObservedShotStory(f.shot, f.events, f.options), null, String(change));
  }
});
