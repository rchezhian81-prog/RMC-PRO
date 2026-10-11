import type { EntityManager } from 'typeorm';
import { UomConversion } from '../core/database/entities';
import { convertUom, reachableUoms, type UomConversionRow } from '../masters/uom.util';

/**
 * A quantity keyed in a unit other than the material's own.
 *
 * Stock, receipts and the 3-way match all count in the material's UOM, but
 * the gate and the buyer key what the challan or the quote says: cement in
 * bags where stock is in tonnes, admixture in cans where stock is in litres.
 * The keyed unit and figure are kept as entered, and the quantity is
 * converted through the tenant's `uom_conversions` (either direction, chained)
 * into the material's UOM. A unit with no conversion path is refused rather
 * than guessed — the same rule the weighbridge conversion follows.
 *
 * Pure (no DB) so the arithmetic is unit-testable; `uomConversionRows` is the
 * one-line loader the services share.
 */

const round3 = (n: number): number => Math.round((Number(n) || 0) * 1000) / 1000;

export interface EnteredQuantityInput {
  /** Quantity already in the material's UOM (the plain form). */
  quantity?: unknown;
  /** Unit the figure was keyed in, when not the material's own. */
  enteredUom?: unknown;
  /** The figure as keyed in `enteredUom`. Falls back to `quantity`. */
  enteredQuantity?: unknown;
}

export type EnteredQuantityResult =
  | { ok: true; quantity: number; enteredUom: string | null; enteredQuantity: number | null }
  | { ok: false; reason: string };

/**
 * Resolve the quantity in the material's UOM. Without an entered unit (or
 * with the material's own) the plain quantity is used and nothing is stored
 * as "entered". With another unit, the figure is converted and both are kept.
 */
export function resolveEnteredQuantity(
  input: EnteredQuantityInput,
  materialUom: string | null | undefined,
  conversions: UomConversionRow[],
): EnteredQuantityResult {
  const enteredUom = String(input.enteredUom ?? '').trim();
  const own = String(materialUom ?? '').trim();
  const plain = Number(input.quantity ?? 0) || 0;
  if (!enteredUom || enteredUom === own) {
    return { ok: true, quantity: round3(plain), enteredUom: null, enteredQuantity: null };
  }
  const figure = input.enteredQuantity !== undefined && input.enteredQuantity !== null && input.enteredQuantity !== ''
    ? Number(input.enteredQuantity) || 0
    : plain;
  if (!own) return { ok: false, reason: `The material has no unit of its own, so a quantity in ${enteredUom} cannot be converted.` };
  const converted = convertUom(figure, enteredUom, own, conversions);
  if (converted == null) {
    return { ok: false, reason: `No conversion from ${enteredUom} to ${own} is set up. Add it under Masters → Unit conversions, or enter the quantity in ${own}.` };
  }
  return { ok: true, quantity: round3(converted), enteredUom, enteredQuantity: round3(figure) };
}

export { reachableUoms };

/** The tenant's conversion rows in the shape the pure helpers take. */
export async function uomConversionRows(m: EntityManager): Promise<UomConversionRow[]> {
  const rows = await m.getRepository(UomConversion).find();
  return rows.map((c) => ({ from: c.fromUom, to: c.toUom, factor: Number(c.factor) || 0 }));
}
