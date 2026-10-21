import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedAttackingQueries } from './match-question-ai.js';
import { executeMatchQuery } from './match-query.js';

test('comparative explanations get full team evidence despite a limited shot example query', () => {
  const input = { kind: 'sustained', seed: 17, time: 110 };
  const planned = [
    executeMatchQuery(input, {
      filters: { type: 'shot' },
      aggregate: 'list',
      limit: 1,
      timeFrom: 0,
      timeTo: 110,
    }),
  ];
  for (const requestedForm of ['assessment', 'explanation']) {
    const result = requestedAttackingQueries(planned, (q) => executeMatchQuery(input, q), {
      answerFocus: 'team-attacking-assessment',
      requestedForm,
    });
    assert.equal(result.length, 2);
    for (const [i, source] of result.entries()) {
      assert.equal(source.query.aggregate, 'by-team');
      assert.equal(source.truncated, false);
      assert.equal(source.query.timeFrom, 0);
      assert.equal(source.query.timeTo, 110);
      assert.deepEqual(
        source.query.filters,
        i ? { type: 'shot', outcome: 'on-target' } : { type: 'shot' },
      );
      const expected = executeMatchQuery(input, {
        filters: source.query.filters,
        aggregate: 'by-team',
        timeFrom: 0,
        timeTo: 110,
      });
      assert.deepEqual(source.groups, expected.groups);
    }
  }
});

test('comparative source augmentation retains exclusive windows and deduplicates them', () => {
  const input = { kind: 'sustained', seed: 17, time: 110 },
    q = {
      filters: { type: 'shot' },
      aggregate: 'list',
      limit: 1,
      timeFrom: 42,
      timeTo: 96,
      timeFromExclusive: true,
      timeToExclusive: true,
    };
  const source = executeMatchQuery(input, q),
    queries = [];
  requestedAttackingQueries(
    [source, source],
    (query) => {
      queries.push(query);
      return executeMatchQuery(input, query);
    },
    { answerFocus: 'team-attacking-assessment', requestedForm: 'explanation' },
  );
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal(query.timeFrom, 42);
    assert.equal(query.timeTo, 96);
    assert.equal(query.timeFromExclusive, true);
    assert.equal(query.timeToExclusive, true);
  }
});

test('unrelated fact, team approach and clarification tasks receive no attacking comparison', () => {
  const source = { query: { timeFrom: 0, timeTo: 110 } };
  for (const task of [
    {},
    { answerFocus: 'team-assessment', requestedForm: 'explanation' },
    { answerFocus: 'team-attacking-assessment', requestedForm: 'fact' },
    { answerFocus: 'team-attacking-assessment', requestedForm: 'clarification' },
  ]) {
    assert.deepEqual(
      requestedAttackingQueries([source], () => assert.fail('Unrequested comparison'), task),
      [],
    );
  }
});
