import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEventPresentation, presentEventFields } from './event-presentation.js';
import { matchState } from './match-stream.js';
import { executeMatchQuery } from './match-query.js';
import { buildQuestionFacts, selectQuestionFacts } from './question-facts.js';
import { directQuestionFacts } from './direct-question-facts.js';
import { canonicalCompletedReception } from './match-question-ai.js';

function fixture(language = 'pt', presentation = { role: 'recipient', fields: ['name', 'time'] }) {
  const input = { kind: 'quiet', seed: 73, time: 120 },
    state = matchState(input);
  const source = executeMatchQuery(input, {
    filters: { type: 'pass', team: 'home', result: true },
    aggregate: 'list',
    order: 'desc',
    limit: 1,
    timeFrom: 0,
    timeTo: 120,
  });
  const packet = {
    observedAt: 120,
    question: 'Who received the latest completed home pass? Name and time only.',
    responseLanguage: language,
    teams: state.metadata.teams,
    roster: state.frames.at(-1).players,
    queryResults: [source],
    requestedEvidence: [source],
    requestedForm: 'fact',
    answerFocus: 'event-actor',
    eventPresentation: presentation,
    requestComponents: ['Who received the latest completed home pass?', 'Name and time only.'],
  };
  return { packet, source, manifest: buildQuestionFacts(packet) };
}
test('explicit compact recipient fields preserve full source proof in all supported languages', () => {
  for (const language of ['en', 'es', 'fr', 'pt']) {
    const { packet, source, manifest } = fixture(language),
      fact = manifest.facts.find((f) => f.proof.presentation);
    assert.ok(fact);
    assert.equal(fact.claim.text, 'D. Hughes · 01:40.');
    assert.equal(fact.proof.event.playerId, source.rows[0].playerId);
    assert.notEqual(fact.proof.presentation.playerId, fact.proof.event.playerId);
    assert.equal(fact.proof.event.recipient.playerId, fact.proof.presentation.playerId);
    assert.ok(
      fact.claim.evidence.some((r) => r.type === 'scope' && r.id === source.scopeReference.id),
    );
    const direct = directQuestionFacts(packet, manifest, { form: 'fact', focus: 'event-actor' });
    assert.deepEqual(direct.composition.factIds, [fact.id]);
    const selected = selectQuestionFacts(manifest, direct.composition.factIds);
    assert.equal(
      canonicalCompletedReception(0, { claims: selected.claims }, packet, selected),
      true,
    );
  }
});
test('name-only projection and actor projection preserve distinct roles', () => {
  const recipient = fixture('en', { role: 'recipient', fields: ['name'] });
  assert.equal(recipient.manifest.facts.find((f) => f.proof.presentation).claim.text, 'D. Hughes.');
  const actor = fixture('en', { role: 'actor', fields: ['name', 'time'] }),
    fact = actor.manifest.facts.find((f) => f.proof.presentation);
  assert.equal(fact.claim.text, 'M. Sarr · 01:40.');
  const selected = selectQuestionFacts(actor.manifest, [fact.id]);
  assert.equal(
    canonicalCompletedReception(0, { claims: selected.claims }, actor.packet, selected),
    false,
  );
});
test('presentation proposals cannot establish reception for pending, failed or missing recipients', () => {
  const { manifest, packet } = fixture(),
    event = manifest.facts.find((f) => f.proof.presentation).proof.event;
  const player = (id) => packet.roster.find((p) => p.id === id),
    shape = { role: 'recipient', fields: ['name', 'time'] };
  for (const mutate of [
    (e) => (e.actionOutcome.status = 'pending'),
    (e) => (e.actionOutcome.status = 'failed'),
    (e) => (e.recipientStatus = 'recorded-target'),
    (e) => (e.recipient.status = 'unknown'),
    (e) => (e.recipient.playerId = 'unknown-player'),
    (e) => (e.revision = 0),
    (e) => (e.modelGenerated = true),
  ]) {
    const altered = structuredClone(event);
    mutate(altered);
    assert.equal(presentEventFields(shape, altered, player), null);
  }
});
test('default, malformed and non-factual requests retain full wording', () => {
  for (const shape of [
    null,
    undefined,
    { role: 'recipient', fields: ['time'] },
    { role: 'recipient', fields: ['name', 'name'] },
    { role: 'recipient', fields: ['name'], extra: true },
    { role: 'invented', fields: ['name'] },
  ]) {
    assert.equal(normalizeEventPresentation(shape), null);
    assert.equal(
      fixture('pt', shape ?? null).manifest.facts.some((f) => f.proof.presentation),
      false,
    );
  }
  const { packet } = fixture();
  packet.requestedForm = 'explanation';
  assert.equal(
    buildQuestionFacts(packet).facts.some((f) => f.proof.presentation),
    false,
  );
});
test('ambiguous queries and relative-event requests do not bypass the writer with a projection', () => {
  const { packet, manifest } = fixture();
  packet.requestedEvidence.push(structuredClone(packet.requestedEvidence[0]));
  assert.equal(directQuestionFacts(packet, manifest, { form: 'fact', focus: 'event-actor' }), null);
  packet.requestedEvidence.pop();
  packet.question = 'Who won the ball after that pass?';
  assert.equal(directQuestionFacts(packet, manifest, { form: 'fact', focus: 'event-actor' }), null);
});
