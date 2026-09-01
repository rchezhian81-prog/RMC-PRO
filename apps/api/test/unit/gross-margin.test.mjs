/**
 * Unit tests for the gross-margin-per-m³ maths (billing/gross-margin.util.ts).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGradeMargin } from '../../dist/billing/gross-margin.util.js';

test('computes per-m³ revenue, cost, margin and margin % per grade', () => {
  const { rows, totals } = buildGradeMargin(
    [
      { gradeId: 'g1', gradeLabel: 'M25', volumeM3: '100', revenue: '480000' }, // ₹4800/m³
      { gradeId: 'g2', gradeLabel: 'M30', volumeM3: '50', revenue: '260000' }, // ₹5200/m³
    ],
    [
      { gradeId: 'g1', stdCostPerM3: '3600' },
      { gradeId: 'g2', stdCostPerM3: '4000' },
    ],
  );

  const m25 = rows.find((r) => r.gradeLabel === 'M25');
  assert.equal(m25.revenuePerM3, 4800);
  assert.equal(m25.stdMaterialCostPerM3, 3600);
  assert.equal(m25.grossMarginPerM3, 1200);
  assert.equal(m25.grossMargin, 120000); // 1200 * 100
  assert.equal(m25.marginPct, 25); // 1200/4800

  // M30 has the thinner per-m³ margin (1200 vs 1200? no: 5200-4000=1200 too) —
  // tie on margin/m³, so it falls back to label order (M25 before M30).
  assert.equal(rows[0].gradeLabel, 'M25');

  assert.equal(totals.volumeM3, 150);
  assert.equal(totals.revenue, 740000);
  assert.equal(totals.grossMargin, 120000 + 60000);
  assert.equal(totals.grossMarginPerM3, 1200); // 180000 / 150
});

test('sorts thinnest margin-per-m³ first (loss-making grade surfaces at the top)', () => {
  const { rows } = buildGradeMargin(
    [
      { gradeId: 'good', gradeLabel: 'M40', volumeM3: '10', revenue: '60000' }, // 6000/m³
      { gradeId: 'loss', gradeLabel: 'M10', volumeM3: '10', revenue: '30000' }, // 3000/m³
    ],
    [
      { gradeId: 'good', stdCostPerM3: '4000' }, // +2000/m³
      { gradeId: 'loss', stdCostPerM3: '3500' }, // -500/m³ (underwater)
    ],
  );
  assert.equal(rows[0].gradeLabel, 'M10');
  assert.equal(rows[0].grossMarginPerM3, -500);
  assert.equal(rows[0].marginPct, -16.67); // -500/3000*100
});

test('a grade with revenue but no priced mix design costs at 0 (margin = full revenue)', () => {
  const { rows } = buildGradeMargin(
    [{ gradeId: 'x', gradeLabel: 'Custom', volumeM3: '5', revenue: '25000' }],
    [],
  );
  assert.equal(rows[0].stdMaterialCostPerM3, 0);
  assert.equal(rows[0].grossMarginPerM3, 5000);
  assert.equal(rows[0].marginPct, 100);
});

test('zero volume does not divide by zero — revenue/m³ is 0 and pct is null', () => {
  const { rows } = buildGradeMargin(
    [{ gradeId: 'z', gradeLabel: 'Zero', volumeM3: '0', revenue: '0' }],
    [{ gradeId: 'z', stdCostPerM3: '3000' }],
  );
  assert.equal(rows[0].revenuePerM3, 0); // no divide-by-zero
  assert.equal(rows[0].grossMarginPerM3, -3000); // 0 revenue/m³ − 3000 cost/m³
  assert.equal(rows[0].marginPct, null); // no revenue basis to express a %
});
