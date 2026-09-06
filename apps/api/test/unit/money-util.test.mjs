import { test } from 'node:test';
import assert from 'node:assert/strict';
import { round2, roundTo } from '../../dist/common/money.util.js';

test('round2 agrees with Postgres numeric(…,2) on decimal ties (half away from zero)', () => {
  // Math.round(1.005 * 100) / 100 === 1 — the binary value is 1.00499…; PG stores 1.01.
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(100.005), 100.01);
  assert.equal(round2(52.755), 52.76);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(-2.675), -2.68);
});

test('round2 keeps the plain cases', () => {
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(100), 100);
  assert.equal(round2(1.01), 1.01);
  assert.equal(round2(999999.995), 1000000);
  assert.equal(round2('45000'), 45000);
  assert.equal(round2('1.005'), 1.01);
  assert.equal(round2(NaN), 0);
  assert.equal(round2(undefined), 0);
  assert.equal(round2(null), 0);
  assert.equal(round2(-0), 0);
  assert.equal(round2(Infinity), 0);
});

test('round2 tolerates exponent-notation magnitudes', () => {
  assert.equal(round2(1e-7), 0);
  assert.ok(Number.isFinite(round2(1e21)) && round2(1e21) > 0);
  assert.equal(round2(-1e-9), 0);
});

test('roundTo handles other scales the same way', () => {
  assert.equal(roundTo(1.0005, 3), 1.001);
  assert.equal(roundTo(12.3456, 3), 12.346);
  assert.equal(roundTo(2.5, 0), 3);
  assert.equal(roundTo(-2.5, 0), -3);
  assert.equal(roundTo(0.125, 2), 0.13);
});

test('sum of rounded parts equals the rounded whole for paise-exact inputs', () => {
  let total = 0;
  for (const v of [0.1, 0.2, 0.3, 1.005, 2.675, 99.995]) total = round2(total + round2(v));
  assert.equal(total, round2(0.1 + 0.2 + 0.3 + 1.01 + 2.68 + 100));
});
