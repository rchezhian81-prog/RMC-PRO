/**
 * Unit tests for the pricing/GST helpers (Plan B2) — the CGST/SGST/IGST split,
 * the quotation/order tax summary, and the guarantee that a quote/order line
 * reconciles with the eventual invoice line.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGstOnTaxable,
  computeLineTax,
  summariseGst,
  isInterstateSupply,
} from '../../dist/billing/tax.util.js';

test('intra-state splits the rate into CGST + SGST', () => {
  const t = computeGstOnTaxable(1000, 18, 0, false);
  assert.equal(t.cgstAmount, 90);
  assert.equal(t.sgstAmount, 90);
  assert.equal(t.igstAmount, 0);
  assert.equal(t.lineTotal, 1180);
});

test('inter-state uses IGST', () => {
  const t = computeGstOnTaxable(1000, 18, 0, true);
  assert.equal(t.igstAmount, 180);
  assert.equal(t.cgstAmount, 0);
  assert.equal(t.lineTotal, 1180);
});

test('the summary folds freight (transport/pump/waiting) into the taxable base', () => {
  const s = summariseGst(
    [{ quantity: 10, rate: 100, transport: 20, pump: 10, waiting: 0, gstRate: 18, gstApplicable: true }],
    false,
  );
  // base = 10 * (100+20+10) = 1300
  assert.equal(s.taxable, 1300);
  assert.equal(s.cgst, 117);
  assert.equal(s.sgst, 117);
  assert.equal(s.total, 1534);
});

test('a quote/order line reconciles with its invoice line', () => {
  const q = 7, r = 4500, tr = 200, p = 150, w = 50, gst = 18;
  const summary = summariseGst(
    [{ quantity: q, rate: r, transport: tr, pump: p, waiting: w, gstRate: gst, gstApplicable: true }],
    false,
  );
  // The invoice bundles the per-m³ charges into one agreed rate.
  const invoice = computeLineTax(q, r + tr + p + w, gst, 0, false);
  assert.equal(summary.taxable, invoice.taxableAmount);
  assert.equal(summary.total, invoice.lineTotal);
});

test('a GST-exempt line contributes no tax', () => {
  const s = summariseGst([{ quantity: 5, rate: 100, gstRate: 18, gstApplicable: false }], false);
  assert.equal(s.taxable, 500);
  assert.equal(s.total, 500);
  assert.equal(s.cgst, 0);
});

test('inter-state detection compares states case/space-insensitively', () => {
  assert.equal(isInterstateSupply('Tamil Nadu', 'Karnataka'), true);
  assert.equal(isInterstateSupply(' tamil nadu ', 'Tamil Nadu'), false);
  assert.equal(isInterstateSupply('', 'Karnataka'), false); // unknown seller → treat as intra
});
