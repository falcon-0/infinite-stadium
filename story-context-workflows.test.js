import test from 'node:test';
import assert from 'node:assert/strict';
import { investigateFactStory } from './fact-workflow.js';
import { investigateLocalFactStory } from './local-fact-workflow.js';

const input = {
  source: 'integrated-match',
  kind: 'wide',
  seed: 902,
  time: 10,
  anchorId: 'wide-902-shot',
  audience: 'analyst',
  language: 'en',
};
const config = { url: 'https://test.openai.azure.com', deployment: 'test', key: 'test' };
const workerResult = (raw, tools = []) => ({
  raw,
  tools,
  modelCalls: 1,
  elapsedMs: 2,
  usageReportedCalls: 1,
  usage: { promptTokens: 10, completionTokens: 5 },
  trace: tools.map((name) => ({ type: 'function-tool', name })),
});
const plan = (names) => workerResult({ tools: names }, names);
const approve = workerResult({ decision: 'approve', issues: [] });
function worker(steps) {
  const packets = [];
  let calls = 0;
  return {
    packets,
    count: () => calls,
    runner: async (packet) => {
      packets.push(packet);
      assert.ok(calls < steps.length, 'Unexpected worker invocation');
      const step = steps[calls++];
      return typeof step === 'function' ? step(packet) : step;
    },
  };
}
const requiredOnly = (packet) => workerResult({ slots: packet.requiredSlots });
function contextual(packet) {
  assert.equal(packet.contextRequirement.minimum, 1);
  assert.ok(packet.contextRequirement.candidateSlots.length);
  const candidate = packet.catalog.facts.find(
    (f) => f.kind === 'window-event-count' && f.values.category === 'completedPasses',
  );
  assert.ok(candidate);
  assert.equal(candidate.values.count, 1);
  assert.ok(packet.contextRequirement.candidateSlots.includes(candidate.slot));
  assert.ok(!packet.requiredSlots.includes(candidate.slot));
  return workerResult({ slots: [...packet.requiredSlots, candidate.slot] });
}
const reply = (raw) => ({ finish_reason: 'stop', message: { content: JSON.stringify(raw) } });
const toolReply = (names) => ({
  finish_reason: 'tool_calls',
  message: {
    tool_calls: names.map((name, i) => ({
      id: `tool-${i}`,
      type: 'function',
      function: { name, arguments: '{}' },
    })),
  },
});
function provider(steps) {
  const bodies = [];
  let calls = 0;
  return {
    bodies,
    count: () => calls,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      assert.ok(calls < steps.length, 'Unexpected provider invocation');
      const step = steps[calls++],
        value = typeof step === 'function' ? step(body) : step;
      return new Response(
        JSON.stringify({ choices: [value], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      );
    },
  };
}
function catalogPacket(body) {
  for (const message of [...body.messages].reverse())
    try {
      const packet = JSON.parse(message.content);
      if (packet.catalog) return packet;
    } catch {}
  throw new Error('Catalog not supplied');
}
const catalog = (body) => catalogPacket(body).catalog;
const mandatory = (facts) =>
  facts.filter((f) => ['moment', 'goal-score-change'].includes(f.kind)).map((f) => f.id);
const azureRequired = (body) => reply({ factIds: mandatory(catalog(body).facts) });
const azureContext = (body) => {
  const packet = catalogPacket(body),
    facts = packet.catalog.facts,
    candidate = facts.find(
      (f) => f.kind === 'window-event-count' && f.values.category === 'completedPasses',
    );
  assert.ok(candidate);
  assert.equal(candidate.values.count, 1);
  assert.equal(packet.contextRequirement.minimum, 1);
  assert.ok(packet.contextRequirement.candidateFactIds.includes(candidate.id));
  return reply({ factIds: [...mandatory(facts), candidate.id] });
};

test('local analyst context omission repairs the raw selection once with current corrected pass evidence', async () => {
  const mock = worker([
    plan(['get_event_sequence', 'score_at_moment']),
    requiredOnly,
    contextual,
    approve,
  ]);
  const draft = await investigateLocalFactStory(input, { runner: mock.runner });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.repairCount, 1);
  assert.equal(mock.count(), 4);
  assert.equal(mock.packets.filter((p) => p.mode === 'fact-editorial-review').length, 1);
  const count = draft.selectedFacts.find((f) => f.kind === 'window-event-count');
  assert.ok(count);
  assert.deepEqual(count.evidence, [{ type: 'event', id: 'wide-902-pass', revision: 2 }]);
  assert.deepEqual(draft.execution.modelSelectedTools, ['get_event_sequence', 'score_at_moment']);
  assert.deepEqual(draft.execution.applicationRequiredTools, ['get_match_patterns']);
  assert.equal(draft.execution.toolCalls, 3);
  assert.equal(draft.selectedFacts[0].kind, 'moment');
  assert.equal(draft.selectedFacts[1].kind, 'goal-score-change');
  assert.deepEqual(draft.claims.at(-1).evidence, count.evidence);
});

test('repeated local context omission withholds before any reviewer can approve', async () => {
  const mock = worker([
    plan(['get_event_sequence', 'score_at_moment']),
    requiredOnly,
    requiredOnly,
  ]);
  const draft = await investigateLocalFactStory(input, { runner: mock.runner });
  assert.equal(draft.status, 'withheld');
  assert.deepEqual(draft.claims, []);
  assert.deepEqual(draft.selectedFactIds, []);
  assert.equal(draft.execution.repairCount, 1);
  assert.equal(mock.count(), 3);
  assert.equal(
    mock.packets.some((p) => p.mode === 'fact-editorial-review'),
    false,
  );
});

test('newcomer retains two required goal facts and a genuinely empty analyst candidate set is not forced', async () => {
  const simple = worker([plan(['get_event_sequence', 'score_at_moment']), requiredOnly, approve]);
  const newcomer = await investigateLocalFactStory(
    { ...input, audience: 'newcomer' },
    { runner: simple.runner },
  );
  assert.equal(newcomer.status, 'draft');
  assert.deepEqual(
    newcomer.selectedFacts.map((f) => f.kind),
    ['moment', 'goal-score-change'],
  );
  assert.equal(newcomer.execution.toolCalls, 2);
  assert.equal(newcomer.execution.repairCount, 0);
  const empty = worker([
    plan(['get_event_sequence']),
    (packet) => {
      assert.equal(packet.contextRequirement.minimum, 0);
      assert.deepEqual(packet.contextRequirement.candidateSlots, []);
      return requiredOnly(packet);
    },
    approve,
  ]);
  const draft = await investigateLocalFactStory(
    { ...input, time: 2, anchorId: 'wide-902-pass' },
    { runner: empty.runner },
  );
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.repairCount, 0);
  assert.deepEqual(
    draft.selectedFacts.map((f) => f.kind),
    ['moment'],
  );
});

test('spatial measurement supplies exact corrected samples without repeating a model-selected foundation tool', async () => {
  const mock = worker([
    plan(['get_event_sequence', 'score_at_moment', 'measure_moment']),
    (packet) => {
      const candidate = packet.catalog.facts.find(
        (f) => f.kind === 'player-sample-displacement-rate',
      );
      assert.ok(candidate);
      assert.ok(packet.contextRequirement.candidateSlots.includes(candidate.slot));
      return workerResult({ slots: [...packet.requiredSlots, candidate.slot] });
    },
    approve,
  ]);
  const draft = await investigateLocalFactStory(
    { ...input, audience: 'spatial' },
    { runner: mock.runner },
  );
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.toolCalls, 3);
  assert.deepEqual(draft.execution.applicationRequiredTools, []);
  const sample = draft.selectedFacts.at(-1);
  assert.equal(sample.kind, 'player-sample-displacement-rate');
  assert.ok(
    sample.evidence.some(
      (ref) => ref.type === 'frame' && ref.id === 'wide-902-frame-8' && ref.revision === 2,
    ),
  );
  assert.ok(
    sample.evidence.some(
      (ref) => ref.type === 'frame' && ref.id === 'wide-902-frame-7' && ref.revision === 1,
    ),
  );
  assert.ok(sample.evidence.some((ref) => ref.type === 'metric'));
  assert.deepEqual(draft.claims.at(-1).evidence, sample.evidence);
});

test('Azure analyst omission is repaired only by a new model selection; repeated omission is withheld', async () => {
  const repaired = provider([
    toolReply(['get_event_sequence', 'score_at_moment']),
    azureRequired,
    azureContext,
    reply({ decision: 'approve', issues: [] }),
  ]);
  const draft = await investigateFactStory(input, { config, fetcher: repaired.fetcher });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.repairCount, 1);
  assert.equal(repaired.count(), 4);
  assert.deepEqual(draft.selectedFacts.at(-1).evidence, [
    { type: 'event', id: 'wide-902-pass', revision: 2 },
  ]);
  assert.equal(draft.execution.toolCalls, 3);
  assert.ok(draft.execution.applicationRequiredTools.includes('get_match_patterns'));
  const repeated = provider([
    toolReply(['get_event_sequence', 'score_at_moment']),
    azureRequired,
    azureRequired,
  ]);
  const withheld = await investigateFactStory(input, { config, fetcher: repeated.fetcher });
  assert.equal(withheld.status, 'withheld');
  assert.deepEqual(withheld.claims, []);
  assert.equal(repeated.count(), 3);
  assert.equal(
    repeated.bodies.some((body) =>
      body.messages[0].content.startsWith('You are a separate editorial reviewer'),
    ),
    false,
  );
});

test('Azure uses model-selected audience evidence once and newcomer selection stays simple', async () => {
  const analyst = provider([
    toolReply(['get_event_sequence', 'score_at_moment', 'get_match_patterns']),
    azureContext,
    reply({ decision: 'approve', issues: [] }),
  ]);
  const draft = await investigateFactStory(input, { config, fetcher: analyst.fetcher });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.toolCalls, 3);
  assert.equal(
    draft.execution.modelSelectedTools.filter((name) => name === 'get_match_patterns').length,
    1,
  );
  const newcomer = provider([
    toolReply(['get_event_sequence', 'score_at_moment']),
    azureRequired,
    reply({ decision: 'approve', issues: [] }),
  ]);
  const simple = await investigateFactStory(
    { ...input, audience: 'newcomer' },
    { config, fetcher: newcomer.fetcher },
  );
  assert.equal(simple.status, 'draft');
  assert.deepEqual(
    simple.selectedFacts.map((f) => f.kind),
    ['moment', 'goal-score-change'],
  );
  assert.equal(simple.execution.toolCalls, 2);
  assert.equal(simple.execution.repairCount, 0);
});

test('Azure spatial context preserves the corrected frame and complete metric support', async () => {
  const mock = provider([
    toolReply(['get_event_sequence', 'score_at_moment', 'measure_moment']),
    (body) => {
      const packet = catalogPacket(body),
        facts = packet.catalog.facts,
        candidate = facts.find((f) => f.kind === 'nearest-sampled-opponent');
      assert.ok(packet.contextRequirement.candidateFactIds.includes(candidate.id));
      return reply({ factIds: [...mandatory(facts), candidate.id] });
    },
    reply({ decision: 'approve', issues: [] }),
  ]);
  const draft = await investigateFactStory(
    { ...input, audience: 'spatial' },
    { config, fetcher: mock.fetcher },
  );
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.toolCalls, 3);
  assert.equal(draft.execution.repairCount, 0);
  const fact = draft.selectedFacts.at(-1);
  assert.equal(fact.kind, 'nearest-sampled-opponent');
  assert.equal(fact.evidence.length, 3);
  assert.ok(
    fact.evidence.some(
      (ref) => ref.type === 'frame' && ref.id === 'wide-902-frame-8' && ref.revision === 2,
    ),
  );
  assert.ok(fact.evidence.some((ref) => ref.type === 'metric'));
  assert.deepEqual(draft.claims.at(-1).evidence, fact.evidence);
});

test('Azure advertises only unexecuted useful sources and stops offering tools after they are gathered', async () => {
  const mock = provider([
    (body) => {
      assert.deepEqual(
        body.tools.map((tool) => tool.function.name),
        ['measure_moment'],
      );
      return toolReply(['measure_moment']);
    },
    (body) => {
      assert.equal(Object.hasOwn(body, 'tools'), false);
      assert.equal(Object.hasOwn(body, 'tool_choice'), false);
      const packet = catalogPacket(body),
        facts = packet.catalog.facts;
      assert.ok(facts.some((f) => f.kind === 'nearest-sampled-opponent'));
      return azureContext(body);
    },
    reply({ decision: 'approve', issues: [] }),
  ]);
  const draft = await investigateFactStory(input, { config, fetcher: mock.fetcher });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.toolCalls, 4);
  assert.equal(draft.execution.modelCalls, 3);
  assert.deepEqual(draft.execution.modelSelectedTools, ['measure_moment']);
  assert.deepEqual(draft.execution.applicationRequiredTools, [
    'get_event_sequence',
    'score_at_moment',
    'get_match_patterns',
  ]);
  assert.equal(draft.execution.repairCount, 0);
  const count = draft.selectedFacts.at(-1);
  assert.equal(count.kind, 'window-event-count');
  assert.deepEqual(count.evidence, [{ type: 'event', id: 'wide-902-pass', revision: 2 }]);
  assert.deepEqual(draft.claims.at(-1).evidence, count.evidence);
});
