import test from 'node:test';
import assert from 'node:assert/strict';
import { answerMatchQuestion, validateMatchQuestionInput } from './match-questions.js';
import { matchState } from './match-stream.js';
const base = { kind: 'sustained', seed: 17, time: 96 };
test('question preferences accept bounded display choices without accepting arbitrary request fields', () => {
  const input = {
    ...base,
    question: 'Who scored?',
    audience: 'player',
    favoriteClub: 'away',
    favoritePlayer: 'D. Silva',
  };
  assert.doesNotThrow(() => validateMatchQuestionInput(input));
  for (const change of [
    { audience: 'admin' },
    { favoriteClub: 'other' },
    { favoritePlayer: '<script>' },
    { favoritePlayer: 'j\n' },
    { favoritePlayer: 'x'.repeat(101) },
    { apiKey: 'private' },
  ])
    assert.throws(() => validateMatchQuestionInput({ ...input, ...change }), RangeError);
  assert.doesNotThrow(() =>
    validateMatchQuestionInput({ ...input, favoriteClub: null, favoritePlayer: null }),
  );
});
test('natural pressure questions compare a bounded received window without claiming measured pressing', () => {
  for (const question of [
    'Who is pushing more?',
    'Who is applying more pressure?',
    'Which team is on top?',
  ]) {
    const a = answerMatchQuestion({ ...base, question });
    assert.equal(a.intent, 'momentum');
    assert.match(a.answer, /Northbridge looks more threatening/);
    assert.match(a.answer, /last 30 seconds/);
    assert.match(a.answer, /does not measure off-ball pressing/);
    assert.ok(a.moments.every((m) => m.time >= 66 && m.time <= 96));
  }
  const empty = answerMatchQuestion({ ...base, time: 0, question: 'Who is pushing more?' });
  assert.match(empty.answer, /not enough/);
  const corrected = answerMatchQuestion({ ...base, time: 98, question: 'Who is pushing more?' });
  assert.ok(
    corrected.evidence.some((e) => e.id === 'comparison-sustained-17-shot-96' && e.revision === 2),
  );
});
test('possession questions return passing evidence without inventing possession share', () => {
  const a = answerMatchQuestion({ ...base, question: 'Who has more possession?' });
  assert.equal(a.intent, 'passing');
  assert.match(a.answer, /possession percentage is unavailable/);
  assert.match(a.answer, /confirmed passes/);
});
test('chance answers link received buildup and change on provider correction', () => {
  const input = {
    ...base,
    question: 'How did this chance happen?',
    anchorId: 'comparison-sustained-17-shot-96',
  };
  const a = answerMatchQuestion(input),
    b = answerMatchQuestion({ ...input, time: 98 });
  assert.equal(a.intent, 'buildup');
  assert.equal(a.status, 'answered');
  assert.match(a.answer, /off target/);
  assert.match(b.answer, /saved/);
  assert.deepEqual(
    a.moments.map((m) => m.time),
    [90, 94, 96],
  );
  assert.notEqual(a.key, b.key);
  assert.ok(b.evidence.some((e) => e.id === input.anchorId && e.revision === 2));
  assert.equal(a.provenance.modelGenerated, false);
});
test('interception requires linked failed opponent pass rather than arbitrary ball recovery', () => {
  const a = answerMatchQuestion({ ...base, question: 'Who intercepted the pass?' });
  assert.equal(a.status, 'answered');
  assert.match(a.answer, /J\. Cole/);
  assert.equal(a.moments[0].time, 66);
  assert.equal(a.evidence.length, 2);
  const empty = answerMatchQuestion({ ...base, time: 0, question: 'Who intercepted the pass?' });
  assert.equal(empty.status, 'no-results');
  assert.equal(empty.moments.length, 0);
});
test('player searches use received names, bound results and do not substitute unknown players', () => {
  const a = answerMatchQuestion({ ...base, question: 'Show me Reed’s chances' });
  assert.equal(a.status, 'answered');
  assert.ok(a.moments.length > 0);
  assert.ok(a.moments.every((m) => m.label.includes('Reed')));
  const b = answerMatchQuestion({ ...base, question: 'Show Messi shots' });
  assert.equal(b.status, 'no-results');
  assert.equal(b.moments.length, 0);
  const c = answerMatchQuestion({
    kind: 'extended',
    seed: 17,
    time: 362,
    question: 'Show all shots',
  });
  assert.ok(c.moments.length <= 8);
});
test('causal attribution and unsupported questions abstain', () => {
  for (const question of [
    'Who caused the interception?',
    'Why did the defender leave space?',
    'Who forced the mistake?',
  ]) {
    const a = answerMatchQuestion({ ...base, question });
    assert.equal(a.status, 'limited');
    assert.equal(a.intent, 'causal');
    assert.match(a.answer, /cannot establish/);
  }
  assert.equal(
    answerMatchQuestion({ ...base, question: 'Who will win tomorrow?' }).status,
    'unsupported',
  );
});
test('scope rejects future and withdrawn anchors and never leaks future evidence', () => {
  const unavailable = answerMatchQuestion({
    ...base,
    time: 95,
    question: 'How did this chance happen?',
    anchorId: 'comparison-sustained-17-shot-96',
  });
  assert.equal(unavailable.status, 'no-results');
  const gone = answerMatchQuestion({
    kind: 'withdrawal',
    seed: 17,
    time: 11,
    question: 'How did this goal happen?',
    anchorId: 'withdrawal-17-shot',
  });
  assert.equal(gone.status, 'no-results');
  for (const time of [0, 20, 65, 96, 98]) {
    const a = answerMatchQuestion({ ...base, time, question: 'Catch me up' }),
      state = matchState({ ...base, time });
    for (const r of a.evidence)
      assert.ok(state.events.some((e) => e.id === r.id && e.revision === r.revision));
    assert.ok(a.moments.every((m) => m.time <= time));
  }
});
test('malformed or unbounded inputs fail and language limitation is explicit', () => {
  for (const value of [
    null,
    [],
    { ...base, question: '' },
    { ...base, question: 'a'.repeat(401) },
    { ...base, question: 'score', time: 121 },
    { ...base, question: 'score', extra: true },
  ])
    assert.throws(() => answerMatchQuestion(value));
  const a = answerMatchQuestion({ ...base, question: 'score', language: 'es' });
  assert.equal(a.language, 'en');
  assert.equal(a.notices.length, 1);
});
