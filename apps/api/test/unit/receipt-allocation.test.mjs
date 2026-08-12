/**
 * Unit tests for receipt allocation (Plan C1) — spreading an advance across
 * outstanding invoices.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateAcrossInvoices } from '../../dist/billing/receipt-allocation.util.js';

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
