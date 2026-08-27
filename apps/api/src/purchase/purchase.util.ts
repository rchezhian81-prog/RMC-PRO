/**
 * Purchase / AP-lite helpers (Plan D2). Pure arithmetic — the 3-way match
 * (PO ↔ GRN ↔ bill), a purchase order's receipt roll-up, and a vendor bill's
 * payment status — kept DB-free so each is unit-testable in isolation.
 */
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const round3 = (v: number): number => Math.round((Number(v) || 0) * 1000) / 1000;

/**
 * Receipt status of a purchase order from its lines' ordered vs received
 * quantities: `received` once every line is fully received, `partially_received`
 * if some quantity has come in, else `not_received`.
 */
export function poReceiptStatus(lines: Array<{ ordered: number; received: number }>): 'not_received' | 'partially_received' | 'received' {
  if (!lines.length) return 'not_received';
  let anyReceived = false;
  let allReceived = true;
  for (const l of lines) {
    const ordered = round3(l.ordered);
    const received = round3(l.received);
    if (received > 0.0005) anyReceived = true;
    if (received + 0.0005 < ordered) allReceived = false;
  }
  if (allReceived) return 'received';
  return anyReceived ? 'partially_received' : 'not_received';
}

export interface MatchLineInput {
  /** Quantity on the vendor's bill line. */
  billedQty: number;
  /** Rate on the vendor's bill line. */
  billedRate: number;
  /** Rate agreed on the purchase order for this material/line. */
  orderedRate: number;
  /** Quantity accepted on goods receipt(s) for this material/line. */
  acceptedQty: number;
}

export interface MatchLineResult {
  /** Billed quantity does not exceed what was accepted (within tolerance). */
  qtyOk: boolean;
  /** Billed rate is within tolerance of the ordered rate. */
  priceOk: boolean;
  /** How much the billed quantity exceeds the accepted quantity (0 if none). */
  qtyExcess: number;
  /** Signed rate variance as a % of the ordered rate (0 when no PO rate). */
  priceVariancePct: number;
}

/**
 * 3-way match for one line: you should not be billed for more than was
 * received, nor at a rate that drifts from the PO. `tolerancePct` (default 2%)
 * absorbs rounding and agreed minor variance. When there is no PO rate to
 * compare against, the price is not flagged.
 */
export function matchLine(input: MatchLineInput, tolerancePct = 2): MatchLineResult {
  const billedQty = round3(input.billedQty);
  const acceptedQty = round3(input.acceptedQty);
  const billedRate = round2(input.billedRate);
  const orderedRate = round2(input.orderedRate);
  const tol = Math.max(0, tolerancePct) / 100;

  const qtyAllowed = acceptedQty * (1 + tol);
  const qtyOk = billedQty <= qtyAllowed + 0.0005;
  const qtyExcess = billedQty > acceptedQty ? round3(billedQty - acceptedQty) : 0;

  let priceOk = true;
  let priceVariancePct = 0;
  if (orderedRate > 0.0001) {
    priceVariancePct = round2(((billedRate - orderedRate) / orderedRate) * 100);
    priceOk = Math.abs(billedRate - orderedRate) <= orderedRate * tol + 0.001;
  }

  return { qtyOk, priceOk, qtyExcess, priceVariancePct };
}

export interface MatchSummary {
  status: 'matched' | 'over_tolerance';
  qtyOk: boolean;
  priceOk: boolean;
  lines: MatchLineResult[];
}

/**
 * Fold per-line matches into an overall verdict: `matched` only when every
 * line's quantity and price are within tolerance, else `over_tolerance`.
 * (A bill with no PO to match against is `unmatched` — decided by the caller,
 * not here, since this helper works purely from the compared lines.)
 */
export function summariseMatch(inputs: MatchLineInput[], tolerancePct = 2): MatchSummary {
  const lines = inputs.map((i) => matchLine(i, tolerancePct));
  const qtyOk = lines.every((l) => l.qtyOk);
  const priceOk = lines.every((l) => l.priceOk);
  return { status: qtyOk && priceOk ? 'matched' : 'over_tolerance', qtyOk, priceOk, lines };
}

/** Payment status of a vendor bill given its total and paid amounts. */
export function billPaymentStatus(total: number, paid: number): 'unpaid' | 'partially_paid' | 'paid' {
  const outstanding = round2(round2(total) - round2(paid));
  if (outstanding <= 0.001) return 'paid';
  return round2(paid) > 0.001 ? 'partially_paid' : 'unpaid';
}

/**
 * Split a bill's total GST into the heads an ITC register needs: CGST + SGST for
 * an intra-state purchase, or IGST for an inter-state one. Derived from the
 * stored tax amount and the supplier-vs-buyer state test, so no extra columns
 * are needed; SGST takes the rounding remainder so cgst + sgst === tax exactly.
 */
export function deriveGstSplit(taxAmount: number, interstate: boolean): { cgst: number; sgst: number; igst: number } {
  const tax = round2(Number(taxAmount) || 0);
  if (interstate) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = round2(tax / 2);
  return { cgst, sgst: round2(tax - cgst), igst: 0 };
}
