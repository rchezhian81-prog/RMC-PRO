/**
 * Unit tests for IS 456 cube-strength acceptance (Plan A3).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first
 * (the test turbo task depends on build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCubeSet } from '../../dist/qc/acceptance.util.js';

test('a comfortably strong M25 set is accepted', () => {
  const r = assessCubeSet([31, 33, 32], 25);
  assert.equal(r.meanFloor, 29); // 25 + 4
  assert.equal(r.individualFloor, 22); // 25 - 3
  assert.equal(r.mean, 32);
  assert.equal(r.meanPass, true);
  assert.equal(r.individualPass, true);
  assert.equal(r.accepted, true);
});

test('a set that fails the mean criterion is rejected', () => {
  const r = assessCubeSet([28, 28, 28], 25); // mean 28 < 29
  assert.equal(r.meanPass, false);
  assert.equal(r.accepted, false);
});

test('a strong mean cannot rescue one weak cube (individual criterion)', () => {
  const r = assessCubeSet([40, 40, 21], 25); // mean 33.67 ok, but 21 < 22
  assert.equal(r.meanPass, true);
  assert.equal(r.individualPass, false);
  assert.equal(r.accepted, false);
});

test('lower grades use the 3/4 margins', () => {
  const r = assessCubeSet([18, 19, 20], 15); // margin 3 → floor 18; tol 4 → floor 11
  assert.equal(r.meanFloor, 18);
  assert.equal(r.individualFloor, 11);
  assert.equal(r.accepted, true); // mean 19 ≥ 18, min 18 ≥ 11
});

test('no data or non-positive fck returns null', () => {
  assert.equal(assessCubeSet([], 25), null);
  assert.equal(assessCubeSet([30], 0), null);
});

test('non-finite strengths are ignored', () => {
  const r = assessCubeSet([31, Number.NaN, 33], 25);
  assert.equal(r.n, 2);
  assert.equal(r.mean, 32);
});
