/**
 * Unit tests for resolveReturnBilling (Tier 5B).
 *
 * A returned load is billed per the order's policy: net (poured only), gross
 * (full load), or net_plus_fee (poured + a return charge). Returned m³ is
 * clamped to the gross so a mis-key never bills negative.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReturnBilling, isReturnBillingPolicy } from '../../dist/billing/return-billing.util.js';

test('net (default): bills gross − returned, no fee', () => {
  const r = resolveReturnBilling(25, 3, 'net');
  assert.equal(r.billedQuantity, 22);
  assert.equal(r.returnedQuantity, 3);
  assert.equal(r.returnFee, 0);
});

test('defaults to net when no policy is given', () => {
  assert.equal(resolveReturnBilling(25, 3).billedQuantity, 22);
});

test('gross: bills the full load regardless of return', () => {
  const r = resolveReturnBilling(25, 3, 'gross');
  assert.equal(r.billedQuantity, 25);
  assert.equal(r.returnFee, 0);
});

test('net_plus_fee: bills net plus feePerM3 × returned', () => {
  const r = resolveReturnBilling(25, 3, 'net_plus_fee', 800);
  assert.equal(r.billedQuantity, 22);
  assert.equal(r.returnFee, 2400); // 3 × 800
});

test('clamps returned to the gross (never negative billed qty)', () => {
  const r = resolveReturnBilling(10, 15, 'net');
  assert.equal(r.returnedQuantity, 10);
  assert.equal(r.billedQuantity, 0);
});

test('no return → full quantity, no fee, under every policy', () => {
  for (const p of ['net', 'gross', 'net_plus_fee']) {
    const r = resolveReturnBilling(12.5, 0, p, 800);
    assert.equal(r.billedQuantity, 12.5);
    assert.equal(r.returnFee, 0);
  }
});

test('isReturnBillingPolicy guards the enum', () => {
  assert.equal(isReturnBillingPolicy('net'), true);
  assert.equal(isReturnBillingPolicy('gross'), true);
  assert.equal(isReturnBillingPolicy('net_plus_fee'), true);
  assert.equal(isReturnBillingPolicy('waive'), false);
  assert.equal(isReturnBillingPolicy(null), false);
});
