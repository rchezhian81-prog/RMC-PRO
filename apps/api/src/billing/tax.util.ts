import { gstStateCode } from '../compliance/gst-payload.util';
import { estimateLineValue } from '@rmc/shared';

import { round2 } from '../common/money.util';

export { round2 };

export interface LineTax {
  taxableAmount: number;
  cgstRate: number; cgstAmount: number;
  sgstRate: number; sgstAmount: number;
  igstRate: number; igstAmount: number;
  cessRate: number; cessAmount: number;
  lineTotal: number;
}

/**
 * Split a GST rate over a pre-computed taxable amount (Doc 10 tax rules).
 * Intra-state splits into CGST + SGST; inter-state uses IGST. This is the single
 * source of truth so a quotation, an order and its invoice all reconcile.
 */
export function computeGstOnTaxable(
  taxable: number,
  gstRate: number,
  cessRate: number,
  isInterstate: boolean,
): LineTax {
  const taxableAmount = round2(taxable);
  const cessAmount = round2((taxableAmount * cessRate) / 100);
  let cgstRate = 0, sgstRate = 0, igstRate = 0, cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
  if (isInterstate) {
    igstRate = gstRate;
    igstAmount = round2((taxableAmount * gstRate) / 100);
  } else {
    cgstRate = sgstRate = gstRate / 2;
    cgstAmount = round2((taxableAmount * (gstRate / 2)) / 100);
    sgstAmount = cgstAmount;
  }
  const lineTotal = round2(taxableAmount + cgstAmount + sgstAmount + igstAmount + cessAmount);
  return { taxableAmount, cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate, igstAmount, cessRate, cessAmount, lineTotal };
}

/**
 * GST computation for an invoice line — the taxable base is `quantity * rate`.
 */
export function computeLineTax(
  quantity: number,
  rate: number,
  gstRate: number,
  cessRate: number,
  isInterstate: boolean,
): LineTax {
  return computeGstOnTaxable(round2(quantity * rate), gstRate, cessRate, isInterstate);
}

/** A quotation/order line: freight (transport/pump/waiting) is part of the taxable base. */
export interface QuoteLine {
  quantity: number;
  rate: number;
  transport?: number;
  pump?: number;
  waiting?: number;
  /** The basis of each charge (per_m3 when absent — see @rmc/shared charge-basis). */
  transportBasis?: string | null;
  pumpBasis?: string | null;
  waitingBasis?: string | null;
  /** Truck load for a per-trip transport estimate; the shared default when absent. */
  truckM3?: number;
  gstRate: number;
  /** false → the line is treated as GST-exempt (rate 0). */
  gstApplicable?: boolean;
}

export interface TaxSummary {
  isInterstate: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

/**
 * Sum the GST across quotation/order lines. Each line's taxable base is its
 * estimated value under the charge bases — quantity × (rate + transport +
 * pump + waiting) when every charge is per m³, else the concrete plus each
 * charge counted the way its basis says — so the freight charges are taxed
 * consistently and the total reconciles with the eventual invoice.
 */
export function summariseGst(lines: QuoteLine[], isInterstate: boolean): TaxSummary {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0, total = 0;
  for (const l of lines) {
    const base = round2(estimateLineValue({
      qty: l.quantity, rate: l.rate,
      transport: l.transport ?? 0, transportBasis: l.transportBasis,
      pump: l.pump ?? 0, pumpBasis: l.pumpBasis,
      waiting: l.waiting ?? 0, waitingBasis: l.waitingBasis,
      truckM3: l.truckM3,
    }));
    const rate = l.gstApplicable === false ? 0 : l.gstRate;
    const t = computeGstOnTaxable(base, rate, 0, isInterstate);
    taxable += t.taxableAmount;
    cgst += t.cgstAmount;
    sgst += t.sgstAmount;
    igst += t.igstAmount;
    total += t.lineTotal;
  }
  return {
    isInterstate,
    taxable: round2(taxable),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    cess: 0,
    total: round2(total),
  };
}

/** Inter-state when buyer and seller states differ (case/space-insensitive). */
export function isInterstateSupply(sellerState?: string | null, buyerState?: string | null): boolean {
  // Classify on the resolved 2-digit GST state CODE, not the raw name. Comparing
  // names flips an intra-state supply to IGST whenever the two sides spell the
  // same state differently — "Odisha"/"Orissa", "Tamil Nadu"/"Tamilnadu",
  // "Uttarakhand"/"Uttaranchal", "Chhattisgarh"/"Chattisgarh" — all of which
  // resolve to the same code. If either state can't be resolved to a code, fall
  // back to a name compare rather than guessing.
  const a = gstStateCode(sellerState);
  const b = gstStateCode(buyerState);
  if (a && b) return a !== b;
  const an = (sellerState ?? '').trim().toLowerCase();
  const bn = (buyerState ?? '').trim().toLowerCase();
  return an !== '' && bn !== '' && an !== bn;
}
