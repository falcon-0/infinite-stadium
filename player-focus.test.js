import test from 'node:test';
import assert from 'node:assert/strict';
import { playerFocus } from './player-focus.js';
import { matchState } from './match-stream.js';

const event = (id, time, type = 'shot', extra = {}) => ({
  id,
  time,
  arrivedAt: time,
  revision: 1,
  type,
  team: 'away',
  playerId: 'away-10',
  player: 'D. Silva',
  result: true,
  ...extra,
});
const options = { favoritePlayer: 'D. Silva' };
const frame = {
  id: 'frame-20',
  revision: 2,
  time: 20,
  arrivedAt: 22,
  players: [{ id: 'away-10', team: 'away', x: 30, y: 40 }],
};

test('identity is learned only after its received event and never from a future event or frame', () => {
  const delayed = event('identity', 10, 'receive', { arrivedAt: 15 });
  const earlier = playerFocus([delayed], 12, options, frame);
  assert.equal(earlier.status, 'unknown');
  assert.equal(earlier.counts, null);
  assert.equal(earlier.sample, null);
  const known = playerFocus([delayed], 15, options, frame);
  assert.equal(known.status, 'known');
  assert.equal(known.playerId, 'away-10');
  assert.equal(known.counts.receives, 1);
  assert.equal(known.sample, null);
  assert.equal(playerFocus([event('future', 30)], 25, options, frame).status, 'unknown');
});

test('corrections fold before name lookup and deleted identities cannot remain in the profile', () => {
  const original = event('scorer', 10),
    corrected = { ...original, revision: 2, arrivedAt: 15, player: 'L. Park', playerId: 'away-7' };
  assert.equal(playerFocus([original, corrected], 12, options).status, 'known');
  assert.equal(playerFocus([original, corrected], 15, options).status, 'unknown');
  const park = playerFocus([original, corrected], 15, { favoritePlayer: 'L. Park' });
  assert.equal(park.counts.goals, 1);
  assert.equal(park.countsEvidence.goals[0].revision, 2);
  assert.equal(
    playerFocus(
      [original, { ...original, revision: 2, arrivedAt: 15, operation: 'delete' }],
      15,
      options,
    ).status,
    'unknown',
  );
});

test('a shared name across different player identities is explicitly unknown, not guessed', () => {
  const output = playerFocus(
    [event('one', 1), event('two', 2, 'pass', { playerId: 'away-7' })],
    5,
    options,
    frame,
  );
  assert.equal(output.status, 'unknown');
  assert.equal(output.reason, 'ambiguous-identity');
  assert.equal(output.playerId, null);
  assert.equal(output.counts, null);
  assert.equal(output.sample, null);
  assert.equal(output.identityEvidence.length, 2);
});

test('window counts preserve every exact input reference, exclude flight samples and unknown goal outcomes', () => {
  const events = [
    event('old', 1),
    event('recover', 40, 'recovery', { recoveryKind: 'loose-ball' }),
    event('pass', 42, 'pass'),
    event('receive', 44, 'receive'),
    event('pending', 45, 'shot', { result: null }),
    event('goal', 46),
    event('flight', 47, 'flight'),
    event('other', 48, 'shot', { playerId: 'away-7', player: 'L. Park' }),
  ];
  const profile = playerFocus(events, 50, { ...options, windowSeconds: 10 });
  assert.deepEqual(profile.counts, {
    actions: 5,
    shots: 2,
    goals: 1,
    completedPasses: 1,
    recoveries: 1,
    receives: 1,
  });
  assert.deepEqual(
    profile.countsEvidence.actions.map((r) => r.id),
    ['recover', 'pass', 'receive', 'pending', 'goal'],
  );
  assert.deepEqual(profile.countsEvidence.goals, [{ type: 'event', id: 'goal', revision: 1 }]);
  assert.equal(profile.lastAction.id, 'goal');
  assert.equal(profile.window.start, 40);
  assert.equal(profile.window.inclusive, true);
  assert.ok(profile.identityEvidence.some((r) => r.id === 'old'));
});

test('all twenty-two received frame players can be followed before an action, with identity separate from action evidence', () => {
  const state = matchState({ kind: 'quiet', seed: 2719, time: 0 }),
    current = state.frames[0];
  assert.equal(current.players.length, 22);
  for (const player of current.players) {
    const output = playerFocus([], 0, { favoritePlayer: player.name }, current);
    assert.equal(output.status, 'known');
    assert.equal(output.playerId, player.id);
    assert.equal(output.team, player.team);
    assert.equal(output.counts.actions, 0);
    assert.equal(output.lastAction, null);
    assert.deepEqual(output.identityEvidence, [
      { type: 'frame', id: current.id, revision: current.revision },
    ]);
    assert.deepEqual(output.countsEvidence.actions, []);
    assert.equal(output.sample.x, player.x);
    assert.equal(output.sample.y, player.y);
    assert.equal(output.sample.ageSeconds, 0);
    assert.equal(output.sample.frameRef.id, current.id);
    assert.equal(Object.hasOwn(output, 'speed'), false);
    assert.match(output.summary, /No recorded action/);
  }
});

test('future, late, deleted or malformed named rosters cannot establish an unseen identity', () => {
  const named = { ...frame, players: [{ ...frame.players[0], name: 'D. Silva' }] };
  for (const invalid of [
    { ...named, time: 31, arrivedAt: 31 },
    { ...named, arrivedAt: 31 },
    { ...named, operation: 'delete' },
    { ...named, revision: 0 },
    { ...named, players: [{ ...named.players[0], team: 'other' }] },
    { ...named, players: [{ ...named.players[0], name: '<script>' }] },
    { ...named, players: [named.players[0], { ...named.players[0], name: 'L. Park' }] },
  ]) {
    const output = playerFocus([], 30, options, invalid);
    assert.equal(output.status, 'unknown');
    assert.equal(output.counts, null);
    assert.equal(output.sample, null);
  }
  const badCoordinates = { ...named, players: [{ ...named.players[0], x: 106 }] };
  const output = playerFocus([], 30, options, badCoordinates);
  assert.equal(output.status, 'known');
  assert.equal(output.sample, null, 'Roster identity is not coordinate validity');
});

test('named current roster and active event identity conflicts fail closed rather than tracking another player', () => {
  const named = { ...frame, players: [{ ...frame.players[0], name: 'D. Silva' }] };
  for (const records of [
    [event('old', 1, 'receive', { playerId: 'away-7' })],
    [event('old', 1, 'receive', { team: 'home' })],
    [event('old', 1), event('conflict', 2, 'receive', { player: 'L. Park' })],
  ]) {
    const output = playerFocus(records, 30, options, named);
    assert.equal(output.status, 'unknown');
    assert.equal(output.counts, null);
    assert.equal(output.sample, null);
  }
  const changed = { ...named, players: [{ ...named.players[0], name: 'L. Park' }] };
  assert.equal(playerFocus([event('old', 1)], 30, options, changed).status, 'unknown');
  const ambiguous = {
    ...named,
    players: [named.players[0], { id: 'away-7', name: 'D. Silva', team: 'away', x: 20, y: 30 }],
  };
  assert.equal(playerFocus([], 30, options, ambiguous).reason, 'ambiguous-identity');
  const unavailable = playerFocus([], 30, { favoritePlayer: 'A. Previous' }, named);
  assert.equal(unavailable.reason, 'not-in-received-roster');
  assert.match(unavailable.summary, /unavailable/);
});

test('profile recoveries use shared ball-win semantics while preserving raw action evidence and uncertainty', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const start = event('start', 0, 'recovery', { recoveryKind: 'segment-start' }),
      win = event('win', 1, 'recovery', { recoveryKind: 'interception' }),
      unknown = event('unknown', 2, 'recovery');
    let profile = playerFocus([start], 0, { ...options, language });
    assert.equal(profile.counts.recoveries, 0);
    assert.equal(profile.counts.initialControls, 1);
    assert.equal(profile.lastAction.recoveryClass, 'initial-control');
    assert.deepEqual(profile.countsEvidence.recoveries, []);
    profile = playerFocus([start, win, unknown], 2, { ...options, language });
    assert.equal(profile.counts.actions, 3);
    assert.equal(profile.counts.recoveries, 1);
    assert.equal(profile.counts.recoveriesUnknown, 1);
    assert.equal(profile.lastAction.recoveryClass, 'unknown');
    assert.deepEqual(profile.countsEvidence.recoveries, [
      { type: 'event', id: 'win', revision: 1 },
    ]);
    assert.deepEqual(profile.countsEvidence.recoveriesUnknown, [
      { type: 'event', id: 'unknown', revision: 1 },
    ]);
    assert.match(profile.lastAction.text, /unknown|sin clasificación|inconnue|desconhecida/);
  }
  const first = event('record', 1, 'recovery', { recoveryKind: 'segment-start' }),
    correction = { ...first, revision: 2, arrivedAt: 3, recoveryKind: 'loose-ball' };
  assert.equal(playerFocus([first, correction], 2, options).counts.recoveries, 0);
  assert.equal(playerFocus([first, correction], 3, options).counts.recoveries, 1);
  assert.throws(
    () => playerFocus([first, { ...first, recoveryKind: 'loose-ball' }], 2, options),
    /Conflicting/,
  );
});

test('a supplied earlier sample is explicitly timestamped and cannot become an interpolated current position', () => {
  const events = [event('known', 1)],
    saved = structuredClone(frame);
  const profile = playerFocus(events, 30, options, frame);
  assert.deepEqual(profile.sample, {
    playerId: 'away-10',
    team: 'away',
    x: 30,
    y: 40,
    unit: 'metres',
    time: 20,
    arrivedAt: 22,
    ageSeconds: 10,
    frameRef: { type: 'frame', id: 'frame-20', revision: 2 },
    phase: null,
    description: 'Exact received sample; not an interpolated current position.',
  });
  assert.ok(profile.evidence.some((r) => r.type === 'frame' && r.revision === 2));
  profile.sample.x = 999;
  assert.deepEqual(frame, saved);
  for (const invalid of [
    { ...frame, time: 31, arrivedAt: 31 },
    { ...frame, arrivedAt: 31 },
    { ...frame, operation: 'delete' },
    { ...frame, players: [{ id: 'away-7', team: 'away', x: 30, y: 40 }] },
  ])
    assert.equal(playerFocus(events, 30, options, invalid).sample, null);
});

test('a pending final shot never becomes a miss in any language and profiles differ from match totals', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const profile = playerFocus(
      [
        event('mine', 3, 'shot', { result: null }),
        event('other', 4, 'shot', { player: 'L. Park', playerId: 'away-7' }),
      ],
      5,
      { ...options, language },
    );
    assert.equal(profile.counts.shots, 1);
    assert.equal(profile.counts.goals, 0);
    assert.equal(profile.lastAction.outcome, 'pending');
    assert.ok(profile.summary.includes('D. Silva'));
    assert.ok(profile.summary.length > 50);
    assert.ok(profile.limitation.length > 80);
  }
  assert.match(
    playerFocus([event('mine', 3, 'shot', { result: null })], 5, options).summary,
    /outcome pending/,
  );
});

test('last shot uses explicit supported categories in all languages without inferring target direction', () => {
  const offTarget = {
    en: 'D. Silva shoots off target',
    es: 'D. Silva no encuentra portería',
    fr: 'D. Silva ne cadre pas son tir',
    pt: 'D. Silva remata sem acertar na baliza',
  };
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const write = (outcome, ...flags) =>
      playerFocus(
        [event('last', 3, 'shot', { outcome, result: flags.length ? flags[0] : false })],
        5,
        { ...options, language },
      );
    assert.equal(write('off-target').lastAction.text, offTarget[language]);
    const distinct = ['off-target', 'saved', 'blocked', 'on-target'].map(
      (outcome) => write(outcome).lastAction.text,
    );
    assert.equal(new Set(distinct).size, 4);
    for (const text of distinct) {
      assert.ok(text.includes('D. Silva'));
      assert.doesNotMatch(text, /away-10|last|wide|over the bar/);
    }
    for (const outcome of ['off-target', 'saved', 'blocked', 'on-target', 'goal', 'unknown']) {
      assert.equal(write(outcome, true).lastAction.text, write('goal', true).lastAction.text);
      for (const result of [null, undefined, 'false', 0]) {
        const pending = write(outcome, result);
        assert.equal(pending.lastAction.outcome, 'pending');
        assert.equal(pending.counts.goals, 0);
        assert.equal(pending.lastAction.text, write(undefined, result).lastAction.text);
      }
    }
    assert.equal(write('unknown').lastAction.text, write(undefined).lastAction.text);
  }
  assert.equal(
    playerFocus([event('last', 3, 'shot', { result: false, outcome: 'saved' })], 5, options)
      .lastAction.text,
    'D. Silva has a shot saved',
  );
  assert.equal(
    playerFocus([event('last', 3, 'shot', { result: false, outcome: 'blocked' })], 5, options)
      .lastAction.text,
    'D. Silva has a shot blocked',
  );
});

test('received category corrections change the last-action text and evidence only after arrival', () => {
  const original = event('shot', 8, 'shot', { result: false, outcome: 'saved' }),
    corrected = { ...original, revision: 2, arrivedAt: 10, outcome: 'off-target' };
  const before = playerFocus([original, corrected], 9, options),
    after = playerFocus([corrected, original], 10, options);
  assert.equal(before.lastAction.text, 'D. Silva has a shot saved');
  assert.equal(before.lastAction.revision, 1);
  assert.equal(after.lastAction.text, 'D. Silva shoots off target');
  assert.equal(after.lastAction.revision, 2);
  assert.deepEqual(before.counts, after.counts);
  assert.notEqual(before.key, after.key);
  assert.deepEqual(after.lastAction.evidence, [{ type: 'event', id: 'shot', revision: 2 }]);
  assert.deepEqual(playerFocus([original, corrected, corrected], 10, options), after);
});

test('same-revision category conflicts are rejected after receipt but future categories cannot affect display', () => {
  const original = event('shot', 8, 'shot', { result: false, outcome: 'saved' }),
    conflict = { ...original, outcome: 'blocked' };
  assert.throws(
    () => playerFocus([original, conflict], 8, options),
    /Conflicting received records/,
  );
  const delayed = { ...original, revision: 2, arrivedAt: 12, outcome: 'on-target' };
  assert.equal(
    playerFocus([original, delayed], 10, options).lastAction.text,
    'D. Silva has a shot saved',
  );
  const future = event('future', 20, 'shot', { result: false, outcome: 'on-target' });
  assert.equal(playerFocus([original, future], 10, options).lastAction.id, 'shot');
});

test('known players with no actions in the current window remain honest while empty preference returns null', () => {
  const profile = playerFocus([event('old', 1)], 100, { ...options, windowSeconds: 60 });
  assert.equal(profile.status, 'known');
  assert.equal(profile.counts.actions, 0);
  assert.equal(profile.lastAction, null);
  assert.match(profile.summary, /No recorded action in this window/);
  assert.equal(playerFocus([], 5, {}), null);
  assert.equal(playerFocus([], 5, { favoritePlayer: '' }), null);
  assert.equal(playerFocus([], 5, { favoritePlayer: '   ' }), null);
  assert.equal(
    playerFocus([], 5, { favoritePlayer: 'A player not yet observed' }).status,
    'unknown',
  );
});

test('reordered and duplicate deliveries preserve profiles, invalid parameters are rejected', () => {
  const original = event('pass', 3, 'pass', { result: null }),
    complete = { ...original, revision: 2, arrivedAt: 4, result: true };
  const expected = playerFocus([original, complete], 5, options);
  assert.deepEqual(playerFocus([complete, original, complete], 5, options), expected);
  assert.throws(() => playerFocus([], Infinity, options), RangeError);
  assert.throws(() => playerFocus([], 5, { ...options, windowSeconds: 0 }), RangeError);
  assert.throws(() => playerFocus([], 5, { ...options, language: 'de' }), RangeError);
  assert.throws(() => playerFocus(null, 5, options), TypeError);
  assert.throws(
    () => playerFocus([original, { ...original, player: 'Conflicting name' }], 5, options),
    TypeError,
  );
});

test('unknown profiles explain waiting versus ambiguous names plainly in each supported language', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const waiting = playerFocus([], 5, { ...options, language });
    const ambiguous = playerFocus(
      [event('one', 1), event('two', 2, 'pass', { playerId: 'away-7' })],
      5,
      { ...options, language },
    );
    assert.equal(waiting.reason, 'not-yet-observed');
    assert.equal(ambiguous.reason, 'ambiguous-identity');
    assert.equal(waiting.counts, null);
    assert.equal(ambiguous.counts, null);
    assert.deepEqual(waiting.evidence, []);
    assert.equal(ambiguous.evidence.length, 2);
    assert.ok(waiting.summary.includes('D. Silva'));
    assert.ok(ambiguous.summary.includes('D. Silva'));
    assert.notEqual(waiting.summary, ambiguous.summary);
  }
  const waiting = playerFocus([], 5, options).summary;
  assert.match(waiting, /Waiting for a recorded action/);
  assert.ok(!waiting.includes('0 actions'));
  assert.match(
    playerFocus([event('one', 1), event('two', 2, 'pass', { playerId: 'away-7' })], 5, options)
      .summary,
    /more than one received player; tracking is unavailable/,
  );
});
