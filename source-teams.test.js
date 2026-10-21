import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTeams } from './source-teams.js';
import { matchCatalogue } from './fixture-settings.js';
import { matchState } from './match-stream.js';
import { catchup } from './catchup.js';
import { matchPicture } from './match-picture.js';
import { createInvestigationTools } from './investigation-tools.js';
import { storyFacts } from './story-facts.js';
import { renderFactStory } from './fact-renderer.js';

test('source labels are bounded detached identity, never an invented named fixture', () => {
  assert.deepEqual(sourceTeams(), { home: 'Home', away: 'Away' });
  const teams = { home: 'Étoile d’Or FC', away: 'Westhaven FC' },
    result = sourceTeams(teams);
  assert.ok(Object.isFrozen(result));
  teams.home = 'Changed FC';
  assert.equal(result.home, 'Étoile d’Or FC');
  for (const invalid of [
    null,
    [],
    {},
    { home: 'Same', away: 'Same' },
    { home: 'Good', away: 'Other', extra: 'ignored' },
    { home: '<script>', away: 'Other' },
    { home: 'Good\nInjected', away: 'Other' },
    { home: 'A'.repeat(101), away: 'Other' },
  ])
    assert.throws(() => sourceTeams(invalid));
  assert.deepEqual(sourceTeams(undefined, [{ team: 'away', teamName: 'Westhaven FC' }]), {
    home: 'Home',
    away: 'Westhaven FC',
  });
  assert.throws(
    () =>
      sourceTeams({ home: 'Eastvale', away: 'Westhaven' }, [
        { team: 'away', teamName: 'Harbour Athletic' },
      ]),
    /conflict/,
  );
  assert.throws(
    () =>
      sourceTeams(undefined, [
        { team: 'home', teamName: 'First' },
        { team: 'home', teamName: 'Second' },
      ]),
    /conflict/,
  );
  assert.throws(
    () => sourceTeams(undefined, [{ team: 'home', teamName: 'bad\u202Ename' }]),
    /conflict/,
  );
});

test('all twenty actual fixture identities survive catch-up, picture, tools, catalog and four-language rendering', () => {
  assert.equal(matchCatalogue.length, 20);
  for (const fixture of matchCatalogue) {
    const state = matchState({ ...fixture, time: 120 }),
      teams = state.metadata.teams;
    const anchor = state.events.filter((row) => row.type === 'shot').at(-1) || state.events.at(-1);
    const tools = createInvestigationTools({ ...fixture, time: 120, anchorId: anchor.id });
    const packet = tools.execute('get_event_sequence', {}),
      catalog = storyFacts({ get_event_sequence: packet });
    assert.deepEqual(catalog.scope.teams, teams);
    assert.deepEqual(tools.scope.teams, teams);
    const moment = catalog.facts.find((fact) => fact.kind === 'moment');
    assert.ok(moment);
    for (const language of ['en', 'es', 'fr', 'pt']) {
      const result = catchup(state.events, 120, 0, { language, teams }),
        picture = matchPicture(state.events, 120, { language, teams });
      assert.deepEqual(result.teams, teams);
      assert.deepEqual(
        picture.teams.map((side) => side.name),
        [teams.home, teams.away],
      );
      for (const highlight of result.highlights) {
        const event = state.events.find((row) => row.id === highlight.anchorId);
        assert.ok(highlight.text.endsWith(`(${teams[event.team]}).`));
      }
      const claim = renderFactStory(catalog, [moment.id], { language }).claims[0];
      assert.ok(claim.text.includes(teams[anchor.team]));
      assert.deepEqual(claim.evidence, moment.evidence);
      if (fixture.id !== 'northbridge-harbour')
        assert.doesNotMatch(claim.text, /Northbridge|Harbour Athletic/);
    }
    packet.scope.teams.home = 'Mutated FC';
    assert.deepEqual(tools.execute('get_event_sequence', {}).scope.teams, teams);
  }
});

test('an inactive away club remains named with no received actions and no fabricated action evidence', () => {
  for (const time of [0, 4, 20, 120]) {
    const state = matchState({ kind: 'quiet', seed: 73, time });
    assert.equal(
      state.events.some((row) => row.team === 'away'),
      false,
    );
    const picture = matchPicture(state.events, time, { teams: state.metadata.teams }),
      away = picture.teams.find((side) => side.id === 'away');
    assert.equal(away.name, 'Westhaven FC');
    assert.equal(away.cells.shots.value, 0);
    assert.deepEqual(away.cells.shots.evidence, []);
    assert.equal(
      catchup(state.events, time, 0, { teams: state.metadata.teams }).teams.away,
      'Westhaven FC',
    );
  }
});

test('only current received club revisions participate and source renames invalidate cached prose', () => {
  const original = {
    id: 'pass',
    revision: 1,
    type: 'pass',
    team: 'home',
    player: 'A. Reed',
    teamName: 'Old Club',
    time: 1,
    arrivedAt: 1,
    result: true,
  };
  const revised = { ...original, revision: 2, teamName: 'New Club', arrivedAt: 3 };
  const future = { ...revised, id: 'future', teamName: 'Unreceived Club', time: 8, arrivedAt: 8 };
  for (const make of [
    (rows, time, teams) => catchup(rows, time, 0, { teams }),
    (rows, time, teams) => matchPicture(rows, time, { teams }),
  ]) {
    const old = make([original, revised, future], 2, { home: 'Old Club', away: 'Other Club' });
    const current = make([original, revised, future], 3, { home: 'New Club', away: 'Other Club' });
    assert.notEqual(old.key, current.key);
    assert.throws(
      () => make([original, revised], 3, { home: 'Old Club', away: 'Other Club' }),
      /conflict/,
    );
    const unnamed = { ...original };
    delete unnamed.teamName;
    const a = make([unnamed], 2, { home: 'First Club', away: 'Other Club' }),
      b = make([unnamed], 2, { home: 'Second Club', away: 'Other Club' });
    assert.notEqual(a.key, b.key, 'Source labels are part of rendered-content cache identity');
    assert.deepEqual(
      a.countsEvidence ?? a.evidence,
      b.countsEvidence ?? b.evidence,
      'Renaming a source does not alter action evidence',
    );
  }
});

test('catalog retains detached source identity and rejects mixing tool labels or malformed renderer scope', () => {
  const tools = createInvestigationTools({
    kind: 'sustained',
    seed: 17,
    time: 120,
    anchorId: 'comparison-sustained-17-shot-116',
  });
  const packets = Object.fromEntries(
    ['get_event_sequence', 'score_at_moment'].map((name) => [name, tools.execute(name, {})]),
  );
  const current = storyFacts(packets),
    moment = current.facts.find((f) => f.kind === 'moment');
  const mixed = structuredClone(packets);
  mixed.score_at_moment.scope.teams.home = 'Another Club';
  assert.equal(
    storyFacts(mixed).facts.some((f) => f.kind === 'score' || f.kind === 'goal-score-change'),
    false,
  );
  packets.get_event_sequence.scope.teams.home = 'Mutated Club';
  assert.equal(current.scope.teams.home, 'Northbridge');
  const renamed = structuredClone(packets);
  renamed.score_at_moment.scope.teams.home = 'Mutated Club';
  assert.notEqual(storyFacts(renamed).facts.find((f) => f.kind === 'moment').id, moment.id);
  for (const teams of [
    { home: '<b>Fake</b>', away: 'Other' },
    { home: 'Good', away: 'Other', extra: 'ignored' },
    null,
  ])
    assert.throws(
      () => renderFactStory({ ...current, scope: { ...current.scope, teams } }, [moment.id]),
      TypeError,
    );
  assert.match(renderFactStory({ facts: [moment] }, [moment.id]).claims[0].text, /Home/);
});
