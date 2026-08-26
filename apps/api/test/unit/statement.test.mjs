/**
 * Unit tests for the customer statement of account (party ledger) math.
 *
 * buildStatement is the pure core: opening balance + issued invoices (debit) −
 * receipts (credit), in date order with a running balance, optionally bounded
 * to a period (earlier activity folds into the opening balance). The DB gather
 * is exercised by the integration flow.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatement } from '../../dist/billing/statement.util.js';

const inv = (date, ref, amt) => ({ date, sortKey: `${date}#${ref}`, type: 'invoice', ref, particulars: `Invoice ${ref}`, debit: amt, credit: 0 });
const rcpt = (date, ref, amt) => ({ date, sortKey: `${date}#${ref}`, type: 'receipt', ref, particulars: `Receipt ${ref}`, debit: 0, credit: amt });

test('opening balance with no transactions carries straight to closing', () => {
  const s = buildStatement({ openingBalance: 5000, txns: [] });
  assert.equal(s.opening, 5000);
  assert.equal(s.closing, 5000);
  assert.equal(s.rows.length, 0);
});

test('invoices debit and receipts credit the running balance', () => {
  const s = buildStatement({ openingBalance: 0, txns: [inv('2026-01-05', 'INV-1', 11800), rcpt('2026-01-10', 'RCPT-1', 5000)] });
  assert.equal(s.rows[0].balance, 11800);
  assert.equal(s.rows[1].balance, 6800);
  assert.equal(s.totalDebit, 11800);
  assert.equal(s.totalCredit, 5000);
  assert.equal(s.closing, 6800);
});

test('opening balance is the starting point of the running balance', () => {
  const s = buildStatement({ openingBalance: 2500, txns: [inv('2026-02-01', 'INV', 1000)] });
  assert.equal(s.opening, 2500);
  assert.equal(s.rows[0].balance, 3500);
  assert.equal(s.closing, 3500);
});

test('a date range folds earlier activity into the period opening balance', () => {
  const s = buildStatement({
    openingBalance: 500,
    txns: [inv('2025-12-20', 'OLD', 4000), inv('2026-01-15', 'NEW', 1000), rcpt('2026-01-20', 'RC', 2000)],
    from: '2026-01-01', to: '2026-01-31',
  });
  assert.equal(s.opening, 4500);        // 500 master + 4000 December invoice
  assert.equal(s.rows.length, 2);       // only January rows are listed
  assert.equal(s.rows[0].balance, 5500);
  assert.equal(s.rows[1].balance, 3500);
  assert.equal(s.totalDebit, 1000);
  assert.equal(s.totalCredit, 2000);
  assert.equal(s.closing, 3500);
});

test('a to-bound excludes later activity', () => {
  const s = buildStatement({ openingBalance: 0, txns: [inv('2026-01-10', 'A', 1000), inv('2026-03-10', 'B', 9999)], to: '2026-01-31' });
  assert.equal(s.rows.length, 1);
  assert.equal(s.closing, 1000);
});

test('rows are ordered by sortKey regardless of input order', () => {
  const s = buildStatement({ openingBalance: 0, txns: [rcpt('2026-01-20', 'R', 500), inv('2026-01-05', 'I', 1000)] });
  assert.equal(s.rows[0].ref, 'I');
  assert.equal(s.rows[1].ref, 'R');
});

test('a net-credit customer (receipts exceed debits) shows a negative balance', () => {
  const s = buildStatement({ openingBalance: 0, txns: [inv('2026-01-05', 'I', 1000), rcpt('2026-01-06', 'R', 1500)] });
  assert.equal(s.closing, -500);
});

test('balances round to paise', () => {
  const s = buildStatement({ openingBalance: 0, txns: [inv('2026-01-01', 'I', 100.126)] });
  assert.equal(s.closing, 100.13);
});
