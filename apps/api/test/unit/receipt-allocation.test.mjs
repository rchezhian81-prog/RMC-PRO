/**
 * Unit tests for receipt allocation (Plan C1) — spreading an advance across
 * outstanding invoices.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateAcrossInvoices, invoiceBalanceAfter } from '../../dist/billing/receipt-allocation.util.js';

test('fills invoices in order until the amount runs out', () => {
  const a = allocateAcrossInvoices(1200, [
    { id: 'i1', outstanding: 500 },
    { id: 'i2', outstanding: 800 },
    { id: 'i3', outstanding: 400 },
  ]);
  assert.deepEqual(a, [
    { invoiceId: 'i1', amount: 500 },
    { invoiceId: 'i2', amount: 700 }, // only 700 of the 1200 left after i1
  ]);
});

test('a partial amount produces a partial allocation on the first invoice', () => {
  const a = allocateAcrossInvoices(300, [{ id: 'i1', outstanding: 500 }]);
  assert.deepEqual(a, [{ invoiceId: 'i1', amount: 300 }]);
});

test('an exact amount clears the invoice with nothing left over', () => {
  const a = allocateAcrossInvoices(500, [{ id: 'i1', outstanding: 500 }, { id: 'i2', outstanding: 200 }]);
  assert.deepEqual(a, [{ invoiceId: 'i1', amount: 500 }]);
});

test('nothing to allocate → no lines', () => {
  assert.deepEqual(allocateAcrossInvoices(0, [{ id: 'i1', outstanding: 500 }]), []);
  assert.deepEqual(allocateAcrossInvoices(100, []), []);
});

test('surplus beyond all outstanding stops at the last invoice (remainder stays an advance)', () => {
  const a = allocateAcrossInvoices(1000, [{ id: 'i1', outstanding: 300 }, { id: 'i2', outstanding: 200 }]);
  assert.deepEqual(a, [{ invoiceId: 'i1', amount: 300 }, { invoiceId: 'i2', amount: 200 }]);
  const applied = a.reduce((s, x) => s + x.amount, 0);
  assert.equal(applied, 500); // 500 remains unallocated
});

// invoiceBalanceAfter — the single settle rule shared by receipt create,
// advance-apply and bounce. The write-off cases are the AR regression: a
// manual allocation must NOT resurrect a written-off balance.
test('no write-off: outstanding = total − paid', () => {
  assert.deepEqual(invoiceBalanceAfter(1000, 0, 0), { outstanding: 1000, paymentStatus: 'unpaid' });
  assert.deepEqual(invoiceBalanceAfter(1000, 400, 0), { outstanding: 600, paymentStatus: 'partially_paid' });
  assert.deepEqual(invoiceBalanceAfter(1000, 1000, 0), { outstanding: 0, paymentStatus: 'paid' });
});

test('partial write-off is honoured — allocation does not resurrect it', () => {
  // total 1000, 200 written off → real dues 800. Pay 500.
  // Correct: 1000 − 500 − 200 = 300 (not the buggy 1000 − 500 = 500).
  assert.deepEqual(invoiceBalanceAfter(1000, 500, 200), { outstanding: 300, paymentStatus: 'partially_paid' });
});

test('paying the post-write-off dues marks the invoice paid', () => {
  // 200 written off, then 800 paid clears it — buggy math (1000 − 800 = 200) never would.
  assert.deepEqual(invoiceBalanceAfter(1000, 800, 200), { outstanding: 0, paymentStatus: 'paid' });
});

test('fully written off with nothing paid is settled (paid), not unpaid', () => {
  assert.deepEqual(invoiceBalanceAfter(500, 0, 500), { outstanding: 0, paymentStatus: 'paid' });
});

test('bounce reversal (paid drops back) recomputes with the write-off intact', () => {
  // After a bounce, paid returns to 0 on an invoice that still has 200 written off.
  assert.deepEqual(invoiceBalanceAfter(1000, 0, 200), { outstanding: 800, paymentStatus: 'unpaid' });
});

test('accepts DB numeric strings and rounds to paise', () => {
  assert.deepEqual(invoiceBalanceAfter('1000.00', '500.00', '200.00'), { outstanding: 300, paymentStatus: 'partially_paid' });
  assert.deepEqual(invoiceBalanceAfter('100.005', '0', '0'), { outstanding: 100.01, paymentStatus: 'unpaid' });
});
