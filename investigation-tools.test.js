import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvestigationTools } from './investigation-tools.js';

test('comparison tool anchors both windows while retaining corrections received after selected event', () => {
  const input = {
    kind: 'sustained',
    seed: 17,
    time: 120,
    anchorId: 'comparison-sustained-17-shot-116',
  };
  const tools = createInvestigationTools(input),
    output = tools.execute('get_match_patterns', {});
  assert.equal(output.comparison.time, 116);
  assert.equal(output.comparison.scope.observedAt, 120);
  assert.equal(output.comparison.status, 'insight');
  assert.deepEqual(output.comparison.signal, { team: 'home', direction: 'increase', delta: 2 });
  assert.deepEqual(
    [
      output.comparison.windows.previous.start,
      output.comparison.windows.previous.end,
      output.comparison.windows.recent.end,
    ],
    [56, 86, 116],
  );
  assert.ok(
    output.comparisonInputs.some(
      (row) => row.id === input.anchorId && row.revision === 2 && row.arrivedAt === 118,
    ),
  );
  assert.ok(output.comparisonInputs.every((row) => row.time <= 116 && row.arrivedAt <= 120));
  assert.equal(
    output.comparisonInputs.some((row) => row.id === 'comparison-sustained-17-pass-118'),
    false,
  );
  assert.ok(
    output.references.some((ref) => ref.id === 'comparison-sustained-17-receive-72'),
    'Older reception supports complete comparative window inventory',
  );
  assert.equal(Object.hasOwn(output.comparison, 'key'), false);
  assert.equal(Object.hasOwn(output.comparison, 'text'), false);
  for (const window of Object.values(output.comparison.windows))
    for (const reference of window.evidence)
      assert.ok(
        output.references.some(
          (ref) => ref.id === reference.id && ref.revision === reference.revision,
        ),
      );
  const changed = tools.execute('get_match_patterns', {});
  changed.comparisonInputs[0].time = 999;
  assert.notEqual(tools.execute('get_match_patterns', {}).comparisonInputs[0].time, 999);
  assert.throws(() => tools.execute('get_match_patterns', { time: 119 }));
});

test('short and quiet moments do not claim a comparative signal', () => {
  for (const input of [
    { kind: 'central', seed: 17, time: 10, anchorId: 'central-17-shot' },
    { kind: 'quiet', seed: 17, time: 120, anchorId: 'comparison-quiet-17-pass-118' },
  ]) {
    const output = createInvestigationTools(input).execute('get_match_patterns', {});
    assert.equal(output.comparison.status, 'abstain');
    assert.equal(output.comparison.signal, null);
  }
});
