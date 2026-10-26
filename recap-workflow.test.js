import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecapStory } from './recap-workflow.js';
import { createRecapFacts } from './recap-facts.js';
const input = {
  source: 'integrated-match',
  mode: 'recap',
  kind: 'extended',
  seed: 17,
  time: 180,
  audience: 'analyst',
  language: 'en',
};
const config = {
  url: 'https://test.openai.azure.com',
  deployment: 'test',
  key: 'test',
};
const approve = {
  decision: 'approve',
  issues: [],
  suggestions: [],
};
const overview = (body) => ({
  factIds: [body.catalog.facts[0].id, ...body.requiredFactIds],
});
function azure(steps, inspect = () => {}) {
  let calls = 0;
  return {
    count: () => calls,
    fetcher: async (url, options) => {
      assert.equal(url, config.url);
      const request = JSON.parse(options.body),
        packet = JSON.parse(request.messages[1].content);
      inspect(request, calls);
      assert.ok(calls < steps.length, 'Unexpected extra Azure call');
      const step = steps[calls++];
      let raw = typeof step === 'function' ? step(packet) : step;
      // Older semantic-selection fixtures are adapted to the actual fixed-field wire shape.
      // Explicit malformed objects and wire-format fixtures pass through unchanged.
      if (raw && Object.keys(raw).length === 1 && Array.isArray(raw.factIds)) {
        const overviewId = raw.factIds[0],
          support = raw.factIds.slice(1),
          required = packet.requiredFactIds[0];
        const fields = Array.from(
            {
              length: packet.maximum - 1,
            },
            (_, index) => `context${index + 1}`,
          ),
          values = {
            overviewFactId: overviewId,
          };
        if (required) {
          const found = support.indexOf(required);
          if (found !== -1) support.splice(found, 1);
          for (const field of fields.slice(0, -1)) values[field] = support.shift() ?? null;
          values[fields.at(-1)] = found !== -1 ? required : null;
        } else for (const field of fields) values[field] = support.shift() ?? null;
        if (support.length) values.extraContext = support[0];
        raw = values;
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify(raw),
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
          },
        }),
      );
    },
  };
}
const localReply = (raw) => ({
  raw,
  modelCalls: 1,
  elapsedMs: 1,
  tools: [],
  usage: {
    promptTokens: 8,
    completionTokens: 2,
  },
  usageReportedCalls: 1,
  trace: [
    {
      role: 'test',
    },
  ],
});
test('recap catalog selection uses the whole received segment and preserves all overview references', async () => {
  const prepared = createRecapFacts(input),
    mock = azure([
      (body) => {
        assert.equal(body.catalog.scope.task, 'recap');
        assert.equal(body.catalog.scope.observedAt, 180);
        const first = body.catalog.facts[0];
        assert.equal(first.kind, 'recap-overview');
        assert.equal(Object.hasOwn(first, 'evidence'), false);
        const shots = body.catalog.facts.find(
          (f) => f.kind === 'recap-team-shots' && f.values.team === 'home',
        );
        assert.equal(shots.values.start, 0);
        assert.equal(shots.values.count, 1);
        assert.ok(
          prepared.catalog.facts
            .find((f) => f.id === shots.id)
            .evidence.some((ref) => ref.id === 'extended-17-0-shot'),
          'Includes shot at28 outside the120second moment window',
        );
        return {
          factIds: [first.id, shots.id, ...body.requiredFactIds],
        };
      },
      (body) => {
        assert.equal(body.renderedClaims.length, 3);
        assert.deepEqual(Object.keys(body.renderedClaims[0]).sort(), ['factId', 'text']);
        assert.equal(Object.hasOwn(body, 'selectedFacts'), false);
        return approve;
      },
    ]);
  const result = await generateRecapStory(input, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'draft');
  assert.equal(result.execution.modelCalls, 2);
  assert.equal(result.execution.toolCalls, 0);
  assert.deepEqual(result.execution.usage, {
    promptTokens: 20,
    completionTokens: 6,
  });
  assert.equal(result.key, prepared.key);
  assert.deepEqual(result.dependencies, prepared.dependencies);
  assert.equal(result.observedAt, 180);
  assert.deepEqual(result.claims[0].evidence, prepared.catalog.facts[0].evidence);
  assert.equal(result.authorship.wording, 'application-fact-templates');
});
test('unknown IDs get only one repair and never reach rendered claims', async () => {
  const mock = azure([
    {
      factIds: ['not-current'],
    },
    overview,
    approve,
  ]);
  const result = await generateRecapStory(input, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'draft');
  assert.equal(result.execution.repairCount, 1);
  assert.equal(result.execution.modelCalls, 3);
  const failed = azure([
    {
      factIds: ['bad'],
    },
    {
      factIds: ['still-bad'],
    },
  ]);
  const withheld = await generateRecapStory(input, {
    config,
    fetcher: failed.fetcher,
  });
  assert.equal(withheld.status, 'withheld');
  assert.deepEqual(withheld.claims, []);
  assert.deepEqual(withheld.selectedFacts, []);
});
test('invalid editorial decisions cause repair and cannot silently approve', async () => {
  const mock = azure([
    overview,
    {
      decision: 'approve',
      issues: ['contradictory'],
    },
    overview,
    {
      decision: 'approve',
      issues: ['still contradictory'],
    },
  ]);
  const result = await generateRecapStory(input, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'withheld');
  assert.equal(mock.count(), 4);
  assert.equal(result.execution.repairCount, 1);
  assert.match(result.issues[0], /invalid objective-selection contract/);
});
test('ordinary editorial preferences are preserved as nonblocking suggestions', async () => {
  const suggestion = 'Consider the equalizer instead of a team shot total.';
  const mock = azure([
    overview,
    {
      decision: 'approve',
      issues: [],
      suggestions: [suggestion],
    },
  ]);
  const result = await generateRecapStory(input, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'draft');
  assert.equal(result.execution.modelCalls, 2);
  assert.equal(result.execution.repairCount, 0);
  assert.deepEqual(result.reviewSuggestions, [suggestion]);
});
test('latest supported recorded score change is required even when model review would approve an omission', async () => {
  const end = {
    ...input,
    time: 362,
    audience: 'newcomer',
  };
  const omit = (body) => ({
    factIds: [
      body.catalog.facts[0].id,
      ...body.catalog.facts
        .filter((f) => f.kind === 'recap-goal-score-change' && f.values.time < 328)
        .map((f) => f.id),
    ],
  });
  const recovered = azure([
    omit,
    (body) => {
      assert.match(body.repair.issues[0], /latest supported goal score change/);
      const required = body.catalog.facts.find((f) => f.id === body.requiredFactIds[0]);
      assert.equal(required.values.time, 328);
      assert.equal(required.values.afterHome, 2);
      assert.equal(required.values.afterAway, 1);
      return overview(body);
    },
    approve,
  ]);
  const draft = await generateRecapStory(end, {
    config,
    fetcher: recovered.fetcher,
  });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.repairCount, 1);
  assert.equal(draft.execution.modelCalls, 3);
  assert.ok(draft.selectedFacts.some((f) => f.values.time === 328));
  const rejected = azure([omit, omit]);
  const withheld = await generateRecapStory(end, {
    config,
    fetcher: rejected.fetcher,
  });
  assert.equal(withheld.status, 'withheld');
  assert.equal(rejected.count(), 2);
  assert.deepEqual(withheld.claims, []);
});
test('overview alone remains valid before any supported goal change exists', async () => {
  const early = {
    ...input,
    time: 20,
  };
  const mock = azure(
    [
      (body) => {
        assert.deepEqual(body.requiredFactIds, []);
        return overview(body);
      },
      approve,
    ],
    (request, index) => {
      if (index === 0)
        for (let i = 1; i <= 4; i++)
          assert.deepEqual(request.response_format.json_schema.schema.properties[`context${i}`], {
            type: ['string', 'null'],
            enum: [null],
          });
    },
  );
  const result = await generateRecapStory(early, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'draft');
  assert.equal(result.claims.length, 1);
  assert.equal(result.execution.modelCalls, 2);
});
test('cancellation before or after transport resolution releases no recap', async () => {
  const pre = new AbortController();
  pre.abort();
  let calls = 0;
  await assert.rejects(
    generateRecapStory(input, {
      config,
      signal: pre.signal,
      fetcher: async () => {
        calls++;
      },
    }),
    (error) => error.status === 499,
  );
  assert.equal(calls, 0);
  const cloud = new AbortController();
  const mock = azure([overview]);
  await assert.rejects(
    generateRecapStory(input, {
      config,
      signal: cloud.signal,
      fetcher: async (...args) => {
        const response = await mock.fetcher(...args);
        cloud.abort();
        return response;
      },
    }),
    (error) => error.status === 499,
  );
});
test('provider choice and missing Azure configuration fail closed', async () => {
  await assert.rejects(
    generateRecapStory(input, {
      provider: 'other',
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    generateRecapStory(input, {
      provider: 'local',
    }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    generateRecapStory(input, {
      config: null,
    }),
    (error) => error.status === 503,
  );
});
test('Azure selection and reviewer request strict supported fixed-field schemas with bounded output tokens', async () => {
  const expected = createRecapFacts(input).catalog.facts.map((f) => f.id);
  const mock = azure([overview, approve], (request, index) => {
    const format = request.response_format;
    assert.equal(format.type, 'json_schema');
    assert.equal(format.json_schema.strict, true);
    const schema = format.json_schema.schema;
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    if (index === 0) {
      assert.equal(format.json_schema.name, 'recap_fact_selection');
      assert.equal(request.max_completion_tokens, 256);
      assert.deepEqual(schema.required, [
        'overviewFactId',
        'context1',
        'context2',
        'context3',
        'context4',
      ]);
      assert.deepEqual(Object.keys(schema.properties), schema.required);
      assert.deepEqual(schema.properties.overviewFactId, {
        type: 'string',
        enum: [expected[0]],
      });
      for (let i = 1; i <= 3; i++)
        assert.deepEqual(schema.properties[`context${i}`], {
          type: ['string', 'null'],
          enum: [...expected.slice(1).filter((id) => id !== expected.at(-1)), null],
        });
      assert.deepEqual(schema.properties.context4, {
        type: 'string',
        enum: [expected.at(-1)],
      });
    } else {
      assert.equal(format.json_schema.name, 'recap_editorial_review');
      assert.equal(request.max_completion_tokens, 384);
      assert.deepEqual(schema.required, ['decision', 'issues', 'suggestions']);
      assert.deepEqual(schema.properties.decision, {
        type: 'string',
        enum: ['approve', 'revise'],
      });
      assert.deepEqual(schema.properties.suggestions, {
        type: 'array',
        items: {
          type: 'string',
        },
      });
      assert.deepEqual(schema.properties.issues.items, {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            enum: ['player-focus-missing'],
          },
          selectedFactId: {
            type: ['string', 'null'],
            enum: [...expected, null],
          },
          replacementFactId: {
            type: 'string',
            enum: expected,
          },
        },
        required: ['code', 'selectedFactId', 'replacementFactId'],
        additionalProperties: false,
      });
      assert.match(request.messages[0].content, /sole blocking issue code is player-focus-missing/);
      assert.match(request.messages[0].content, /nonblocking style suggestions only/);
    }
    for (const unsupported of ['minItems', 'maxItems', 'uniqueItems', 'maxLength'])
      assert.equal(JSON.stringify(schema).includes(`"${unsupported}"`), false);
  });
  const result = await generateRecapStory(input, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'draft');
});
test('newcomer Azure schema has one optional context and a fixed latest score change', async () => {
  const mock = azure([overview, approve], (request, index) => {
    if (index === 0) {
      const schema = request.response_format.json_schema.schema;
      assert.deepEqual(schema.required, ['overviewFactId', 'context1', 'context2']);
      const latest = createRecapFacts(input).catalog.facts.at(-1).id;
      assert.deepEqual(schema.properties.context2, {
        type: 'string',
        enum: [latest],
      });
      assert.equal(schema.properties.context1.enum.includes(latest), false);
      assert.equal(schema.properties.context1.enum.includes(null), true);
    }
  });
  const result = await generateRecapStory(
    {
      ...input,
      audience: 'newcomer',
    },
    {
      config,
      fetcher: mock.fetcher,
    },
  );
  assert.equal(result.status, 'draft');
  assert.equal(result.claims.length, 2);
});
test('player-focus correction is current, optional and feasible within declared capacity', async () => {
  const end = {
    ...input,
    time: 362,
    audience: 'player',
    favoritePlayer: 'A. Reed',
  };
  const suggestion = 'An equalizer may be useful for a later general-audience recap.';
  const mock = azure(
    [
      (body) => ({
        factIds: [
          body.catalog.facts[0].id,
          body.catalog.facts.find((f) => f.kind === 'recap-team-shots' && f.values.team === 'away')
            .id,
          ...body.requiredFactIds,
        ],
      }),
      (body) => ({
        decision: 'revise',
        issues: [
          {
            code: 'player-focus-missing',
            selectedFactId: body.selectedFactIds.find((id) => !body.mandatoryFactIds.includes(id)),
            replacementFactId: body.audienceSelectionRule.playerFactId,
          },
        ],
        suggestions: [suggestion],
      }),
      (body) => ({
        factIds: [
          body.catalog.facts[0].id,
          body.audienceSelectionRule.playerFactId,
          ...body.requiredFactIds,
        ],
      }),
      approve,
    ],
    (request, index) => {
      const packet = JSON.parse(request.messages[1].content);
      assert.deepEqual(packet.selectionCapacity, {
        maximumFacts: 3,
        mandatoryFactCount: 2,
        optionalFactCapacity: 1,
      });
      assert.equal(packet.mandatoryFactIds.length, 2);
      assert.equal(packet.mandatoryFactIds[0], packet.catalog.facts[0].id);
      if (index === 1 || index === 3) {
        assert.match(request.messages[0].content, /selected nonmandatory selectedFactId/);
        assert.equal(packet.audienceSelectionRule.blocking, true);
      }
      if (index === 2) assert.match(packet.repair.issues[0], /player-focus-missing: choose slot/);
    },
  );
  const result = await generateRecapStory(end, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'draft');
  assert.equal(result.execution.repairCount, 1);
  assert.ok(result.selectedFacts.some((f) => f.kind === 'recap-player-actions'));
  assert.equal(
    result.selectedFacts.some((f) => f.kind === 'recap-team-shots'),
    false,
  );
  assert.equal(result.authorship.mandatoryFacts, 'application-domain-rules');
  assert.equal(result.authorship.additionalContext, 'azure-model');
  assert.match(result.review, /Application rules required the overview/);
  assert.match(result.review, /AI selected additional context/);
  assert.deepEqual(result.reviewSuggestions, [suggestion]);
  assert.equal(
    result.trace.find((t) => t.stage === 'editorial-review' && t.type === 'decision').criteria[0]
      .code,
    'player-focus-missing',
  );
});
test('application enforces player-focus coverage even when a model incorrectly approves its omission', async () => {
  const player = {
    ...input,
    time: 362,
    audience: 'player',
    favoritePlayer: 'A. Reed',
  };
  const recovered = azure([
    overview,
    approve,
    (body) => ({
      factIds: [
        body.catalog.facts[0].id,
        body.audienceSelectionRule.playerFactId,
        ...body.requiredFactIds,
      ],
    }),
    approve,
  ]);
  const draft = await generateRecapStory(player, {
    config,
    fetcher: recovered.fetcher,
  });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.execution.modelCalls, 4);
  assert.equal(
    draft.trace.find((t) => t.type === 'decision').origin,
    'application-player-focus-rule',
  );
  assert.ok(draft.selectedFacts.some((f) => f.kind === 'recap-player-actions'));
  const repeated = azure([overview, approve, overview, approve]);
  const withheld = await generateRecapStory(player, {
    config,
    fetcher: repeated.fetcher,
  });
  assert.equal(withheld.status, 'withheld');
  assert.deepEqual(withheld.claims, []);
  assert.match(withheld.issues[0], /player-focus-missing/);
});
test('objective reviewer cannot request unknown facts, mandatory replacements, impossible additions or placeholders', async () => {
  const player = {
    ...input,
    time: 362,
    audience: 'player',
    favoritePlayer: 'A. Reed',
  };
  const chooseCount = (body) => ({
    factIds: [
      body.catalog.facts[0].id,
      body.catalog.facts.find((f) => f.kind === 'recap-team-shots').id,
      ...body.requiredFactIds,
    ],
  });
  for (const alter of [
    (issue, body) => ({
      ...issue,
      code: 'available-kind',
    }),
    (issue) => ({
      ...issue,
      replacementFactId: 'unknown-fact',
    }),
    (issue, body) => ({
      ...issue,
      selectedFactId: body.mandatoryFactIds[0],
    }),
    (issue, body) => ({
      ...issue,
      selectedFactId: body.catalog.facts.find(
        (f) => f.kind === 'recap-goal-score-change' && !body.selectedFactIds.includes(f.id),
      ).id,
    }),
    (issue, body) => ({
      ...issue,
      replacementFactId: body.selectedFactIds[0],
    }),
    (issue) => ({
      ...issue,
      selectedFactId: null,
    }),
    (issue) => ({
      ...issue,
      extra: 'rewrite prose',
    }),
  ]) {
    const verdict = (body) => ({
      decision: 'revise',
      issues: [
        alter(
          {
            code: 'player-focus-missing',
            selectedFactId: body.selectedFactIds.find((id) => !body.mandatoryFactIds.includes(id)),
            replacementFactId: body.audienceSelectionRule.playerFactId,
          },
          body,
        ),
      ],
      suggestions: [],
    });
    const mock = azure([chooseCount, verdict, chooseCount, verdict]);
    const result = await generateRecapStory(player, {
      config,
      fetcher: mock.fetcher,
    });
    assert.equal(result.status, 'withheld');
    assert.deepEqual(result.claims, []);
    assert.match(result.issues[0], /invalid objective-selection contract/);
  }
  const wrongAudience = azure([
    overview,
    (body) => ({
      decision: 'revise',
      issues: [
        {
          code: 'player-focus-missing',
          selectedFactId: null,
          replacementFactId: body.catalog.facts[0].id,
        },
      ],
      suggestions: [],
    }),
    overview,
    {
      decision: 'revise',
      issues: [],
      suggestions: [],
    },
  ]);
  assert.equal(
    (
      await generateRecapStory(input, {
        config,
        fetcher: wrongAudience.fetcher,
      })
    ).status,
    'withheld',
  );
});
test('Azure fixed fields reject wrong overview, old fields, duplicates and extra fields', async () => {
  const prepared = createRecapFacts({
      ...input,
      audience: 'newcomer',
    }),
    ids = prepared.catalog.facts.map((f) => f.id);
  const invalid = [
    {
      overviewFactId: ids[1],
      context1: ids.at(-1),
      context2: null,
    },
    {
      overviewFactId: ids[0],
      context1: 'unknown-supporting-id',
      context2: null,
    },
    {
      factIds: [ids[0], ids.at(-1)],
      oldShape: true,
    },
    {
      overviewFactId: ids[0],
      context1: ids.at(-1),
      context2: ids.at(-1),
    },
    {
      overviewFactId: ids[0],
      context1: ids.at(-1),
      context2: null,
      extra: 'invented',
    },
  ];
  for (const raw of invalid) {
    const mock = azure([raw, raw]);
    const result = await generateRecapStory(
      {
        ...input,
        audience: 'newcomer',
      },
      {
        config,
        fetcher: mock.fetcher,
      },
    );
    assert.equal(result.status, 'withheld');
    assert.equal(mock.count(), 2);
    assert.deepEqual(result.claims, []);
  }
});
test('invalid generated shapes remain withheld and shape diagnostics never retain model prose', async () => {
  const raw = {
    factIds: [],
    ['private generated prose']: 'invented cause and private output',
  };
  const mock = azure([raw, raw]);
  const result = await generateRecapStory(input, {
    config,
    fetcher: mock.fetcher,
  });
  assert.equal(result.status, 'withheld');
  const rejected = result.trace.filter((t) => t.stage === 'selection-validation');
  assert.equal(rejected.length, 2);
  assert.deepEqual(rejected[0].candidateShape, {
    type: 'object',
    keys: ['factIds', 'unexpected-key'],
    count: 0,
  });
  assert.equal(JSON.stringify(result).includes('private generated prose'), false);
  assert.equal(JSON.stringify(result).includes('invented cause'), false);
});
