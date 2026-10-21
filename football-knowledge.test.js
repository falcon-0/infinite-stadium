import test from 'node:test';
import assert from 'node:assert/strict';
import {
  footballKnowledgeCatalog,
  footballKnowledgeVersion,
  retrieveFootballKnowledge,
} from './football-knowledge.js';

test('knowledge retrieval accepts only zero to three unique allowlisted concepts', () => {
  assert.equal(footballKnowledgeCatalog.length, 9);
  assert.deepEqual(retrieveFootballKnowledge([]).concepts, []);
  assert.deepEqual(retrieveFootballKnowledge([]).sources, []);
  for (const ids of [
    null,
    {},
    'offside',
    [null],
    new Array(1),
    ['unknown'],
    ['offside', 'offside'],
    ['offside', 'goal', 'handball', 'fouls'],
    ['__proto__'],
    ['offside '],
  ])
    assert.throws(() => retrieveFootballKnowledge(ids), RangeError);
  assert.equal(retrieveFootballKnowledge(['offside', 'goal', 'handball']).concepts.length, 3);
});

test('selection is deterministic, isolated and deeply immutable with pinned provenance', () => {
  const a = retrieveFootballKnowledge(['offside', 'handball']),
    b = retrieveFootballKnowledge(['handball', 'offside']);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.notEqual(a.concepts[0], b.concepts[0]);
  assert.equal(a.version, footballKnowledgeVersion);
  assert.equal(a.edition, '2026/27');
  assert.match(a.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(a.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(
    a.contentHash,
    retrieveFootballKnowledge(['var']).contentHash,
    'Fingerprint identifies the complete versioned registry',
  );
  assert.throws(() => (a.concepts[0].facts[0].text = 'changed'), TypeError);
  assert.throws(() => a.sources.pop(), TypeError);
  assert.throws(() => (footballKnowledgeCatalog[0].id = 'changed'), TypeError);
  assert.deepEqual(
    a.sources.map((source) => source.id),
    ['law-11', 'law-12'],
  );
  const ids = new Set();
  for (const concept of footballKnowledgeCatalog) {
    const selected = retrieveFootballKnowledge([concept.id]);
    for (const fact of selected.concepts[0].facts) {
      assert.ok(!ids.has(fact.id));
      ids.add(fact.id);
      assert.ok(['condition', 'exception', 'definition', 'procedure'].includes(fact.role));
      assert.ok(fact.section);
      const source = selected.sources.find((source) => source.id === fact.sourceId);
      assert.ok(source);
      assert.ok(
        ['www.theifab.com', 'downloads.theifab.com'].includes(new URL(source.url).hostname),
      );
      assert.equal(source.edition, a.edition);
      assert.equal(source.verifiedAt, a.verifiedAt);
    }
  }
});

test('offside reference preserves independent position, timing, involvement and exemption conditions', () => {
  const facts = new Map(
    retrieveFootballKnowledge(['offside']).concepts[0].facts.map((fact) => [fact.id, fact]),
  );
  assert.match(
    facts.get('offside.position').text,
    /opponents' half.*excluding the halfway line.*both the ball and second-last opponent/,
  );
  assert.match(
    facts.get('offside.body-and-level').text,
    /Hands and arms do not count.*level.*onside/,
  );
  assert.match(
    facts.get('offside.timing').text,
    /teammate's first contact.*goalkeeper's throw.*release/,
  );
  assert.match(
    facts.get('offside.involvement').text,
    /Position alone is not an offence.*Active involvement/,
  );
  assert.match(
    facts.get('offside.direct-restarts').text,
    /Direct reception.*goal kick, throw-in or corner/,
  );
  assert.match(facts.get('offside.restart').text, /own half after returning/);
  assert.match(facts.get('offside.deliberate-play').text, /deliberate save cannot/);
});

test('current VAR and substitution facts retain competition options rather than universal promises', () => {
  const selected = retrieveFootballKnowledge(['var', 'substitutions']);
  const facts = new Map(
    selected.concepts.flatMap((concept) => concept.facts.map((fact) => [fact.id, fact])),
  );
  assert.match(
    facts.get('var.second-caution').text,
    /2026\/27.*clearly incorrect second caution.*either team/,
  );
  assert.match(facts.get('var.corner-option').text, /optionally.*immediate.*does not delay/);
  assert.match(facts.get('var.availability').text, /FIFA permission.*cannot be inferred/);
  assert.match(facts.get('substitutions.limits').text, /Competition rules.*may allow/);
  assert.match(facts.get('substitutions.time').text, /ten seconds.*one minute.*exceptions/);
  assert.equal(facts.get('var.second-caution').sourceId, 'changes-2026-27');
});

test('handball, fouls and goal summaries preserve conditions and aggregate source paraphrases stay bounded', () => {
  const facts = new Map(
    ['handball', 'fouls', 'goal'].flatMap((id) =>
      retrieveFootballKnowledge([id]).concepts[0].facts.map((fact) => [fact.id, fact]),
    ),
  );
  assert.match(facts.get('handball.not-every-touch').text, /not necessarily an offence/);
  assert.match(facts.get('handball.scoring').text, /their own.*even accidentally/);
  assert.match(
    facts.get('fouls.severity').text,
    /careless.*without an automatic card.*reckless.*caution.*excessive force.*dismissal/,
  );
  assert.match(
    facts.get('goal.crossing').text,
    /whole ball.*between the posts.*beneath the crossbar.*no offence/,
  );
  const words = new Map();
  for (const entry of footballKnowledgeCatalog)
    for (const fact of retrieveFootballKnowledge([entry.id]).concepts[0].facts)
      words.set(fact.sourceId, (words.get(fact.sourceId) || 0) + fact.text.split(/\s+/).length);
  for (const [source, total] of words)
    assert.ok(total < 200, `${source}: ${total} paraphrased words`);
});
