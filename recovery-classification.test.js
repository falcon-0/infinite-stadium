import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recoveryClassification,
  RECOVERY_KINDS,
  BALL_WIN_RECOVERY_KINDS,
} from './recovery-classification.js';
import { matchState } from './match-stream.js';
import { watchStats } from './watch-stats.js';
import { matchPicture } from './match-picture.js';

test('only explicit known recovery kinds establish ball wins, with raw records unchanged', () => {
  for (const recoveryKind of BALL_WIN_RECOVERY_KINDS) {
    const row = { type: 'recovery', recoveryKind, result: false };
    const before = structuredClone(row);
    assert.equal(recoveryClassification(row), 'ball-win');
    assert.deepEqual(row, before);
  }
  assert.equal(
    recoveryClassification({ type: 'recovery', recoveryKind: 'segment-start' }),
    'initial-control',
  );
  for (const recoveryKind of [undefined, null, 'assumed-interception', 'assumed-save'])
    assert.equal(recoveryClassification({ type: 'recovery', recoveryKind }), 'unknown');
  assert.equal(recoveryClassification({ type: 'receive', recoveryKind: 'loose-ball' }), null);
  assert.ok(Object.isFrozen(RECOVERY_KINDS));
  assert.ok(Object.isFrozen(BALL_WIN_RECOVERY_KINDS));
});

test('all authored comparison families use known classifications and agree across current statistics', () => {
  for (const kind of ['quiet', 'sustained', 'counter', 'duel'])
    for (const seed of [17, 2719, 48371]) {
      const state = matchState({ kind, seed, time: 120 }),
        raw = state.events.filter((e) => e.type === 'recovery'),
        before = structuredClone(raw);
      assert.ok(raw.every((e) => RECOVERY_KINDS.includes(e.recoveryKind)));
      const stats = watchStats(state.events),
        picture = matchPicture(state.events, 120);
      for (const team of ['home', 'away']) {
        const wins = raw.filter((e) => e.team === team && recoveryClassification(e) === 'ball-win');
        assert.equal(stats[team].ballWins, wins.length);
        assert.equal(stats[team].ballWinsUnknown, undefined);
        const cell = picture.teams.find((t) => t.id === team).cells.recoveries;
        assert.equal(cell.value, wins.length);
        assert.equal(cell.complete, true);
        assert.equal(cell.unknownCount, 0);
      }
      assert.deepEqual(raw, before);
    }
});
