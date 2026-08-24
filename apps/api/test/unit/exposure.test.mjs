/**
 * Unit tests for the unified credit-exposure math (design plan §2–§3).
 *
 * Covers the two PURE helpers behind computeCustomerExposure: orderRemaining
 * (the order→invoice hand-off) and assembleExposure (opening + un-invoiced
 * orders + invoice outstanding − advances, with the unlimited-limit rule). The
 * DB-reading computeCustomerExposure is exercised by the ar-exposure integration
 * scenarios (T1–T10).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderRemaining, assembleExposure } from '../../dist/orders/exposure.util.js';

// ---- orderRemaining: the hand-off ------------------------------------------
test('un-billed order counts its full incl-GST value', () => {
  assert.equal(orderRemaining('59000.00', '50000.00', 0), 59000);
  assert.equal(orderRemaining(59000, 50000, null), 59000);
});

test('partially billed order counts only the remainder', () => {
  // incl 59000, one invoice of 20000 raised → 39000 still exposed.
  assert.equal(orderRemaining(59000, 50000, 20000), 39000);
});

test('fully billed order counts nothing (floored at zero)', () => {
  assert.equal(orderRemaining(59000, 50000, 59000), 0);
});

test('over-billed order never goes negative', () => {
  // Guards the multi-order-invoice edge: billed may exceed one order's value.
  assert.equal(orderRemaining(59000, 50000, 90000), 0);
});

test('legacy order (no incl-GST) falls back to the ex-GST value', () => {
  assert.equal(orderRemaining(null, '50000.00', 0), 50000);
  assert.equal(orderRemaining(undefined, 50000, 10000), 40000);
});

// ---- assembleExposure: the four terms --------------------------------------
test('exposure = opening + un-invoiced orders + invoice outstanding − advances', () => {
  const e = assembleExposure({
    openingBalance: 1000, unInvoicedOrderValue: 20000, invoiceOutstanding: 30000,
    advanceCredit: 5000, creditLimit: 100000,
  });
  assert.equal(e.exposure, 46000);          // 1000 + 20000 + 30000 − 5000
  assert.equal(e.availableCredit, 54000);   // 100000 − 46000
});

test('an unapplied advance nets exposure down; removing it restores exposure', () => {
  const withAdvance = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 0, invoiceOutstanding: 40000, advanceCredit: 15000, creditLimit: 0,
  });
  const withoutAdvance = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 0, invoiceOutstanding: 40000, advanceCredit: 0, creditLimit: 0,
  });
  assert.equal(withAdvance.exposure, 25000);
  assert.equal(withoutAdvance.exposure, 40000);          // e.g. after a bounce restores the balance
  assert.equal(withoutAdvance.exposure - withAdvance.exposure, 15000);
});

test('advance greater than owed yields a negative (net-credit) exposure', () => {
  const e = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 0, invoiceOutstanding: 0, advanceCredit: 15000, creditLimit: 50000,
  });
  assert.equal(e.exposure, -15000);
  assert.equal(e.availableCredit, 65000);   // 50000 − (−15000)
});

test('credit_limit 0 means unlimited — availableCredit is null, exposure still computed', () => {
  const e = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 47200, invoiceOutstanding: 0, advanceCredit: 0, creditLimit: 0,
  });
  assert.equal(e.exposure, 47200);
  assert.equal(e.availableCredit, null);
});

test('a positive limit exactly at exposure leaves zero available (boundary)', () => {
  const e = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 47200, invoiceOutstanding: 0, advanceCredit: 0, creditLimit: 47200,
  });
  assert.equal(e.availableCredit, 0);
});

test('fractional inputs are rounded to paise', () => {
  const e = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 0, invoiceOutstanding: 100.126, advanceCredit: 0, creditLimit: 0,
  });
  assert.equal(e.exposure, 100.13);
});

test('all-zero customer has zero exposure and null available (no limit)', () => {
  const e = assembleExposure({
    openingBalance: 0, unInvoicedOrderValue: 0, invoiceOutstanding: 0, advanceCredit: 0, creditLimit: 0,
  });
  assert.equal(e.exposure, 0);
  assert.equal(e.availableCredit, null);
});
