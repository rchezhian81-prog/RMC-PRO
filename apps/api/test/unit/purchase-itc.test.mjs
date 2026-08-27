/**
 * Unit tests for the ITC-register GST split (Tier 2C).
 *
 * deriveGstSplit turns a bill's stored total tax into the CGST/SGST (intra-state)
 * or IGST (inter-state) heads an ITC register needs, without storing extra
 * columns. The key invariant: cgst + sgst + igst === tax exactly.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGstSplit } from '../../dist/purchase/purchase.util.js';

test('intra-state splits the tax evenly into CGST + SGST', () => {
  const s = deriveGstSplit(1000, false);
  assert.equal(s.cgst, 500);
  assert.equal(s.sgst, 500);
  assert.equal(s.igst, 0);
});

test('inter-state is all IGST', () => {
  const s = deriveGstSplit(1000, true);
  assert.equal(s.igst, 1000);
  assert.equal(s.cgst, 0);
  assert.equal(s.sgst, 0);
});

test('half-rupee tax splits cleanly', () => {
  const s = deriveGstSplit(1001, false);
  assert.equal(s.cgst, 500.5);
  assert.equal(s.sgst, 500.5);
});

test('odd-paise tax: the heads still sum to the tax exactly', () => {
  const s = deriveGstSplit(10.01, false);
  assert.ok(Math.abs(s.cgst + s.sgst - 10.01) < 1e-9);
  assert.equal(s.igst, 0);
});

test('zero tax splits to zero', () => {
  const s = deriveGstSplit(0, false);
  assert.deepEqual(s, { cgst: 0, sgst: 0, igst: 0 });
});
