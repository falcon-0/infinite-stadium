import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamCadence } from './stream-cadence.js';

test('packet computation does not accumulate as extra match time', () => {
  let wall = 0;
  const delay = createStreamCadence(1, () => wall);
  for (let second = 1; second <= 120; second++) {
    wall += 175; // Simulated evidence processing and transport preparation.
    wall += delay();
    assert.equal(wall, second * 1000);
  }
});
test('2x replay delivers the two-minute passage in one wall-clock minute', () => {
  let wall = 0;
  const delay = createStreamCadence(2, () => wall);
  for (let second = 1; second <= 120; second++) {
    wall += 125;
    wall += delay();
    assert.equal(wall, second * 500);
  }
  assert.equal(wall, 60000);
});

test('accelerated replay accounts for work and a long stall does not burst', () => {
  let wall = 0;
  const delay = createStreamCadence(4, () => wall);
  wall = 50;
  assert.equal(delay(), 200);
  wall = 300;
  assert.equal(delay(), 200);
  wall = 10000;
  assert.equal(delay(), 0);
  wall = 10010;
  assert.equal(delay(), 240);
});
