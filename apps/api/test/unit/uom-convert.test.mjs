/**
 * Unit tests for the UOM conversion helper (Plan A1) — direct, inverse and
 * transitive conversions over a tenant's pairwise conversion rows.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first
 * (the test turbo task depends on build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertUom } from '../../dist/masters/uom.util.js';

const rows = [
  { from: 'm3', to: 'L', factor: 1000 }, // 1 m³ = 1000 L
  { from: 'L', to: 'mL', factor: 1000 }, // 1 L  = 1000 mL
  { from: 'MT', to: 'kg', factor: 1000 }, // 1 MT = 1000 kg
];

test('same unit returns the value unchanged', () => {
  assert.equal(convertUom(5, 'm3', 'm3', rows), 5);
});

test('direct conversion applies the factor', () => {
  assert.equal(convertUom(2, 'm3', 'L', rows), 2000);
  assert.equal(convertUom(3, 'MT', 'kg', rows), 3000);
});

test('inverse conversion applies 1/factor', () => {
  assert.equal(convertUom(2000, 'L', 'm3', rows), 2);
  assert.equal(convertUom(500, 'kg', 'MT', rows), 0.5);
});

test('transitive conversion chains factors along the shortest path', () => {
  assert.equal(convertUom(1, 'm3', 'mL', rows), 1_000_000);
  assert.equal(convertUom(2_000_000, 'mL', 'm3', rows), 2);
});

test('no path across unrelated categories returns null', () => {
  assert.equal(convertUom(1, 'kg', 'L', rows), null); // mass vs volume — never defined
  assert.equal(convertUom(1, 'm3', 'furlong', rows), null);
});

test('non-positive or non-finite factors are ignored (no bogus edge)', () => {
  assert.equal(convertUom(1, 'a', 'b', [{ from: 'a', to: 'b', factor: 0 }]), null);
  assert.equal(convertUom(1, 'a', 'b', [{ from: 'a', to: 'b', factor: Number.NaN }]), null);
});
