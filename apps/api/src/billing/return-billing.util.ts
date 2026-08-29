/**
 * Returned-concrete billing policy (Tier 5B). When a delivery challan comes back
 * with returned m³ (short pour / rejected at site), the order decides how the
 * customer is billed:
 *
 *   net           bill the poured quantity only (gross − returned); the return
 *                 is the plant's wastage. Default.
 *   gross         bill the full loaded quantity regardless of return (the
 *                 customer ordered it).
 *   net_plus_fee  bill the poured quantity, plus a return / short-load charge of
 *                 feePerM3 × returned m³ (a separate invoice line).
 *
 * Pure and DB-free so the arithmetic is unit-testable.
 */
export const RETURN_BILLING_POLICIES = ['net', 'gross', 'net_plus_fee'] as const;
export type ReturnBillingPolicy = (typeof RETURN_BILLING_POLICIES)[number];

export function isReturnBillingPolicy(v: unknown): v is ReturnBillingPolicy {
  return typeof v === 'string' && (RETURN_BILLING_POLICIES as readonly string[]).includes(v);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const numv = (v: unknown): number => Number(v ?? 0) || 0;

export interface ReturnBillingResult {
  /** m³ to bill on the main concrete line. */
  billedQuantity: number;
  /** Returned m³ (clamped to the gross), for display and the fee line. */
  returnedQuantity: number;
  /** Return / short-load charge (₹); 0 unless the policy is net_plus_fee. */
  returnFee: number;
}

/**
 * Resolve the billed quantity and any return fee for one challan under a policy.
 * Returned m³ is clamped to the gross so a mis-keyed return never bills negative.
 */
export function resolveReturnBilling(
  grossQuantity: unknown,
  returnedQuantity: unknown,
  policy: ReturnBillingPolicy = 'net',
  feePerM3: unknown = 0,
): ReturnBillingResult {
  const gross = round3(Math.max(0, numv(grossQuantity)));
  const returned = round3(Math.min(gross, Math.max(0, numv(returnedQuantity))));
  const net = round3(gross - returned);

  if (policy === 'gross') {
    return { billedQuantity: gross, returnedQuantity: returned, returnFee: 0 };
  }
  if (policy === 'net_plus_fee') {
    return { billedQuantity: net, returnedQuantity: returned, returnFee: round2(returned * numv(feePerM3)) };
  }
  // 'net' (default)
  return { billedQuantity: net, returnedQuantity: returned, returnFee: 0 };
}
