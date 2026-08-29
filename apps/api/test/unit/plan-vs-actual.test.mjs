/**
 * Unit tests for buildPlanVsActual (Tier 5C).
 *
 * Merges planned m³ (production plan) with actually-batched m³ (confirmed
 * tickets) by grade and reports the variance. Grades batched with no plan line
 * still appear (planned 0); a planned grade never batched shows −100%.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanVsActual } from '../../dist/production/plan-vs-actual.util.js';

test('merges by grade and computes variance (m³ and %)', () => {
  const r = buildPlanVsActual(
    [{ gradeLabel: 'M25', plannedM3: 100 }, { gradeLabel: 'M30', plannedM3: 50 }],
    [{ gradeLabel: 'M25', actualM3: 90 }, { gradeLabel: 'M30', actualM3: 55 }],
  );
  const m25 = r.rows.find((x) => x.gradeLabel === 'M25');
  assert.deepEqual([m25.plannedM3, m25.actualM3, m25.varianceM3, m25.variancePct], [100, 90, -10, -10]);
  const m30 = r.rows.find((x) => x.gradeLabel === 'M30');
  assert.deepEqual([m30.varianceM3, m30.variancePct], [5, 10]);
  assert.deepEqual([r.totals.plannedM3, r.totals.actualM3, r.totals.varianceM3], [150, 145, -5]);
});

test('sums multiple plan/actual rows for the same grade', () => {
  const r = buildPlanVsActual(
    [{ gradeLabel: 'M25', plannedM3: 40 }, { gradeLabel: 'M25', plannedM3: 60 }],
    [{ gradeLabel: 'M25', actualM3: 30 }, { gradeLabel: 'M25', actualM3: 30 }],
  );
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].plannedM3, r.rows[0].actualM3, r.rows[0].varianceM3], [100, 60, -40]);
});

test('a grade batched with no plan appears with planned 0 and null %', () => {
  const r = buildPlanVsActual([], [{ gradeLabel: 'M20', actualM3: 12 }]);
  assert.deepEqual([r.rows[0].plannedM3, r.rows[0].actualM3, r.rows[0].variancePct], [0, 12, null]);
});

test('a planned grade never batched shows the full shortfall (−100%)', () => {
  const r = buildPlanVsActual([{ gradeLabel: 'M35', plannedM3: 25 }], []);
  assert.deepEqual([r.rows[0].actualM3, r.rows[0].varianceM3, r.rows[0].variancePct], [0, -25, -100]);
});

test('blank grade labels fold into "Unspecified"', () => {
  const r = buildPlanVsActual([{ gradeLabel: null, plannedM3: 10 }], [{ gradeLabel: '', actualM3: 8 }]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].gradeLabel, 'Unspecified');
  assert.equal(r.rows[0].varianceM3, -2);
});
