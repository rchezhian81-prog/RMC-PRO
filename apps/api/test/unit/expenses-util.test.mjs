/**
 * Unit tests for the Expense-capture helpers (Plan D4): voucher totalling and
 * the cost-allocation / category roll-ups (spend by cost object and by head).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  voucherTotal,
  allocationSummary,
  categorySummary,
} from '../../dist/expenses/expenses.util.js';

// ---- voucherTotal ----
test('voucher total sums line amounts to paise', () => {
  assert.equal(voucherTotal([{ amount: 1200.5 }, { amount: 300.25 }, { amount: 99.25 }]), 1600);
});

test('voucher total of no lines is zero', () => {
  assert.equal(voucherTotal([]), 0);
});

test('voucher total coerces string amounts', () => {
  assert.equal(voucherTotal([{ amount: '500.00' }, { amount: '250.50' }]), 750.5);
});

// ---- allocationSummary ----
test('allocation summary rolls lines up by cost object with shares', () => {
  const r = allocationSummary([
    { allocationType: 'vehicle', allocationLabel: 'TN01AB1234', amount: 3000 },
    { allocationType: 'vehicle', allocationLabel: 'TN01AB1234', amount: 1000 },
    { allocationType: 'plant', allocationLabel: 'Plant A', amount: 6000 },
  ]);
  assert.equal(r.total, 10000);
  assert.equal(r.buckets.length, 2);
  // sorted by amount desc → plant first
  assert.equal(r.buckets[0].label, 'Plant A');
  assert.equal(r.buckets[0].amount, 6000);
  assert.equal(r.buckets[0].share, 60);
  const veh = r.buckets.find((b) => b.type === 'vehicle');
  assert.equal(veh.amount, 4000); // 3000 + 1000 merged
  assert.equal(veh.share, 40);
});

test('a line with no allocation falls into a single general bucket', () => {
  const r = allocationSummary([
    { allocationType: 'general', amount: 500 },
    { amount: 250 }, // no type/label at all
  ]);
  assert.equal(r.buckets.length, 1);
  assert.equal(r.buckets[0].type, 'general');
  assert.equal(r.buckets[0].amount, 750);
  assert.equal(r.buckets[0].share, 100);
});

test('same label under different cost types stays in separate buckets', () => {
  const r = allocationSummary([
    { allocationType: 'plant', allocationLabel: 'North', amount: 100 },
    { allocationType: 'site', allocationLabel: 'North', amount: 100 },
  ]);
  assert.equal(r.buckets.length, 2);
});

test('allocation summary of nothing is a zero total with no buckets', () => {
  const r = allocationSummary([]);
  assert.equal(r.total, 0);
  assert.equal(r.buckets.length, 0);
});

// ---- categorySummary ----
test('category summary groups by the chosen label accessor', () => {
  const r = categorySummary(
    [
      { expenseHeadLabel: 'Diesel', amount: 5000 },
      { expenseHeadLabel: 'Driver Bata', amount: 2000 },
      { expenseHeadLabel: 'Diesel', amount: 3000 },
    ],
    (l) => l.expenseHeadLabel,
  );
  assert.equal(r.total, 10000);
  assert.equal(r.buckets[0].label, 'Diesel');
  assert.equal(r.buckets[0].amount, 8000);
  assert.equal(r.buckets[0].share, 80);
});

test('category summary buckets a missing label as Uncategorised', () => {
  const r = categorySummary([{ amount: 100 }], (l) => l.expenseHeadLabel);
  assert.equal(r.buckets[0].label, 'Uncategorised');
});
