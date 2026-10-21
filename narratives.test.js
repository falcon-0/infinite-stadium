import test from 'node:test';
import assert from 'node:assert/strict';
import { feed } from './engine.js';
import { matchRecap, recapChanges, recapFromState } from './narratives.js';
import { matchState } from './match-stream.js';
import { recoveryClassification } from './recovery-classification.js';

test('recap and overlay output contain only received evidence', () => {
  for (const time of [0, 76, 130, 163, 169, 190, 284, 360]) {
    const recap = matchRecap(time);
    const received = new Map(
      feed.filter((e) => e.time <= time && e.arrivedAt <= time).map((e) => [e.id, e]),
    );
    for (const entry of recap.entries) {
      assert.ok(entry.time <= time);
      for (const reference of entry.evidence)
        assert.equal(received.get(reference.id)?.revision, reference.revision);
    }
    for (const overlay of recap.overlays) {
      assert.ok(overlay.timing.expiresAt > time);
      assert.ok(overlay.timing.availableAt <= time);
    }
  }
  assert.equal(
    matchRecap(168).entries.some((e) => e.anchorId === 'EV-017'),
    false,
  );
  assert.equal(
    matchRecap(169).overlays.some((e) => e.anchorId === 'EV-017'),
    true,
  );
  assert.equal(
    matchRecap(190).overlays.some((e) => e.anchorId === 'EV-017'),
    false,
  );
});
test('scorer correction repairs recap entries without changing score; rewind restores old entry', () => {
  const before = matchRecap(169),
    after = matchRecap(190);
  assert.deepEqual(before.score, after.score);
  assert.match(before.entries.find((e) => e.anchorId === 'EV-017').text, /A\. Reed/);
  assert.match(after.entries.find((e) => e.anchorId === 'EV-017').text, /J\. Cole/);
  const change = recapChanges(before, after);
  assert.equal(change.summaryChanged, true);
  assert.deepEqual(
    change.upserts.map((e) => e.anchorId),
    ['EV-017'],
  );
  assert.deepEqual(change.withdrawals, []);
  assert.deepEqual(matchRecap(169), before);
});
test('goal deletion withdraws a narrative and repairs later score context', () => {
  const before = matchRecap(360);
  const goal = feed.find((e) => e.id === 'EV-017');
  const messages = [...feed, { ...goal, revision: 3, arrivedAt: 350, operation: 'delete' }];
  const after = matchRecap(360, {}, messages),
    changes = recapChanges(before, after);
  assert.deepEqual(after.score, { home: 0, away: 1 });
  assert.ok(changes.withdrawals.includes('narrative-EV-017'));
  assert.ok(changes.upserts.some((e) => e.anchorId === 'EV-024'));
  assert.match(after.entries.find((e) => e.anchorId === 'EV-024').text, /0-1/);
});
test('audiences differ and favorites change bounded selection with transparent reasons', () => {
  const newcomer = matchRecap(360, { audience: 'newcomer' }),
    analyst = matchRecap(360, { audience: 'analyst' });
  assert.deepEqual(
    newcomer.entries.map((e) => e.anchorId),
    analyst.entries.map((e) => e.anchorId),
  );
  assert.notEqual(newcomer.entries[0].text, analyst.entries[0].text);
  const player = matchRecap(360, { audience: 'player', favoritePlayer: 'D. Silva', limit: 3 });
  assert.ok(player.entries.some((e) => e.anchorId === 'EV-007' && e.preferenceMatch));
  assert.equal(player.entries.length, 3);
  for (const entry of player.entries) assert.ok(entry.selectionReason);
});
test('late evidence changes a bounded narrative and invalid inputs are rejected', () => {
  const late = { ...feed[0], id: 'LATE-PASS', time: 166, arrivedAt: 180, player: 'J. Cole' };
  const before = matchRecap(169, {}, [...feed, late]),
    after = matchRecap(180, {}, [...feed, late]);
  assert.ok(recapChanges(before, after).upserts.some((e) => e.anchorId === 'EV-017'));
  for (const input of [
    { limit: 0 },
    { audience: 'invented' },
    { favoriteClub: 'unknown' },
    { favoritePlayer: '<unknown>' },
    { favoritePlayer: '' },
  ])
    assert.throws(() => matchRecap(169, input));
  for (const favoritePlayer of ['R. Hughes', 'L. Evans', 'Unknown Player']) {
    const recap = matchRecap(169, { audience: 'player', favoritePlayer });
    assert.equal(recap.preferences.favoritePlayer, favoritePlayer);
    assert.ok(
      recap.entries.every((entry) => !entry.preferenceMatch),
      'a safe unobserved name is a choice, not an invented participant',
    );
  }
  for (const time of [-1, 361, NaN]) assert.throws(() => matchRecap(time));
});

test('pending and missing shot outcomes do not become misses in any narrative audience or language', () => {
  const shot = {
    ...feed.find((e) => e.type === 'shot'),
    id: 'UNKNOWN-SHOT',
    time: 10,
    arrivedAt: 10,
    revision: 1,
  };
  for (const audience of ['newcomer', 'analyst', 'player'])
    for (const language of ['en', 'es', 'fr', 'pt'])
      for (const result of [null, undefined]) {
        const recap = matchRecap(10, { audience, language }, [{ ...shot, result }]);
        const entry = recap.entries[0];
        assert.deepEqual(recap.score, { home: 0, away: 0 });
        assert.match(
          entry.text,
          language === 'en'
            ? /outcome is not yet known/
            : language === 'es'
              ? /resultado aún no se conoce/
              : language === 'fr'
                ? /résultat n’est pas encore connu/
                : /resultado ainda não é conhecido/,
        );
        assert.doesNotMatch(entry.text, /without scoring|sin marcar|sans marquer|sem marcar/);
        assert.deepEqual(entry.evidence, [{ id: 'UNKNOWN-SHOT', revision: 1 }]);
      }
  const pending = matchRecap(10, {}, [{ ...shot, result: null }]);
  const goal = matchRecap(11, {}, [
    { ...shot, result: null },
    { ...shot, result: true, revision: 2, arrivedAt: 11 },
  ]);
  assert.deepEqual(goal.score, {
    home: shot.team === 'home' ? 1 : 0,
    away: shot.team === 'away' ? 1 : 0,
  });
  assert.match(goal.entries[0].text, /scored/);
  assert.equal(recapChanges(pending, goal).upserts.length, 1);
  assert.match(
    matchRecap(10, {}, [{ ...shot, result: false }]).entries[0].text,
    /shot but did not score/,
  );
});

test('current corrected off-target narrative is natural, scoped and keeps analyst counts without inline warnings', () => {
  const state = matchState({ kind: 'extended', seed: 17, time: 120 });
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const recap = recapFromState(state, { audience: 'analyst', language });
    const entry = recap.entries.find((e) => e.anchorId === 'extended-17-3-shot');
    assert.ok(entry);
    assert.match(entry.text, /D\. Silva/);
    assert.match(entry.text, /1-0/);
    assert.match(entry.text, /01:43–01:58/);
    assert.match(entry.text, /15/);
    assert.ok(entry.evidence.some((ref) => ref.id === 'extended-17-3-shot' && ref.revision === 2));
    assert.ok(entry.limit.length > 0);
    assert.doesNotMatch(
      entry.text,
      /received events|recorded score|tactical cause|cause tactique|causa tática|causa táctica|wide|over the bar/,
    );
    if (language === 'en')
      assert.match(
        entry.text,
        /D\. Silva shot off target \(Harbour Athletic\)\. Score at this moment: 1-0\./,
      );
  }
});

test('nonboolean shot flags cannot become goals in narrative rank, title or moment score', () => {
  const original = feed.find((e) => e.type === 'shot');
  for (const result of ['false', 'true', 1]) {
    const shot = {
      ...original,
      id: 'UNKNOWN-FLAG',
      time: 10,
      arrivedAt: 10,
      revision: 1,
      result,
      outcome: 'saved',
    };
    const recap = matchRecap(10, {}, [shot]),
      entry = recap.entries[0];
    assert.deepEqual(recap.score, { home: 0, away: 0 });
    assert.notEqual(entry.title, 'Goal');
    assert.notEqual(entry.selectionReason, 'goal');
    assert.match(entry.text, /outcome is not yet known/);
    assert.match(entry.text, /Score at this moment: 0-0/);
    assert.doesNotMatch(entry.text, /had a shot saved|scored|shot off target/);
  }
});

test('localized recaps describe keeper collections precisely without changing ball-win measurements', () => {
  for (const [kind, seed, name] of [
    ['counter', 17, 'I. Kerr'],
    ['duel', 17, 'M. Carter'],
    ['counter', 1000, 'K. Grant'],
    ['duel', 1001, 'A. Ahmed'],
  ]) {
    const state = matchState({ kind, seed, time: 120 }),
      before = structuredClone(state);
    assert.ok(
      state.events.some(
        (e) =>
          e.type === 'recovery' &&
          e.recoveryKind === 'goalkeeper-hold' &&
          recoveryClassification(e) === 'ball-win',
      ),
    );
    for (const language of ['en', 'es', 'fr', 'pt']) {
      const recap = recapFromState(state, { language, audience: 'analyst', limit: 10 });
      const collection =
        language === 'en'
          ? 'collected the ball'
          : language === 'es'
            ? 'recogió el balón'
            : language === 'fr'
              ? 'a capté le ballon'
              : 'recolheu a bola';
      const entry = recap.entries.find((e) => e.text.includes(name + ' ' + collection));
      assert.ok(entry, kind + ' ' + seed + ' ' + language);
      assert.ok(
        entry.evidence.some((ref) =>
          state.events.some(
            (e) =>
              e.id === ref.id &&
              e.revision === ref.revision &&
              e.recoveryKind === 'goalkeeper-hold',
          ),
        ),
      );
      assert.deepEqual(recap.stats, state.stats);
      assert.deepEqual(state, before);
    }
  }
});

test('initial or unclassified recap recovery does not assert that a ball was won', () => {
  for (const recoveryKind of ['segment-start', undefined]) {
    const recovery = {
      ...feed.find((e) => e.type === 'recovery'),
      id: 'control',
      time: 1,
      arrivedAt: 1,
      revision: 1,
      recoveryKind,
    };
    const shot = {
      ...feed.find((e) => e.type === 'shot'),
      id: 'shot-control',
      team: recovery.team,
      time: 10,
      arrivedAt: 10,
      revision: 1,
      cause: 'control',
    };
    const entry = matchRecap(10, {}, [recovery, shot]).entries[0];
    assert.doesNotMatch(entry.text, /won the ball/);
    assert.match(entry.text, recoveryKind ? /had control of the ball/ : /collected the ball/);
  }
});
