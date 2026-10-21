import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneFeed, sceneInvestigation, observed } from './evidence.js';
import { buildRequest, validateDraft, generateDraft } from './ai.js';

const shot = { kind: 'central', seed: 17, anchorId: 'central-17-shot' };
test('scene evidence respects arrivals, repairs measurements, and rewinds', () => {
  const early = sceneInvestigation({ ...shot, time: 7 });
  assert.equal(early.explanation, null);
  assert.ok(early.state.frames.every((f) => f.time <= 7 && f.arrivedAt <= 7));
  const before = sceneInvestigation({ ...shot, time: 8 }).explanation;
  const after = sceneInvestigation({ ...shot, time: 10 }).explanation;
  assert.equal(before.frame.revision, 1);
  assert.equal(after.frame.revision, 2);
  assert.equal(
    after.frame.players.find((p) => p.id === 'home-10').x -
      before.frame.players.find((p) => p.id === 'home-10').x,
    3,
  );
  assert.notEqual(before.metrics[0].value, after.metrics[0].value);
  assert.notEqual(before.recap, after.recap);
  assert.notEqual(before.key, after.key);
  assert.deepEqual(sceneInvestigation({ ...shot, time: 8 }).explanation, before);
  assert.throws(() =>
    validateDraft(
      {
        claims: [
          { text: 'Old measurement', evidence: [{ id: before.metrics[0].id, revision: 1 }] },
        ],
      },
      after,
    ),
  );
});
test('duplicate and reordered records fold revisions, including deletions', () => {
  const stream = sceneFeed();
  const deleted = { ...stream.frames[0], revision: 3, arrivedAt: 11, operation: 'delete' };
  const records = [...stream.frames, ...stream.frames, deleted].reverse();
  const folded = observed(records, 11);
  assert.equal(folded.length, 8);
  assert.equal(folded.at(-1).revision, 2);
  assert.ok(!folded.some((f) => f.id === deleted.id));
});
test('missing exact sample produces no metric until that sample arrives', () => {
  const stream = sceneFeed();
  stream.frames = stream.frames.map((f) => (f.time === 8 ? { ...f, arrivedAt: 11 } : f));
  const before = sceneInvestigation({ ...shot, time: 8 }, stream).explanation;
  assert.equal(before.frame, null);
  assert.deepEqual(before.metrics, []);
  assert.match(before.text, /unavailable/);
  const after = sceneInvestigation({ ...shot, time: 11 }, stream).explanation;
  assert.equal(after.metrics.length, 1);
  assert.notEqual(before.key, after.key);
});
test('corrections beyond a pinned earlier event do not invalidate it', () => {
  const input = { ...shot, anchorId: 'central-17-pass' };
  assert.equal(
    sceneInvestigation({ ...input, time: 8 }).explanation.key,
    sceneInvestigation({ ...input, time: 10 }).explanation.key,
  );
});
test('scene AI uses only received frames and metrics with validated references', async () => {
  const input = { ...shot, time: 8, source: 'scene', audience: 'analyst' };
  assert.throws(() => buildRequest({ ...input, time: 7 }), /has not arrived/);
  const draft = await generateDraft(input, {
    config: { url: 'https://test.openai.azure.com', key: 'test', deployment: 'test' },
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body),
        payload = JSON.parse(body.messages[1].content);
      assert.ok(payload.positions.every((f) => f.arrivedAt <= 8 && f.revision === 1));
      assert.equal(payload.metrics.length, 1);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  claims: [
                    {
                      text: 'Nearest opponent distance is measured at the shot.',
                      evidence: [{ id: payload.metrics[0].id, revision: 1 }],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    },
  });
  assert.equal(draft.evidenceSource, 'scene');
});
