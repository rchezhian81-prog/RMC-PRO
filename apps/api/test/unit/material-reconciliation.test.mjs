/**
 * Unit tests for the material-reconciliation maths
 * (production/material-reconciliation.util.ts).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialReconciliation } from '../../dist/production/material-reconciliation.util.js';

test('merges dosing + stock rows by material and computes both variances', () => {
  const { rows, totals } = buildMaterialReconciliation(
    [
      { material: 'Cement 53', uom: 'kg', theoretical: '700', actualDosed: '714' },
      { material: 'Agg 20mm', uom: 'kg', theoretical: '1000', actualDosed: '1000' },
    ],
    [
      { material: 'Cement 53', stockConsumed: '720' },
      { material: 'Agg 20mm', stockConsumed: '1000' },
    ],
  );

  const cement = rows.find((r) => r.material === 'Cement 53');
  assert.equal(cement.theoretical, 700);
  assert.equal(cement.actualDosed, 714);
  assert.equal(cement.stockConsumed, 720);
  assert.equal(cement.dosingVarianceQty, 14); // 714 - 700
  assert.equal(cement.dosingVariancePct, 2); // 14/700 = 2%
  assert.equal(cement.stockVarianceQty, 6); // 720 - 714 (ledger drew 6 more than dosed)
  assert.equal(cement.stockVariancePct, 0.84); // 6/714 * 100, rounded to 2dp

  // Cement has the larger absolute stock variance, so it sorts first.
  assert.equal(rows[0].material, 'Cement 53');

  assert.equal(totals.theoretical, 1700);
  assert.equal(totals.actualDosed, 1714);
  assert.equal(totals.stockConsumed, 1720);
  assert.equal(totals.dosingVarianceQty, 14);
  assert.equal(totals.stockVarianceQty, 6);
});

test('material present only in the stock ledger (no dosing rows) still reconciles', () => {
  const { rows } = buildMaterialReconciliation([], [{ material: 'Admixture', stockConsumed: '5' }]);
  assert.equal(rows.length, 1);
  const a = rows[0];
  assert.equal(a.theoretical, 0);
  assert.equal(a.actualDosed, 0);
  assert.equal(a.stockConsumed, 5);
  assert.equal(a.stockVarianceQty, 5);
  // No theoretical/dosed basis -> percentages are null, not Infinity/NaN.
  assert.equal(a.dosingVariancePct, null);
  assert.equal(a.stockVariancePct, null);
});

test('null/blank material labels collapse to a single "Unspecified" bucket', () => {
  const { rows } = buildMaterialReconciliation(
    [
      { material: null, uom: null, theoretical: '10', actualDosed: '9' },
      { material: '   ', uom: null, theoretical: '5', actualDosed: '5' },
    ],
    [{ material: null, stockConsumed: '16' }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].material, 'Unspecified');
  assert.equal(rows[0].theoretical, 15);
  assert.equal(rows[0].actualDosed, 14);
  assert.equal(rows[0].stockConsumed, 16);
});

test('quantities round to 3dp and percentages to 2dp', () => {
  const { rows } = buildMaterialReconciliation(
    [{ material: 'X', theoretical: '3', actualDosed: '3.3334' }],
    [{ material: 'X', stockConsumed: '3.3334' }],
  );
  assert.equal(rows[0].actualDosed, 3.333);
  assert.equal(rows[0].dosingVarianceQty, 0.333); // 0.3334 -> 0.333
  assert.equal(rows[0].dosingVariancePct, 11.11); // 0.3334/3*100 = 11.113.. -> 11.11
});
