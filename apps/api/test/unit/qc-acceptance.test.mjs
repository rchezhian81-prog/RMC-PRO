/**
 * IS 456:2000 Table 11 cube-strength acceptance.
 *
 * Table 11, stated in full, is the whole of what is being tested here:
 *
 *   Grade        Mean of the group            Individual test result
 *   M15          ≥ fck + 3 N/mm²              ≥ fck − 3 N/mm²
 *   M20 or above ≥ fck + 4 N/mm²              ≥ fck − 4 N/mm²
 *
 * One margin per grade band, applied equally in both directions.
 *
 * The defect these pin: the code used two different figures, crossed over — a
 * margin of 4 with a tolerance of 3 at M20 and above, and 3 with 4 below it. So
 * an M25 cube breaking at exactly 21.0 N/mm², which complies, was failed; and an
 * M15 cube at 11.5, which does not comply, was passed.
 *
 * The previous version of this file asserted the implementation's numbers back
 * at it (individualFloor 22 for M25), which is why it never caught this. These
 * tests state the standard instead and are written from the table above, so they
 * fail if the code drifts from it in either direction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assessCubeSet,
  acceptanceMargin,
  individualFloor,
  meanFloor,
} from '../../dist/qc/acceptance.util.js';

test('Table 11: one margin per band, the same in both directions', () => {
  for (const fck of [10, 15, 19]) {
    assert.equal(acceptanceMargin(fck), 3, `below M20 the margin is 3 (fck ${fck})`);
    assert.equal(meanFloor(fck), fck + 3);
    assert.equal(individualFloor(fck), fck - 3);
  }
  for (const fck of [20, 25, 30, 40]) {
    assert.equal(acceptanceMargin(fck), 4, `M20 and above the margin is 4 (fck ${fck})`);
    assert.equal(meanFloor(fck), fck + 4);
    assert.equal(individualFloor(fck), fck - 4);
  }
});

test('M25: the floors are fck+4 and fck-4', () => {
  const r = assessCubeSet([31, 33, 32], 25);
  assert.equal(r.meanFloor, 29);
  assert.equal(r.individualFloor, 21);
  assert.equal(r.mean, 32);
  assert.equal(r.accepted, true);
});

test('an M25 cube at exactly fck-4 complies — it used to be failed', () => {
  // 21.0 is the boundary IS 456 allows. The old rule put the floor at 22 and
  // rejected a compliant pour: an investigation, and an argument with the
  // customer, over concrete that was fine.
  const r = assessCubeSet([40, 40, 21], 25);
  assert.equal(r.individualFloor, 21);
  assert.equal(r.individualPass, true, '21.0 ≥ 21 complies');
  assert.equal(r.meanPass, true);
  assert.equal(r.accepted, true);
});

test('an M25 cube below fck-4 still fails', () => {
  const r = assessCubeSet([40, 40, 20.9], 25);
  assert.equal(r.individualPass, false, '20.9 < 21 does not comply');
  assert.equal(r.accepted, false);
});

test('an M15 cube at fck-4 does NOT comply — it used to be passed', () => {
  // The dangerous direction: the old rule accepted 11 where the standard
  // requires 12, so deficient concrete passed. Nothing downstream questions an
  // acceptance.
  const r = assessCubeSet([18, 19, 11.5], 15);
  assert.equal(r.individualFloor, 12);
  assert.equal(r.individualPass, false, '11.5 < 12 does not comply');
  assert.equal(r.accepted, false);
});

test('an M15 set meeting the table is accepted', () => {
  const r = assessCubeSet([18, 19, 20], 15);
  assert.equal(r.meanFloor, 18);
  assert.equal(r.individualFloor, 12);
  assert.equal(r.mean, 19);
  assert.equal(r.accepted, true);
});

test('the mean criterion still stands on its own', () => {
  const r = assessCubeSet([28, 28, 28], 25); // every cube clears 21, mean 28 < 29
  assert.equal(r.individualPass, true);
  assert.equal(r.meanPass, false);
  assert.equal(r.accepted, false);
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

test('the per-cube flag and the set verdict read the same floor', () => {
  // Two copies of this number is how a cube marked "passed" ends up inside a
  // rejected set — a contradiction nobody can explain to an auditor later.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/qc/qc.service.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(src, /individualFloor\(fck\)/, 'qc.service must ask the shared helper');
  assert.doesNotMatch(src, /fck >= 20 \? 3 : 4/, 'and must not restate a margin of its own');
  assert.doesNotMatch(src, /const tolerance =/, 'there is no separate tolerance in IS 456');
});
