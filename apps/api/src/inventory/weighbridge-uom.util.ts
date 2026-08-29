import { convertUom, type UomConversionRow } from '../masters/uom.util';

/**
 * A weighbridge always weighs in kilograms, but materials are stocked in their
 * own UOM — bulk aggregate and cement are usually bought by the tonne. Recording
 * the raw kg against a tonne UOM overstates stock 1000×, so a weighbridge net
 * weight must be converted to the material's UOM before it becomes an inward.
 *
 * Kept pure (no DB) so the arithmetic is unit-testable.
 */

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Kilograms in one unit of a recognised mass UOM (keys are lower-cased). */
const KG_PER_UNIT: Record<string, number> = {
  kg: 1, kgs: 1, kilogram: 1, kilograms: 1,
  g: 0.001, gram: 0.001, grams: 0.001,
  t: 1000, mt: 1000, ton: 1000, tons: 1000, tonne: 1000, tonnes: 1000,
  q: 100, qtl: 100, quintal: 100, quintals: 100,
  lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237,
};

/**
 * Convert a weighbridge net weight (kilograms) to the material's stocking UOM.
 *
 * Resolution order: a recognised mass unit (kg / t / MT / g / quintal / lb) is
 * converted with the fixed mass table — this is the common 1000× tonne case and
 * is deterministic; otherwise a tenant `uom_conversions` path from kg is used
 * (e.g. a locally defined kg↔bag factor); if neither resolves (no UOM, or a
 * weight→count/volume conversion that needs data we don't have), the kg figure
 * is returned unchanged rather than inventing a number.
 */
export function weighbridgeQuantity(
  netKg: number,
  uom: string | null | undefined,
  conversions: UomConversionRow[] = [],
): number {
  const code = (uom ?? '').trim();
  if (!code) return round3(netKg);

  const kgPer = KG_PER_UNIT[code.toLowerCase()];
  if (kgPer) return round3(netKg / kgPer);

  const viaRows = convertUom(netKg, 'kg', code, conversions) ?? convertUom(netKg, 'KG', code, conversions);
  if (viaRows != null) return round3(viaRows);

  return round3(netKg);
}
