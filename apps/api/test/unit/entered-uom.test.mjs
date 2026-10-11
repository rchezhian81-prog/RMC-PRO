/**
 * Unit tests for a quantity keyed in another unit (bags for a tonne material)
 * on a purchase-order or inward line: converted through the tenant's
 * conversion rows, kept as entered, refused when no path exists. Also the
 * list of units a line may offer.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnteredQuantity, reachableUoms } from '../../dist/inventory/entered-uom.util.js';

const rows = [
  { from: 'MT', to: 'kg', factor: 1000 }, // 1 MT = 1000 kg
  { from: 'BAG', to: 'kg', factor: 50 }, // 1 bag = 50 kg
  { from: 'm3', to: 'L', factor: 1000 }, // unrelated category
];

test('the plain quantity (no entered unit) is used as is and nothing is stored as entered', () => {
  assert.deepEqual(resolveEnteredQuantity({ quantity: 12.5 }, 'MT', rows), { ok: true, quantity: 12.5, enteredUom: null, enteredQuantity: null });
});

test("the material's own unit is the plain case too", () => {
  assert.deepEqual(resolveEnteredQuantity({ quantity: 4, enteredUom: 'MT', enteredQuantity: 4 }, 'MT', rows), { ok: true, quantity: 4, enteredUom: null, enteredQuantity: null });
});

test('bags convert to tonnes through kg, and both figures are kept', () => {
  // 30 bags × 50 kg = 1500 kg = 1.5 MT.
  assert.deepEqual(resolveEnteredQuantity({ enteredUom: 'BAG', enteredQuantity: 30 }, 'MT', rows), { ok: true, quantity: 1.5, enteredUom: 'BAG', enteredQuantity: 30 });
});

test('the keyed figure falls back to `quantity` when enteredQuantity is absent', () => {
  assert.deepEqual(resolveEnteredQuantity({ quantity: 40, enteredUom: 'BAG' }, 'MT', rows), { ok: true, quantity: 2, enteredUom: 'BAG', enteredQuantity: 40 });
});

test('the converted quantity is rounded to three decimals', () => {
  // 7 kg = 0.007 MT; 1 kg = 0.001 MT; 1 bag of 50 kg to m3 has no path.
  assert.equal(resolveEnteredQuantity({ enteredUom: 'kg', enteredQuantity: 7 }, 'MT', rows).quantity, 0.007);
});

test('a unit with no conversion path is refused, not guessed', () => {
  const r = resolveEnteredQuantity({ enteredUom: 'DRUM', enteredQuantity: 3 }, 'MT', rows);
  assert.equal(r.ok, false);
  assert.match(r.reason, /No conversion from DRUM to MT/);
  const cross = resolveEnteredQuantity({ enteredUom: 'L', enteredQuantity: 3 }, 'MT', rows);
  assert.equal(cross.ok, false);
});

test('a material without a unit cannot take a converted quantity', () => {
  const r = resolveEnteredQuantity({ enteredUom: 'BAG', enteredQuantity: 3 }, null, rows);
  assert.equal(r.ok, false);
});

test('reachableUoms lists the own unit first, then every unit a conversion reaches, either direction', () => {
  assert.deepEqual(reachableUoms('MT', rows), ['MT', 'kg', 'BAG']);
  assert.deepEqual(reachableUoms('BAG', rows), ['BAG', 'kg', 'MT']);
  assert.deepEqual(reachableUoms('L', rows), ['L', 'm3']);
  assert.deepEqual(reachableUoms('NOS', rows), ['NOS']);
  assert.deepEqual(reachableUoms('', rows), []);
  assert.deepEqual(reachableUoms(null, rows), []);
});

test('reachableUoms ignores rows with a bad factor', () => {
  assert.deepEqual(reachableUoms('MT', [{ from: 'MT', to: 'kg', factor: 0 }, { from: 'MT', to: 'BAG', factor: 20 }]), ['MT', 'BAG']);
});
