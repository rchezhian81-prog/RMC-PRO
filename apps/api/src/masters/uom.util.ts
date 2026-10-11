/**
 * Unit conversion over a tenant's `uom_conversions` rows (Plan A1). Each row
 * reads "1 `from` = `factor` × `to`"; conversions are bidirectional (the inverse
 * is `1/factor`) and chain transitively, so defining every unit against one base
 * makes any pair in that category convertible.
 *
 * The implementation lives in `@rmc/shared` so the web offers exactly the
 * units the API will accept on a purchase-order or inward line; this module
 * keeps the API's import path (and the unit test's) stable.
 */
export { convertUom, reachableUoms, type UomConversionRow } from '@rmc/shared';
