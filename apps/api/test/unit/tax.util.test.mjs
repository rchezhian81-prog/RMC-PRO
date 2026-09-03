/**
 * Unit tests for the GST money-math (billing/tax.util.ts) — the single most
 * regression-sensitive calculation in the product. Anchored to the exact totals
 * the integration/UAT suites assert (₹53,100 and ₹2,95,000) so a change to the
 * tax logic that would move a real invoice is caught here, fast, without a DB.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first
 * (the `test` turbo task depends on `build`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineTax, round2, isInterstateSupply } from '../../dist/billing/tax.util.js';

test('isInterstateSupply classifies by resolved GST state code, not raw name', () => {
  // Same state, different spellings must stay INTRA-state (CGST+SGST, not IGST).
  assert.equal(isInterstateSupply('Odisha', 'Orissa'), false);
  assert.equal(isInterstateSupply('Tamil Nadu', 'Tamilnadu'), false);
  assert.equal(isInterstateSupply('Uttarakhand', 'Uttaranchal'), false);
  assert.equal(isInterstateSupply('Chhattisgarh', 'Chattisgarh'), false);
  // Genuinely different states → inter-state (IGST).
  assert.equal(isInterstateSupply('Tamil Nadu', 'Karnataka'), true);
  // Unresolvable names fall back to a plain name compare.
  assert.equal(isInterstateSupply('Wakanda', 'Wakanda'), false);
  assert.equal(isInterstateSupply('Foo', 'Bar'), true);
});

test('round2 rounds to two decimals', () => {
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(100), 100);
  assert.equal(round2('45000'), 45000); // tolerant of numeric strings
  assert.equal(round2(NaN), 0);
});

test('intra-state supply splits GST into equal CGST + SGST (UAT ₹53,100 case)', () => {
  const t = computeLineTax(10, 4500, 18, 0, false);
  assert.equal(t.taxableAmount, 45000);
  assert.equal(t.cgstRate, 9);
  assert.equal(t.sgstRate, 9);
  assert.equal(t.cgstAmount, 4050);
  assert.equal(t.sgstAmount, 4050);
  assert.equal(t.igstAmount, 0);
  assert.equal(t.lineTotal, 53100);
});

test('order-to-cash ₹2,95,000 case (50 m³ × ₹5,000 @ 18%)', () => {
  const t = computeLineTax(50, 5000, 18, 0, false);
  assert.equal(t.taxableAmount, 250000);
  assert.equal(t.cgstAmount, 22500);
  assert.equal(t.sgstAmount, 22500);
  assert.equal(t.lineTotal, 295000);
});

test('inter-state supply uses IGST only, same grand total as intra', () => {
  const inter = computeLineTax(10, 4500, 18, 0, true);
  assert.equal(inter.igstRate, 18);
  assert.equal(inter.igstAmount, 8100);
  assert.equal(inter.cgstAmount, 0);
  assert.equal(inter.sgstAmount, 0);
  assert.equal(inter.lineTotal, 53100);
  // CGST+SGST (intra) must equal IGST (inter) for the same rate.
  const intra = computeLineTax(10, 4500, 18, 0, false);
  assert.equal(intra.cgstAmount + intra.sgstAmount, inter.igstAmount);
});

test('cess is applied on the taxable value and added to the line total', () => {
  const t = computeLineTax(10, 100, 18, 12, false);
  assert.equal(t.taxableAmount, 1000);
  assert.equal(t.cessRate, 12);
  assert.equal(t.cessAmount, 120);
  assert.equal(t.cgstAmount, 90);
  assert.equal(t.sgstAmount, 90);
  assert.equal(t.lineTotal, 1300); // 1000 + 90 + 90 + 120
});

test('zero rate produces no tax', () => {
  const t = computeLineTax(5, 200, 0, 0, false);
  assert.equal(t.taxableAmount, 1000);
  assert.equal(t.cgstAmount, 0);
  assert.equal(t.sgstAmount, 0);
  assert.equal(t.igstAmount, 0);
  assert.equal(t.lineTotal, 1000);
});
