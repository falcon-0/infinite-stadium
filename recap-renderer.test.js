import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecapFacts } from './recap-renderer.js';
import { createRecapFacts, buildRecapFacts } from './recap-facts.js';
import { fixtureTeams } from './fixture-settings.js';

const packet = (input) =>
  createRecapFacts({
    source: 'integrated-match',
    kind: 'extended',
    seed: 2039,
    time: 362,
    audience: 'analyst',
    ...input,
  });
const overview = (catalog) => catalog.facts.find((fact) => fact.kind === 'recap-overview');
const choose = (catalog, ...kinds) => [
  overview(catalog).id,
  ...kinds.map((kind) => catalog.facts.find((fact) => fact.kind === kind).id),
];

test('completed six-minute overview describes received segment and keeps entire corrected inventory', () => {
  const { catalog } = packet(),
    saved = structuredClone(catalog),
    fact = overview(catalog);
  const result = renderRecapFacts(catalog, [fact.id]);
  assert.equal(
    result.claims[0].text,
    'Synthetic segment through 06:02: Northbridge 2-1 Harbour Athletic. Demo segment complete (6 minutes).',
  );
  assert.equal(result.claims[0].evidence.length, 50);
  assert.deepEqual(result.claims[0].evidence, fact.evidence);
  assert.match(result.limitation, /not a full match/);
  assert.doesNotMatch(result.claims[0].text, /winner|won|caused/i);
  result.claims[0].evidence[0].revision = 99;
  assert.deepEqual(catalog, saved);
});

test('all five fact kinds render in four languages with exact support and overview first', () => {
  const { catalog } = packet({ favoritePlayer: 'A. Reed' });
  assert.equal(new Set(catalog.facts.map((fact) => fact.kind)).size, 5);
  for (const language of ['en', 'es', 'fr', 'pt'])
    for (const fact of catalog.facts) {
      const ids = fact.kind === 'recap-overview' ? [fact.id] : [overview(catalog).id, fact.id];
      const output = renderRecapFacts(catalog, ids, { language, audience: 'analyst' });
      assert.equal(output.language, language);
      const claim = output.claims.at(-1);
      assert.equal(claim.factId, fact.id);
      assert.ok(claim.text.length > 10);
      assert.deepEqual(claim.evidence, fact.evidence);
    }
});

test('all localized recap club references come from the exact current fixture scope', () => {
  for (const [kind, seed] of [
    ['quiet', 73],
    ['interrupted', 41],
    ['counter', 1000],
  ]) {
    const { catalog } = packet({ kind, seed, time: 120 }),
      clubs = fixtureTeams(kind, seed);
    assert.deepEqual(catalog.scope.teams, clubs);
    for (const language of ['en', 'es', 'fr', 'pt'])
      for (const fact of catalog.facts) {
        const ids = fact.kind === 'recap-overview' ? [fact.id] : [overview(catalog).id, fact.id],
          claims = renderRecapFacts(catalog, ids, { language, audience: 'analyst' }).claims;
        assert.ok(claims[0].text.includes(clubs.home));
        assert.ok(claims[0].text.includes(clubs.away));
        if (fact.values.team) assert.ok(claims.at(-1).text.includes(clubs[fact.values.team]));
        assert.doesNotMatch(claims.map((c) => c.text).join(' '), /Northbridge|Harbour Athletic/);
        assert.deepEqual(claims.at(-1).evidence, fact.evidence);
      }
  }
});

test('localized player recap separates unknown recoveries and initial control from known ball wins', () => {
  const events = [
    ['start', 'segment-start'],
    ['win', 'interception'],
    ['unknown', undefined],
  ].map(([id, recoveryKind], i) => ({
    id,
    revision: 1,
    time: i,
    arrivedAt: i,
    type: 'recovery',
    team: 'home',
    playerId: 'home-7',
    player: 'J. Cole',
    recoveryKind,
  }));
  const { catalog } = buildRecapFacts(
    {
      state: {
        time: 3,
        events,
        metadata: { kind: 'central', seed: 17, segmentDuration: 8, observationHorizon: 12 },
      },
    },
    { favoritePlayer: 'J. Cole' },
  );
  const actor = catalog.facts.find((f) => f.kind === 'recap-player-actions');
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const claim = renderRecapFacts(catalog, [overview(catalog).id, actor.id], {
      language,
      audience: 'player',
    }).claims[1];
    assert.match(claim.text, /uncertain|incierto|incertain|incerto/);
    assert.match(claim.text, /initial|inicial/);
    assert.deepEqual(claim.evidence, actor.evidence);
    assert.doesNotMatch(
      claim.text,
      /3 ball wins|3 balones recuperados|3 ballons récupérés|3 bolas recuperadas/,
    );
  }
  for (const mutate of [
    (c) => (c.scope.teams.home = '<script>'),
    (c) => (c.scope.teams.extra = 'Other'),
    (c) => (c.facts[0].values.unsupported = 'new fact'),
    (c) => (c.facts[0].extra = 'new fact'),
    (c) => c.facts.find((f) => f.kind === 'recap-player-actions').values.ballWins++,
    (c) =>
      (c.facts.find((f) => f.kind === 'recap-player-actions').values.recoveryClassificationVersion =
        'unknown'),
    (c) => (c.facts.find((f) => f.kind === 'recap-player-actions').values.playerId = ''),
  ]) {
    const bad = structuredClone(catalog);
    mutate(bad);
    assert.throws(() => renderRecapFacts(bad, [overview(bad).id, actor.id]), TypeError);
  }
});

test('goal recaps preserve the exact current scorer and team in every language, with a null-name fallback', () => {
  const { catalog } = packet();
  const goals = catalog.facts.filter((fact) => fact.kind === 'recap-goal-score-change');
  for (const language of ['en', 'es', 'fr', 'pt'])
    for (const fact of goals) {
      const claim = renderRecapFacts(catalog, [overview(catalog).id, fact.id], { language })
        .claims[1];
      const club = fact.values.team === 'home' ? 'Northbridge' : 'Harbour Athletic';
      assert.ok(claim.text.startsWith(`${fact.values.player} (${club}) `));
      assert.ok(claim.text.includes(`${fact.values.beforeHome}-${fact.values.beforeAway}`));
      assert.ok(claim.text.includes(`${fact.values.afterHome}-${fact.values.afterAway}`));
      assert.deepEqual(claim.evidence, fact.evidence);
      const unnamed = structuredClone(catalog),
        goal = unnamed.facts.find((candidate) => candidate.id === fact.id);
      goal.values.player = null;
      const fallback = renderRecapFacts(unnamed, [overview(unnamed).id, goal.id], { language })
        .claims[1];
      assert.ok(fallback.text.startsWith(`${club} `));
      assert.doesNotMatch(fallback.text, /null|undefined|\(Northbridge\)|\(Harbour Athletic\)/);
    }
});

test('scorer display comes only from the selected current goal fact and retains corrected citations', () => {
  const { catalog } = packet();
  const goal = catalog.facts.find(
    (fact) => fact.kind === 'recap-goal-score-change' && fact.values.team === 'away',
  );
  const corrected = structuredClone(catalog),
    current = corrected.facts.find((fact) => fact.id === goal.id);
  current.values.player = 'Corrected scorer É. Silva';
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const claim = renderRecapFacts(corrected, [overview(corrected).id, current.id], { language })
      .claims[1];
    assert.ok(claim.text.startsWith('Corrected scorer É. Silva (Harbour Athletic) '));
    assert.doesNotMatch(claim.text, /D\. Silva|A\. Reed/);
    assert.deepEqual(claim.evidence, goal.evidence);
    assert.ok(claim.evidence.some((ref) => ref.id === goal.values.anchorId && ref.revision === 2));
  }
  assert.equal(goal.values.player, 'D. Silva');
});

test('pass completion percentages use known outcomes and omit percentages when all attempts are pending', () => {
  const complete = packet().catalog,
    passes = complete.facts.find(
      (fact) => fact.kind === 'recap-team-passes' && fact.values.team === 'home',
    );
  const result = renderRecapFacts(complete, [overview(complete).id, passes.id], {
    audience: 'analyst',
  });
  assert.match(result.claims[1].text, /4 passes completed, 2 unsuccessful \(66\.7% completion\)/);
  assert.doesNotMatch(result.claims[1].text, /pending|confirmation|known|recorded/);
  assert.match(result.claims[1].text, /00:00–06:02/);
  const french = renderRecapFacts(complete, [overview(complete).id, passes.id], { language: 'fr' });
  assert.match(french.claims[1].text, /66,7 %/);
  const pending = packet({ time: 22 }).catalog,
    unknown = pending.facts.find((fact) => fact.kind === 'recap-team-passes');
  const claim = renderRecapFacts(pending, [overview(pending).id, unknown.id]).claims[1];
  assert.match(claim.text, /1 pass awaits confirmation/);
  assert.match(claim.text, /00:00–00:22/);
  assert.doesNotMatch(claim.text, /%|NaN|Infinity/);
});

test('four-language pass copy separates unconfirmed attempts from the percentage denominator', () => {
  const complete = packet().catalog,
    passes = complete.facts.find((f) => f.kind === 'recap-team-passes' && f.values.team === 'home');
  const pending = packet({ time: 22 }).catalog,
    unknown = pending.facts.find((f) => f.kind === 'recap-team-passes');
  const mixed = structuredClone(complete),
    somePending = mixed.facts.find((f) => f.id === passes.id);
  Object.assign(somePending.values, { known: 3, completed: 2, failed: 1, pending: 3 });
  const confirmation = {
    en: 'confirmation',
    es: 'confirmación',
    fr: 'confirmation',
    pt: 'confirmação',
  };
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const known = renderRecapFacts(complete, [overview(complete).id, passes.id], { language })
      .claims[1];
    assert.match(known.text, language === 'en' ? /66\.7%/ : /66,7\s?%/);
    assert.ok(!known.text.includes(confirmation[language]));
    const awaiting = renderRecapFacts(pending, [overview(pending).id, unknown.id], { language })
      .claims[1];
    assert.ok(awaiting.text.includes(confirmation[language]));
    assert.ok(awaiting.text.includes('1 '));
    assert.doesNotMatch(awaiting.text, /%|NaN|Infinity/);
    assert.ok(awaiting.text.includes('00:00–00:22'));
    const partial = renderRecapFacts(mixed, [overview(mixed).id, somePending.id], { language })
      .claims[1];
    assert.match(partial.text, language === 'en' ? /66\.7%/ : /66,7\s?%/);
    assert.doesNotMatch(partial.text, /33[.,]3/);
    assert.ok(partial.text.includes('3 '));
    assert.ok(partial.text.includes(confirmation[language]));
    assert.deepEqual(partial.evidence, somePending.evidence);
    assert.equal(partial.evidence.length, 6);
  }
  assert.deepEqual(passes.values, {
    team: 'home',
    total: 6,
    known: 6,
    completed: 4,
    failed: 2,
    pending: 0,
    start: 0,
    end: 362,
  });
});

test('natural recap copy retains synthetic segment scope, clocks and uncertainty in four languages', () => {
  const { catalog } = packet({ favoritePlayer: 'A. Reed' });
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const overviewClaim = renderRecapFacts(catalog, [overview(catalog).id], { language }).claims[0];
    assert.ok(overviewClaim.text.includes('06:02'));
    assert.ok(overviewClaim.text.includes('2-1'));
    assert.match(overviewClaim.text, /Synthetic|sintético|synthétique/);
    assert.doesNotMatch(overviewClaim.text, /\?|winner|full match|match final/i);
    const actor = catalog.facts.find((f) => f.kind === 'recap-player-actions');
    const player = renderRecapFacts(catalog, [overview(catalog).id, actor.id], { language })
      .claims[1];
    assert.ok(player.text.includes('A. Reed'));
    assert.ok(player.text.includes('00:00–06:02'));
    assert.deepEqual(player.evidence, actor.evidence);
    assert.equal(player.evidence.length, actor.values.total);
  }
});

test('goal meaning retains earlier score support and selected goal highlights must be chronological', () => {
  const { catalog } = packet(),
    goals = catalog.facts.filter((fact) => fact.kind === 'recap-goal-score-change');
  const result = renderRecapFacts(
    catalog,
    [overview(catalog).id, ...goals.map((fact) => fact.id)],
    { audience: 'analyst' },
  );
  assert.match(result.claims[2].text, /D\. Silva \(Harbour Athletic\) equalized.*02:58: 1-0 → 1-1/);
  assert.equal(result.claims[2].evidence.length, 2);
  assert.ok(
    result.claims[2].evidence.some(
      (ref) => ref.id === 'extended-2039-0-shot' && ref.revision === 2,
    ),
  );
  assert.throws(
    () =>
      renderRecapFacts(catalog, [overview(catalog).id, ...goals.map((fact) => fact.id).reverse()], {
        audience: 'analyst',
      }),
    /chronological/,
  );
});

test('favorite player recap reports observed actor counts and cannot select an absent or unobserved participant', () => {
  const recorded = packet({ audience: 'player', favoritePlayer: 'A. Reed' }).catalog;
  const actor = recorded.facts.find((fact) => fact.kind === 'recap-player-actions');
  const claim = renderRecapFacts(recorded, choose(recorded, 'recap-player-actions'), {
    audience: 'player',
  }).claims[1];
  assert.ok(claim.text.includes('A. Reed'));
  assert.ok(claim.text.includes(`${actor.values.total} actions`));
  assert.equal(claim.evidence.length, actor.values.total);
  for (const input of [
    { favoritePlayer: 'M. Vale' },
    { kind: 'sustained', seed: 17, time: 0, favoritePlayer: 'R. Hughes' },
  ]) {
    const absent = packet({ audience: 'player', ...input }).catalog;
    assert.equal(
      absent.facts.some((fact) => fact.kind === 'recap-player-actions'),
      false,
      'Recap has no roster identity proof for a zero-action participant',
    );
    for (const language of ['en', 'es', 'fr', 'pt']) {
      const output = renderRecapFacts(absent, [overview(absent).id], {
        audience: 'player',
        language,
      });
      assert.equal(output.claims.length, 1);
      assert.ok(!output.claims[0].text.includes(input.favoritePlayer));
      assert.deepEqual(output.claims[0].evidence, overview(absent).evidence);
      assert.throws(
        () =>
          renderRecapFacts(absent, [overview(absent).id, actor.id], {
            audience: 'player',
            language,
          }),
        RangeError,
        'A fact from another selected-player catalog cannot create a participant',
      );
    }
  }
});

test('partial and short fixtures never appear as completed six-minute or full-match results', () => {
  const partial = packet({ time: 180 }).catalog;
  assert.match(
    renderRecapFacts(partial, [overview(partial).id]).claims[0].text,
    /through 03:00.*1-1.*in progress/,
  );
  const short = packet({ kind: 'central', time: 8 }).catalog;
  assert.match(
    renderRecapFacts(short, [overview(short).id]).claims[0].text,
    /Synthetic segment through 00:08.*complete \(8s\)/,
  );
});

test('invalid selection objects, missing overview, unknown IDs and audience limits fail closed', () => {
  const { catalog } = packet(),
    first = overview(catalog).id,
    others = catalog.facts.filter((f) => f.id !== first).map((f) => f.id);
  for (const ids of [
    [],
    [others[0]],
    [first, 'unknown'],
    [first, first],
    [{ id: first }],
    [first, ...others.slice(0, 3)],
  ])
    assert.throws(() => renderRecapFacts(catalog, ids), RangeError);
  assert.throws(() => renderRecapFacts(catalog, [first], { language: 'de' }), RangeError);
  assert.throws(() => renderRecapFacts(catalog, [first], { audience: 'producer' }), RangeError);
});

test('inconsistent typed counts, scopes, score effects and incomplete revisions cannot be rendered', () => {
  const original = packet({ favoritePlayer: 'A. Reed' }).catalog;
  const changes = [
    (c) => (overview(c).values.status = 'in-progress'),
    (c) => overview(c).values.eventCount++,
    (c) => c.scope.observedAt--,
    (c) => (c.scope.fixture.synthetic = false),
    (c) => c.facts.find((f) => f.kind === 'recap-team-shots').values.count++,
    (c) => c.facts.find((f) => f.kind === 'recap-team-passes').values.known++,
    (c) => (c.facts.find((f) => f.kind === 'recap-goal-score-change').values.effect = 'invented'),
    (c) => c.facts.find((f) => f.kind === 'recap-goal-score-change').evidence.pop(),
    (c) => c.facts.find((f) => f.kind === 'recap-player-actions').evidence.pop(),
    (c) => c.facts.find((f) => f.kind === 'recap-team-shots').evidence[0].revision++,
    (c) => c.facts.push(structuredClone(c.facts[0])),
  ];
  for (const mutate of changes) {
    const catalog = structuredClone(original);
    mutate(catalog);
    assert.throws(() => renderRecapFacts(catalog, [overview(catalog).id]), TypeError);
  }
});
