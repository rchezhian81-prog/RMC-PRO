/**
 * Unit tests for the purchase line maths with a trade discount and the
 * whole-rupee round-off on a purchase order / vendor bill total.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDiscountPct, purchaseLineAmounts, purchaseTotals } from '../../dist/purchase/purchase.util.js';

// ---- isValidDiscountPct ----
test('a discount is a percentage from 0 to 100', () => {
  for (const v of [0, 10, 100, '12.5']) assert.equal(isValidDiscountPct(v), true, `${v} is valid`);
  for (const v of [-1, 100.01, 'abc', Infinity, NaN]) assert.equal(isValidDiscountPct(v), false, `${v} is refused`);
});

// ---- purchaseLineAmounts ----
test('no discount: taxable = qty × rate, tax on it, line total', () => {
  assert.deepEqual(purchaseLineAmounts({ quantity: 10, rate: 500, gstRate: 18 }), { taxableAmount: 5000, taxAmount: 900, lineTotal: 5900 });
});

test('a 10% discount comes off the rate before tax', () => {
  assert.deepEqual(purchaseLineAmounts({ quantity: 10, rate: 1000, gstRate: 18, discountPct: 10 }), { taxableAmount: 9000, taxAmount: 1620, lineTotal: 10620 });
});

test('a 100% discount makes the line free', () => {
  assert.deepEqual(purchaseLineAmounts({ quantity: 3, rate: 700, gstRate: 28, discountPct: 100 }), { taxableAmount: 0, taxAmount: 0, lineTotal: 0 });
});

test('paise are rounded at each step so the stored columns add up', () => {
  // 1.5 × 1234.56 = 1851.84; 5% of it = 92.592 → 92.59.
  assert.deepEqual(purchaseLineAmounts({ quantity: 1.5, rate: 1234.56, gstRate: 5 }), { taxableAmount: 1851.84, taxAmount: 92.59, lineTotal: 1944.43 });
  // 7 × 99.99 × 0.875 = 612.43875 → 612.44; 18% = 110.2392 → 110.24.
  assert.deepEqual(purchaseLineAmounts({ quantity: 7, rate: 99.99, gstRate: 18, discountPct: 12.5 }), { taxableAmount: 612.44, taxAmount: 110.24, lineTotal: 722.68 });
});

// ---- purchaseTotals ----
test('a whole-rupee grand total needs no round-off', () => {
  const t = purchaseTotals([purchaseLineAmounts({ quantity: 10, rate: 1000, gstRate: 18, discountPct: 10 })]);
  assert.deepEqual(t, { taxableAmount: 9000, taxAmount: 1620, roundOff: 0, totalAmount: 10620 });
});

test('paise below a half round down, with the signed difference kept', () => {
  const t = purchaseTotals([
    purchaseLineAmounts({ quantity: 10, rate: 1000, gstRate: 18, discountPct: 10 }),
    purchaseLineAmounts({ quantity: 1.5, rate: 1234.56, gstRate: 5 }),
  ]);
  // 10851.84 + 1712.59 = 12564.43 → 12564, round-off −0.43.
  assert.deepEqual(t, { taxableAmount: 10851.84, taxAmount: 1712.59, roundOff: -0.43, totalAmount: 12564 });
});

test('paise at or above a half round up', () => {
  // 612.44 + 110.24 = 722.68 → 723, round-off +0.32.
  const t = purchaseTotals([purchaseLineAmounts({ quantity: 7, rate: 99.99, gstRate: 18, discountPct: 12.5 })]);
  assert.deepEqual(t, { taxableAmount: 612.44, taxAmount: 110.24, roundOff: 0.32, totalAmount: 723 });
  // Exactly a half rupee rounds away from zero, like Postgres numeric.
  const half = purchaseTotals([{ taxableAmount: 100.5, taxAmount: 0, lineTotal: 100.5 }]);
  assert.deepEqual(half, { taxableAmount: 100.5, taxAmount: 0, roundOff: 0.5, totalAmount: 101 });
});

test('no lines is a zero document', () => {
  assert.deepEqual(purchaseTotals([]), { taxableAmount: 0, taxAmount: 0, roundOff: 0, totalAmount: 0 });
});
