/**
 * Unit tests for the Purchase / AP-lite helpers (Plan D2): the 3-way match,
 * the purchase-order receipt roll-up, and the vendor-bill payment status.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poReceiptStatus,
  matchLine,
  summariseMatch,
  billPaymentStatus,
} from '../../dist/purchase/purchase.util.js';

// ---- poReceiptStatus ----
test('a PO with nothing received is not_received', () => {
  assert.equal(poReceiptStatus([{ ordered: 100, received: 0 }, { ordered: 5, received: 0 }]), 'not_received');
});

test('a PO with every line fully received is received', () => {
  assert.equal(poReceiptStatus([{ ordered: 100, received: 100 }, { ordered: 5, received: 5 }]), 'received');
});

test('over-delivery still counts a line as fully received', () => {
  assert.equal(poReceiptStatus([{ ordered: 100, received: 103 }]), 'received');
});

test('a PO with some but not all received is partially_received', () => {
  assert.equal(poReceiptStatus([{ ordered: 100, received: 40 }, { ordered: 5, received: 0 }]), 'partially_received');
});

test('an empty PO is not_received', () => {
  assert.equal(poReceiptStatus([]), 'not_received');
});

// ---- matchLine ----
test('a clean line matches on qty and price', () => {
  const r = matchLine({ billedQty: 100, billedRate: 500, orderedRate: 500, acceptedQty: 100 });
  assert.equal(r.qtyOk, true);
  assert.equal(r.priceOk, true);
  assert.equal(r.qtyExcess, 0);
  assert.equal(r.priceVariancePct, 0);
});

test('billing more than received fails the quantity check and reports the excess', () => {
  const r = matchLine({ billedQty: 120, billedRate: 500, orderedRate: 500, acceptedQty: 100 });
  assert.equal(r.qtyOk, false);
  assert.equal(r.qtyExcess, 20);
});

test('a small over-bill inside the tolerance still passes', () => {
  // 2% of 100 = 2, so 101 accepted qty is fine.
  const r = matchLine({ billedQty: 101, billedRate: 500, orderedRate: 500, acceptedQty: 100 }, 2);
  assert.equal(r.qtyOk, true);
});

test('a rate above the PO beyond tolerance fails the price check', () => {
  const r = matchLine({ billedQty: 100, billedRate: 560, orderedRate: 500, acceptedQty: 100 }, 2);
  assert.equal(r.priceOk, false);
  assert.equal(r.priceVariancePct, 12); // 60/500
});

test('a rate within tolerance passes', () => {
  const r = matchLine({ billedQty: 100, billedRate: 509, orderedRate: 500, acceptedQty: 100 }, 2);
  assert.equal(r.priceOk, true); // 9 <= 10 (2% of 500)
});

test('with no PO rate the price is not flagged', () => {
  const r = matchLine({ billedQty: 100, billedRate: 500, orderedRate: 0, acceptedQty: 100 });
  assert.equal(r.priceOk, true);
  assert.equal(r.priceVariancePct, 0);
});

// ---- summariseMatch ----
test('all lines clean → matched', () => {
  const s = summariseMatch([
    { billedQty: 100, billedRate: 500, orderedRate: 500, acceptedQty: 100 },
    { billedQty: 5, billedRate: 8000, orderedRate: 8000, acceptedQty: 5 },
  ]);
  assert.equal(s.status, 'matched');
  assert.equal(s.qtyOk, true);
  assert.equal(s.priceOk, true);
});

test('one bad line drags the whole bill to over_tolerance', () => {
  const s = summariseMatch([
    { billedQty: 100, billedRate: 500, orderedRate: 500, acceptedQty: 100 },
    { billedQty: 5, billedRate: 9000, orderedRate: 8000, acceptedQty: 5 }, // 12.5% price jump
  ]);
  assert.equal(s.status, 'over_tolerance');
  assert.equal(s.priceOk, false);
  assert.equal(s.qtyOk, true);
});

// ---- billPaymentStatus ----
test('bill payment status: unpaid / partial / paid', () => {
  assert.equal(billPaymentStatus(1000, 0), 'unpaid');
  assert.equal(billPaymentStatus(1000, 400), 'partially_paid');
  assert.equal(billPaymentStatus(1000, 1000), 'paid');
  assert.equal(billPaymentStatus(1000, 1000.005), 'paid'); // rounding tolerance
});
