/**
 * Supplementary GST money-math tests for billing/tax.util.computeLineTax.
 *
 * tax.util.test.mjs already anchors the two headline invoices (₹53,100 and
 * ₹2,95,000 at 18%). This file adds the edges those miss: the other statutory
 * slabs (5 / 12 / 28%), odd-rate halving, the half-up rounding boundary, cess on
 * an inter-state supply, credit-note (negative) rounding, and two invariants
 * that must hold at EVERY rate — CGST==SGST intra-state, and CGST+SGST (intra)
 * == IGST (inter). A regression in the tax logic that moved a real bill is
 * caught here, fast, without a DB.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineTax, round2 } from '../../dist/billing/tax.util.js';

test('5% slab halves to 2.5% CGST + 2.5% SGST', () => {
  const t = computeLineTax(10, 1000, 5, 0, false);
  assert.equal(t.taxableAmount, 10000);
  assert.equal(t.cgstRate, 2.5);
  assert.equal(t.sgstRate, 2.5);
  assert.equal(t.cgstAmount, 250);
  assert.equal(t.sgstAmount, 250);
  assert.equal(t.lineTotal, 10500);
});

test('12% and 28% slabs split evenly intra-state', () => {
  const twelve = computeLineTax(4, 500, 12, 0, false); // taxable 2000
  assert.equal(twelve.cgstAmount, 120);
  assert.equal(twelve.sgstAmount, 120);
  assert.equal(twelve.lineTotal, 2240);

  const twentyEight = computeLineTax(2, 1000, 28, 0, false); // taxable 2000
  assert.equal(twentyEight.cgstAmount, 280);
  assert.equal(twentyEight.sgstAmount, 280);
  assert.equal(twentyEight.lineTotal, 2560);
});

test('rounding is half-up at the .5 paisa boundary', () => {
  // taxable 5 × 2.5% = 0.125 → rounds up to 0.13 on each of CGST and SGST.
  const t = computeLineTax(1, 5, 5, 0, false);
  assert.equal(t.taxableAmount, 5);
  assert.equal(t.cgstAmount, 0.13);
  assert.equal(t.sgstAmount, 0.13);
  assert.equal(t.lineTotal, 5.26);
});

test('cess applies on an inter-state supply too (IGST + cess, no CGST/SGST)', () => {
  const t = computeLineTax(10, 100, 18, 12, true); // taxable 1000
  assert.equal(t.igstRate, 18);
  assert.equal(t.igstAmount, 180);
  assert.equal(t.cessRate, 12);
  assert.equal(t.cessAmount, 120);
  assert.equal(t.cgstAmount, 0);
  assert.equal(t.sgstAmount, 0);
  assert.equal(t.lineTotal, 1300); // 1000 + 180 + 120
});

test('a credit-note (negative quantity) line negates every component consistently', () => {
  const t = computeLineTax(-10, 4500, 18, 0, false); // reverse of the ₹53,100 line
  assert.equal(t.taxableAmount, -45000);
  assert.equal(t.cgstAmount, -4050);
  assert.equal(t.sgstAmount, -4050);
  assert.equal(t.lineTotal, -53100);
});

test('round2 handles negative (credit-note) amounts cleanly', () => {
  assert.equal(round2(-4050), -4050);
  assert.equal(round2(-53100), -53100);
  assert.equal(round2(-0), 0);
});

test('invariant: CGST always equals SGST intra-state, across every slab', () => {
  for (const rate of [0, 5, 12, 18, 28]) {
    const t = computeLineTax(7, 333, rate, 0, false);
    assert.equal(t.cgstAmount, t.sgstAmount, `CGST==SGST at ${rate}%`);
    assert.equal(t.igstAmount, 0, `no IGST intra-state at ${rate}%`);
  }
});

test('intra-state CGST+SGST equals inter-state IGST exactly when the halves round cleanly', () => {
  // The evenly-divisible headline case: taxable 45000 @ 18% ⇒ 4050 + 4050 = 8100 = IGST.
  const intra = computeLineTax(10, 4500, 18, 0, false);
  const inter = computeLineTax(10, 4500, 18, 0, true);
  assert.equal(intra.cgstAmount + intra.sgstAmount, inter.igstAmount);
  assert.equal(intra.lineTotal, inter.lineTotal);
});

test('invariant: intra and inter totals always agree to within one paisa (independent half-rounding)', () => {
  // Halving the rate and rounding CGST and SGST SEPARATELY can differ from the
  // single rounded IGST by at most ₹0.01 — e.g. taxable 10101 @ 5% gives
  // 252.53 + 252.53 = 505.06 intra vs 505.05 IGST. This is expected GST rounding
  // behaviour, not a bug; the guarantee is "within one paisa", asserted here so a
  // change that widened the gap (a real defect) would be caught.
  for (const rate of [5, 12, 18, 28]) {
    const intra = computeLineTax(13, 777, rate, 0, false); // taxable 10101
    const inter = computeLineTax(13, 777, rate, 0, true);
    assert.equal(intra.taxableAmount, inter.taxableAmount, `same taxable base at ${rate}%`);
    // Compare at paisa precision (round2) so float subtraction noise
    // (0.01 → 0.010000000002) doesn't masquerade as a wider gap.
    assert.ok(
      round2(Math.abs(intra.cgstAmount + intra.sgstAmount - inter.igstAmount)) <= 0.01,
      `CGST+SGST within one paisa of IGST at ${rate}%`,
    );
    assert.ok(
      round2(Math.abs(intra.lineTotal - inter.lineTotal)) <= 0.01,
      `grand totals within one paisa at ${rate}%`,
    );
  }
});
