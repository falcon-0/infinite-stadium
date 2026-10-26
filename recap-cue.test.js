import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecapCue } from './recap-cue.js';
import { generateRecapStory } from './recap-workflow.js';
import { integratedMatch } from './match-stream.js';
import { recapViewKey } from './recap-view.js';

async function fixture(changes = {}) {
  const preferences = {
    kind: 'extended',
    seed: 17,
    audience: 'player',
    language: 'en',
    favoriteClub: 'away',
    favoritePlayer: 'D. Silva',
    ...changes,
  };
  const time = preferences.time ?? 362;
  delete preferences.time;
  const input = { source: 'integrated-match', mode: 'recap', time, ...preferences };
  const draft = await generateRecapStory(input, {
    config: { url: 'https://test.openai.azure.com', deployment: 'test', key: 'test' },
    fetcher: async (_url, options) => {
      const request = JSON.parse(options.body);
      const packet = JSON.parse(request.messages[1].content);
      let raw;
      if (request.response_format.json_schema.name === 'recap_fact_selection') {
        const required = packet.requiredFactIds[0];
        const profile = packet.audienceSelectionRule.blocking
          ? [packet.audienceSelectionRule.playerFactId]
          : [];
        const goals = packet.catalog.facts
          .filter((fact) => fact.kind === 'recap-goal-score-change')
          .map((fact) => fact.id);
        const optional = profile.length ? profile : goals.filter((id) => id !== required);
        raw = { overviewFactId: packet.catalog.facts[0].id };
        for (let i = 1; i < packet.maximum; i++) {
          raw[`context${i}`] =
            required && i === packet.maximum - 1 ? required : (optional.shift() ?? null);
        }
      } else
        raw = {
          decision: 'approve',
          issues: [],
          suggestions: ['A general audience may prefer an equalizer.'],
        };
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(draft.status, 'draft');
  const records = integratedMatch(input).state.events;
  return {
    draft,
    options: { records, time, preferences, requestKey: recapViewKey(records, time, preferences) },
  };
}

test('player rundown preserves all fifty dependencies, ten actor references and latest lead with explicit relative review pacing', async () => {
  const f = await fixture(),
    cue = buildRecapCue(f.draft, f.options);
  assert.equal(cue.schema, 'infinite-stadium.recap-cue.v1');
  assert.equal(cue.synthetic, true);
  assert.equal(cue.status, 'human-review-required');
  assert.equal(cue.dependencies.length, 50);
  assert.equal(cue.evidence.length, 50);
  assert.deepEqual(cue.preferences, f.options.preferences);
  assert.deepEqual(cue.scope, f.draft.scope);
  assert.equal(cue.evidenceKey, f.draft.key);
  assert.deepEqual(
    cue.segments.map((s) => s.kind),
    ['recap-overview', 'recap-player-actions', 'recap-goal-score-change'],
  );
  assert.equal(cue.segments[1].evidence.length, 10);
  assert.equal(cue.segments[2].eventTime, 328);
  assert.deepEqual(
    cue.segments[2].evidence.map((ref) => ref.id),
    ['extended-17-0-shot', 'extended-17-10-shot', 'extended-17-5-shot'],
  );
  assert.deepEqual(
    cue.segments.map((s) => s.timing),
    [0, 6, 12].map((start) => ({
      unit: 'seconds',
      startOffsetSeconds: start,
      durationSeconds: 6,
      endOffsetSeconds: start + 6,
    })),
  );
  assert.deepEqual(cue.timing, {
    unit: 'seconds',
    availableAtObservedTime: 362,
    durationSeconds: 18,
    synchronization: 'reviewed-rundown-relative',
    pacing: 'proposed-six-seconds-per-segment',
    livePublishing: false,
  });
  assert.match(cue.limitation, /not live overlay availability or expiration/);
  assert.match(cue.limitation, /not a full match, signed provenance or a publishing command/);
});

test('recap artifact is detached and excludes execution, traces, style suggestions and access inputs', async () => {
  const f = await fixture();
  f.draft.execution.privateMarker = 'private-execution-marker';
  f.draft.trace.push({ debug: 'private-trace-marker' });
  f.draft.accessToken = 'fake-access-marker';
  const before = structuredClone(f),
    cue = buildRecapCue(f.draft, f.options),
    json = JSON.stringify(cue);
  for (const marker of [
    'private-execution-marker',
    'private-trace-marker',
    'fake-access-marker',
    'A general audience may prefer an equalizer.',
  ])
    assert.equal(json.includes(marker), false);
  assert.deepEqual(f, before);
  cue.segments[0].text = 'changed';
  cue.dependencies[0].revision = 999;
  cue.preferences.favoritePlayer = 'changed';
  cue.scope.observedAt = 999;
  assert.deepEqual(f, before);
});

test('withheld, pending, experimental and noncanonical authorship cannot be exported', async () => {
  const f = await fixture();
  for (const alter of [
    (draft) => (draft.status = 'withheld'),
    (draft) => (draft.status = 'pending'),
    (draft) => (draft.source = 'azure-ai'),
    (draft) => (draft.provider = 'template'),
    (draft) => (draft.evidenceSource = 'real-match'),
    (draft) => (draft.authorship.wording = 'model-prose'),
    (draft) => (draft.authorship.selection = 'unrecognized-model'),
    (draft) => (draft.authorship.mandatoryFacts = 'model-selected'),
    (draft) => (draft.authorship.additionalContext = 'unknown-model'),
  ]) {
    const draft = structuredClone(f.draft);
    alter(draft);
    assert.throws(() => buildRecapCue(draft, f.options), /canonical/);
  }
});

test('changed time, fixture, seed, favorites, audience, language and request identity are superseded', async () => {
  const f = await fixture();
  for (const change of [
    { time: 361 },
    { preferences: { ...f.options.preferences, kind: 'central' } },
    { preferences: { ...f.options.preferences, seed: 18 } },
    { preferences: { ...f.options.preferences, favoriteClub: 'home' } },
    { preferences: { ...f.options.preferences, favoritePlayer: 'A. Reed' } },
    { preferences: { ...f.options.preferences, audience: 'analyst' } },
    { preferences: { ...f.options.preferences, language: 'fr' } },
    { requestKey: 'stale-request' },
  ])
    assert.throws(() => buildRecapCue(f.draft, { ...f.options, ...change }), /superseded/);
});

test('real late corrections and provider withdrawal invalidate previously captured recaps', async () => {
  const f = await fixture({
    kind: 'withdrawal',
    audience: 'newcomer',
    favoriteClub: null,
    favoritePlayer: null,
    time: 8,
  });
  for (const time of [10, 11]) {
    const records = integratedMatch({ ...f.options.preferences, time }).state.events;
    const draft = structuredClone(f.draft);
    draft.scope.observedAt = time;
    draft.observedAt = time;
    assert.throws(
      () =>
        buildRecapCue(draft, {
          ...f.options,
          time,
          records,
          requestKey: recapViewKey(records, time, f.options.preferences),
        }),
      /superseded|canonical/,
    );
  }
});

test('deleted, newly late, duplicate, future and malformed current records fail closed', async () => {
  const f = await fixture();
  const late = { ...f.options.records[0], id: 'new-late-record', time: 361, arrivedAt: 362 };
  for (const records of [
    f.options.records.slice(1),
    [...f.options.records, late],
    [...f.options.records, f.options.records[0]],
    f.options.records.map((e, i) => (i === 0 ? { ...e, operation: 'delete' } : e)),
    f.options.records.map((e, i) => (i === 0 ? { ...e, arrivedAt: 363 } : e)),
    f.options.records.map((e, i) => (i === 0 ? { ...e, revision: 0 } : e)),
  ]) {
    assert.throws(
      () =>
        buildRecapCue(f.draft, {
          ...f.options,
          records,
          requestKey: recapViewKey(records, f.options.time, f.options.preferences),
        }),
      /superseded|active inventory/,
    );
  }
});

test('same ID and revision with changed body is rejected despite an unchanged view request key', async () => {
  const f = await fixture(),
    records = structuredClone(f.options.records),
    shot = records.find((e) => e.type === 'shot' && e.result === true);
  shot.result = false;
  assert.equal(recapViewKey(records, f.options.time, f.options.preferences), f.options.requestKey);
  assert.throws(() => buildRecapCue(f.draft, { ...f.options, records }), /record contents/);
});

test('complete canonical claim text, facts and exact reference unions are mandatory', async () => {
  const f = await fixture();
  for (const alter of [
    (draft) => draft.claims[1].evidence.pop(),
    (draft) => draft.dependencies.pop(),
    (draft) => (draft.claims[1].text = 'D. Silva scored twice.'),
    (draft) => draft.claims[1].evidence.push({ ...draft.claims[1].evidence[0] }),
    (draft) => draft.claims[1].evidence[0].revision++,
    (draft) => (draft.claims[1].extra = 'generated prose'),
    (draft) => (draft.selectedFacts[1].values.goals = 2),
    (draft) => (draft.selectedFacts[1].extra = 'unknown-field'),
    (draft) => (draft.selectedFactIds[1] = 'unknown-fact'),
    (draft) => (draft.scope.fixture.segmentDuration = 90),
    (draft) => (draft.observedAt = 361),
  ]) {
    const draft = structuredClone(f.draft);
    alter(draft);
    assert.throws(() => buildRecapCue(draft, f.options));
  }
});

test('latest score change and player profile cannot be omitted even when remaining claims are canonical and fully cited', async () => {
  const f = await fixture();
  for (const kind of ['recap-player-actions', 'recap-goal-score-change']) {
    const draft = structuredClone(f.draft),
      index = draft.selectedFacts.findIndex((f) => f.kind === kind);
    draft.selectedFacts.splice(index, 1);
    draft.selectedFactIds.splice(index, 1);
    draft.claims.splice(index, 1);
    assert.throws(
      () => buildRecapCue(draft, f.options),
      /latest supported recorded-score change|favorite-player/,
    );
  }
});

test('selected goal highlights remain chronologically ordered and recap overview leads', async () => {
  const f = await fixture({ audience: 'analyst', favoritePlayer: null }),
    cue = buildRecapCue(f.draft, f.options);
  assert.deepEqual(
    cue.segments.filter((s) => s.kind === 'recap-goal-score-change').map((s) => s.eventTime),
    [28, 178, 328],
  );
  const reversed = structuredClone(f.draft);
  for (const field of ['selectedFacts', 'selectedFactIds', 'claims'])
    reversed[field] = [reversed[field][0], ...reversed[field].slice(1).reverse()];
  assert.throws(() => buildRecapCue(reversed, f.options), /chronological/);
  const overviewLast = structuredClone(f.draft);
  for (const field of ['selectedFacts', 'selectedFactIds', 'claims'])
    overviewLast[field].push(overviewLast[field].shift());
  assert.throws(() => buildRecapCue(overviewLast, f.options), /overview first/);
});

test('unknown request/preference fields, malformed inventory and nonfinite time are outside the cue contract', async () => {
  const f = await fixture();
  for (const options of [
    { ...f.options, accessCode: 'unrelated' },
    { ...f.options, preferences: { ...f.options.preferences, unknown: 'field' } },
    { ...f.options, time: NaN },
    { ...f.options, time: Infinity },
    { ...f.options, records: null },
    { ...f.options, requestKey: '' },
  ])
    assert.throws(() => buildRecapCue(f.draft, options));
});

test('supported translated recaps retain canonical wording and their own language and provider provenance', async () => {
  for (const language of ['es', 'fr', 'pt']) {
    const f = await fixture({ language }),
      cue = buildRecapCue(f.draft, f.options);
    assert.equal(cue.language, language);
    assert.deepEqual(
      cue.segments.map((s) => s.text),
      f.draft.claims.map((c) => c.text),
    );
    assert.equal(cue.authorship.selection, 'azure-model');
  }
  const f = await fixture();
  f.draft.provider = 'azure';
  f.draft.source = 'azure-recap-fact-workflow';
  f.draft.authorship.selection = 'azure-model';
  f.draft.authorship.additionalContext = 'azure-model';
  assert.equal(buildRecapCue(f.draft, f.options).authorship.selection, 'azure-model');
});

test('an in-progress short received segment can export an overview without inventing an unavailable goal or player', async () => {
  const f = await fixture({
      kind: 'central',
      audience: 'newcomer',
      favoriteClub: null,
      favoritePlayer: null,
      time: 4,
    }),
    cue = buildRecapCue(f.draft, f.options);
  assert.equal(cue.overview.status, 'in-progress');
  assert.equal(cue.overview.segmentDuration, 8);
  assert.equal(cue.scope.observedAt, 4);
  assert.equal(cue.dependencies.length, 2);
  assert.deepEqual(
    cue.segments.map((s) => s.kind),
    ['recap-overview'],
  );
  assert.equal(cue.segments[0].eventTime, null);
  assert.deepEqual(cue.segments[0].eventWindow, { start: 0, end: 4, inclusive: true });
  assert.equal(cue.timing.durationSeconds, 6);
  assert.equal(cue.preferences.favoritePlayer, null);
});
