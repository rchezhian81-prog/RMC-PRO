/**
 * Unit tests for the credit-exposure value selection (pilot gap BUG 2).
 *
 * Exposure must be GST-inclusive when known, and fall back to the legacy ex-GST
 * value only for rows created before the incl-GST column existed.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditExposureValue } from '../../dist/orders/credit-value.util.js';

test('uses the GST-inclusive value when present', () => {
  // 50 m³ @ 4800 (rate+transport) + 18% GST = 283200; ex-GST would be 225300.
  assert.equal(creditExposureValue('283200.00', '225300.00'), 283200);
  assert.equal(creditExposureValue(283200, 225300), 283200);
});

test('falls back to the ex-GST value for legacy rows (null/undefined incl-GST)', () => {
  assert.equal(creditExposureValue(null, '225300.00'), 225300);
  assert.equal(creditExposureValue(undefined, 225300), 225300);
});

test('a genuine zero incl-GST value is respected (not treated as missing)', () => {
  assert.equal(creditExposureValue('0.00', '50'), 0);
  assert.equal(creditExposureValue(0, 50), 0);
});

test('missing both sides is a safe zero', () => {
  assert.equal(creditExposureValue(null, null), 0);
  assert.equal(creditExposureValue(undefined, undefined), 0);
});
