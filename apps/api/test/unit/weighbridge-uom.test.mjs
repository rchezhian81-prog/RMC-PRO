/**
 * Unit tests for weighbridgeQuantity (Tier 4C).
 *
 * A weighbridge weighs in kilograms; the material inward must carry the
 * material's stocking UOM. Booking raw kg against a tonne UOM overstates stock
 * 1000×, so the net weight is converted first.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weighbridgeQuantity } from '../../dist/inventory/weighbridge-uom.util.js';

test('converts kg → tonne for the common UOMs (the 1000× fix)', () => {
  assert.equal(weighbridgeQuantity(25000, 'MT'), 25);
  assert.equal(weighbridgeQuantity(25000, 't'), 25);
  assert.equal(weighbridgeQuantity(25000, 'tonne'), 25);
  assert.equal(weighbridgeQuantity(25000, 'Tonnes'), 25); // case-insensitive
  assert.equal(weighbridgeQuantity(12500, 'MT'), 12.5);
});

test('keeps the figure when the material is stocked in kg', () => {
  assert.equal(weighbridgeQuantity(25000, 'kg'), 25000);
  assert.equal(weighbridgeQuantity(25000, 'KG'), 25000);
});

test('handles other mass units (gram, quintal, pound)', () => {
  assert.equal(weighbridgeQuantity(5, 'g'), 5000); // 5 kg = 5000 g
  assert.equal(weighbridgeQuantity(2500, 'quintal'), 25); // 2500 kg = 25 q
  assert.equal(weighbridgeQuantity(45.359237, 'lb'), 100);
});

test('falls back to a tenant kg→UOM conversion for non-mass units', () => {
  // 1 kg = 0.02 bag (a 50 kg bag) → 500 kg = 10 bags.
  const rows = [{ from: 'kg', to: 'BAG', factor: 0.02 }];
  assert.equal(weighbridgeQuantity(500, 'BAG', rows), 10);
});

test('returns the kg figure unchanged when nothing resolves', () => {
  assert.equal(weighbridgeQuantity(500, null), 500);
  assert.equal(weighbridgeQuantity(500, ''), 500);
  assert.equal(weighbridgeQuantity(500, 'M3'), 500); // no path, no invented number
});
