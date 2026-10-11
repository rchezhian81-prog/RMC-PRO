import { round2, roundTo } from '../common/money.util';

/**
 * Purchase / AP-lite helpers (Plan D2). Pure arithmetic — the 3-way match
 * (PO ↔ GRN ↔ bill), a purchase order's receipt roll-up, and a vendor bill's
 * payment status — kept DB-free so each is unit-testable in isolation.
 */
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

export interface PurchaseLineInput {
  /** Quantity in the material's own UOM. */
  quantity: number;
  /** Rate per unit, before discount. */
  rate: number;
  /** GST on the discounted taxable value, as a percentage. */
  gstRate: number;
  /** Trade discount off the rate, as a percentage (0–100). */
  discountPct?: number;
}

export interface PurchaseLineAmounts {
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
}

/** True for a discount a line can carry: a finite percentage from 0 to 100. */
export function isValidDiscountPct(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * One purchase line's money: taxable = qty × rate × (1 − discount%/100),
 * tax on the taxable, and the line total. Rounded to the paise at each step
 * so the stored columns add up exactly.
 */
export function purchaseLineAmounts(line: PurchaseLineInput): PurchaseLineAmounts {
  const quantity = Number(line.quantity) || 0;
  const rate = round2(line.rate);
  const discountPct = Number(line.discountPct) || 0;
  const gstRate = round2(line.gstRate);
  const taxableAmount = round2(quantity * rate * (1 - discountPct / 100));
  const taxAmount = round2((taxableAmount * gstRate) / 100);
  return { taxableAmount, taxAmount, lineTotal: round2(taxableAmount + taxAmount) };
}

export interface PurchaseTotals {
  taxableAmount: number;
  taxAmount: number;
  /** Signed paise that take taxable + tax to the nearest whole rupee. */
  roundOff: number;
  /** A whole-rupee figure: taxable + tax + roundOff. */
  totalAmount: number;
}

/**
 * Fold the lines into the document's totals, rounding the grand total to
 * the nearest rupee (half away from zero, like a tax invoice) and keeping the
 * signed difference as the round-off.
 */
export function purchaseTotals(lines: PurchaseLineAmounts[]): PurchaseTotals {
  let taxableAmount = 0;
  let taxAmount = 0;
  for (const l of lines) {
    taxableAmount = round2(taxableAmount + l.taxableAmount);
    taxAmount = round2(taxAmount + l.taxAmount);
  }
  const grand = round2(taxableAmount + taxAmount);
  const totalAmount = roundTo(grand, 0);
  return { taxableAmount, taxAmount, roundOff: round2(totalAmount - grand), totalAmount };
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
 * are needed. CGST and SGST are each the rounded half — GST requires the two to
 * be equal (GSTR-2B/3B reconcile on equal halves) — so when the total tax has an
 * odd number of paise their sum is the tax plus one paise: the accepted trade-off
 * for exact-equal halves, not one half and "the remainder".
 */
export function deriveGstSplit(taxAmount: number, interstate: boolean): { cgst: number; sgst: number; igst: number } {
  const tax = round2(Number(taxAmount) || 0);
  if (interstate) return { cgst: 0, sgst: 0, igst: tax };
  // GST requires CGST to equal SGST exactly (GSTR-2B/3B reconcile on equal
  // halves), so both are the rounded half — not one half and "the remainder",
  // which differ by a paise when the total tax has an odd number of paise.
  const half = round2(tax / 2);
  return { cgst: half, sgst: half, igst: 0 };
}
