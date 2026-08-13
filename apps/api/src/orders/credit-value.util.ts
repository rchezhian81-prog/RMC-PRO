/**
 * The value a customer actually owes, for credit exposure.
 *
 * GST-inclusive when known (`estimated_order_value_incl_gst`), else the legacy
 * ex-GST `estimated_order_value` for rows created before the incl-GST column
 * existed. This is the single source of truth for the requested-amount side of
 * a credit check; the outstanding-sum side mirrors it in SQL with
 * COALESCE(estimated_order_value_incl_gst, estimated_order_value).
 *
 * Pure (no NestJS/DB deps) so it compiles to dist and is unit-testable.
 */
export function creditExposureValue(
  inclGst: string | number | null | undefined,
  exGst: string | number | null | undefined,
): number {
  const incl = Number(inclGst ?? NaN);
  if (Number.isFinite(incl)) return incl;
  return Number(exGst ?? 0) || 0;
}
