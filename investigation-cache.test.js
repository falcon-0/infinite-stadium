import test from 'node:test';
import assert from 'node:assert/strict';
import { InvestigationCache } from './investigation-cache.js';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => queueMicrotask(resolve));
const fixture = () => {
  const loads = [],
    applied = [],
    errors = [];
  const cache = new InvestigationCache({
    load: (input, options) => {
      const request = deferred();
      loads.push({ ...request, input, ...options });
      return request.promise;
    },
    apply: (value, context) => applied.push({ value, ...context }),
    onError: (error, context) => errors.push({ error, ...context }),
  });
  return { cache, loads, applied, errors };
};

test('many replay ticks reuse a delayed equal-key request without starvation', async () => {
  const { cache, loads, applied } = fixture(),
    pending = cache.request('shot-v1|positions-v1', { time: 29 });
  await tick();
  for (let time = 30; time <= 60; time++)
    assert.strictEqual(cache.request('shot-v1|positions-v1', { time }), pending);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].signal.aborted, false);
  loads[0].resolve('explanation');
  assert.equal((await pending).status, 'applied');
  assert.equal(applied.length, 1);
  const repeated = await cache.request('shot-v1|positions-v1', { time: 61 });
  assert.equal(repeated.status, 'cached');
  assert.equal(repeated.value, 'explanation');
  assert.equal(loads.length, 1);
  assert.equal(applied.length, 1);
});

test('a correction aborts the old load even when it ignores cancellation and returns late', async () => {
  const { cache, loads, applied, errors } = fixture();
  const old = cache.request('shot-v1', { revision: 1 });
  await tick();
  const corrected = cache.request('shot-v2', { revision: 2 });
  await tick();
  assert.equal(loads[0].signal.aborted, true);
  assert.equal(loads[1].signal.aborted, false);
  loads[1].resolve('corrected');
  assert.equal((await corrected).status, 'applied');
  loads[0].resolve('obsolete');
  assert.equal((await old).status, 'cancelled');
  assert.deepEqual(
    applied.map((x) => x.value),
    ['corrected'],
  );
  assert.equal(errors.length, 0);
  assert.equal((await cache.request('shot-v2', {})).status, 'cached');
});

test('three correction races cannot let obsolete completion clear the newest pending request', async () => {
  const { cache, loads, applied } = fixture();
  const a = cache.request('v1', {});
  await tick();
  const b = cache.request('v2', {});
  await tick();
  const c = cache.request('v3', {});
  await tick();
  loads[0].resolve('a');
  loads[1].reject(new Error('stale network failure'));
  assert.equal((await a).status, 'cancelled');
  assert.equal((await b).status, 'cancelled');
  assert.strictEqual(cache.request('v3', {}), c);
  assert.equal(loads.length, 3);
  loads[2].resolve('c');
  await c;
  assert.deepEqual(
    applied.map((x) => x.value),
    ['c'],
  );
});

test('reset cancels pending work and invalidates completed evidence so the same key reloads', async () => {
  const { cache, loads, applied } = fixture();
  const first = cache.request('same', {});
  await tick();
  cache.reset();
  loads[0].resolve('stale');
  assert.equal((await first).status, 'cancelled');
  assert.equal(applied.length, 0);
  const second = cache.request('same', {});
  await tick();
  loads[1].resolve('fresh');
  await second;
  cache.reset();
  const third = cache.request('same', {});
  await tick();
  assert.equal(loads.length, 3);
  loads[2].resolve('fresh again');
  await third;
  assert.equal(applied.length, 2);
});

test('current failures report once, remain uncached and allow retry', async () => {
  const { cache, loads, applied, errors } = fixture(),
    failed = cache.request('key', { anchorId: 'shot' });
  await tick();
  const problem = new Error('503');
  loads[0].reject(problem);
  assert.equal((await failed).status, 'error');
  assert.equal(errors.length, 1);
  assert.strictEqual(errors[0].error, problem);
  const retry = cache.request('key', { anchorId: 'shot' });
  await tick();
  loads[1].resolve('recovered');
  await retry;
  assert.equal(loads.length, 2);
  assert.equal(applied.length, 1);
});

test('loader AbortError is cancellation, not a visible network error, and can retry', async () => {
  const { cache, loads, errors } = fixture(),
    cancelled = cache.request('key', {});
  await tick();
  loads[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal((await cancelled).status, 'cancelled');
  assert.equal(errors.length, 0);
  const next = cache.request('key', {});
  await tick();
  loads[1].resolve('retry');
  assert.equal((await next).status, 'applied');
});

test('dispose prevents both late commits and new requests; immediate supersession never starts old loader', async () => {
  const { cache, loads, applied } = fixture();
  const a = cache.request('a', {}),
    b = cache.request('b', {});
  await tick();
  assert.equal(loads.length, 1);
  assert.equal(loads[0].key, 'b');
  assert.equal((await a).status, 'cancelled');
  cache.dispose();
  assert.equal(loads[0].signal.aborted, true);
  loads[0].resolve('late');
  assert.equal((await b).status, 'cancelled');
  assert.equal(applied.length, 0);
  assert.throws(() => cache.request('c', {}), /disposed/);
});

test('synchronous loader failure uses the same error and retry path', async () => {
  let attempts = 0;
  const errors = [];
  const cache = new InvestigationCache({
    load: () => {
      if (++attempts === 1) throw new Error('parse');
      return 'okay';
    },
    apply: () => {},
    onError: (error) => errors.push(error),
  });
  assert.equal((await cache.request('key', {})).status, 'error');
  assert.equal(errors.length, 1);
  assert.equal((await cache.request('key', {})).status, 'applied');
  assert.equal(attempts, 2);
});
