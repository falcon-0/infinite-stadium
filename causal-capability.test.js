import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestionFacts, selectQuestionFacts } from './question-facts.js';

const packet = {
  observedAt: 70,
  teams: { home: 'Northbridge', away: 'Harbour' },
  roster: [{ id: 'home-7', name: 'J. Cole', team: 'home' }],
  requestedForm: 'explanation',
  explanationTarget: 'causal-attribution',
  evidenceCapabilities: { unavailable: ['who forced a mistake or turnover'] },
};
test('causal capability boundary is source-declared, localized and cannot invent a forcing player', () => {
  for (const responseLanguage of ['en', 'es', 'fr', 'pt']) {
    const manifest = buildQuestionFacts({ ...packet, responseLanguage });
    const fact = manifest.facts.find((f) =>
      f.proof.attributes?.includes('who forced a mistake or turnover'),
    );
    assert.ok(fact);
    assert.equal(fact.claim.kind, 'limitation');
    assert.equal(fact.proof.modelGenerated, false);
    assert.deepEqual(fact.claim.evidence, []);
    assert.equal(fact.proof.basis, 'trusted-event-schema');
    assert.ok(!fact.claim.text.includes('Cole'));
    assert.ok(!/0|70|01:10/.test(fact.claim.text));
    const selected = selectQuestionFacts(manifest, [fact.id]);
    assert.equal(selected.claims[0].text, fact.claim.text);
  }
});
test('a planner label cannot hide a source-declared boundary, but missing evidence cannot invent it', () => {
  for (const extra of [
    { explanationTarget: 'observed-sequence' },
    { requestedForm: 'fact' },
    { requestedForm: undefined, explanationTarget: undefined },
  ]) {
    const manifest = buildQuestionFacts({ ...packet, ...extra });
    assert.ok(
      manifest.facts.some((f) => f.proof.attributes?.includes('who forced a mistake or turnover')),
    );
  }
  for (const extra of [
    { evidenceCapabilities: { unavailable: [] } },
    { evidenceCapabilities: undefined },
  ]) {
    const manifest = buildQuestionFacts({ ...packet, ...extra });
    assert.ok(
      !manifest.facts.some((f) => f.proof.attributes?.includes('who forced a mistake or turnover')),
    );
  }
});
