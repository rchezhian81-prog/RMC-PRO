import { num } from './insights.util';

/**
 * Pure builders for India compliance payloads the Automation agent PREPARES for
 * approval (M5). They are deterministic transforms over an invoice — no I/O, no
 * external call. The actual transmission to the IRP / e-way portal is a live
 * integration held for deployment; these payloads are "ready-only".
 */

/** A camelCase invoice projection (as selected by the prepare tools). */
export interface InvoiceLike {
  invoiceNo: string;
  invoiceDate: string | null;
  totalAmount: unknown;
  taxableAmount: unknown;
  cgstAmount: unknown;
  sgstAmount: unknown;
  igstAmount: unknown;
  cessAmount: unknown;
  placeOfSupply?: string | null;
  gstin?: string | null;
  distanceKm?: number | null;
  transportMode?: string | null;
  vehicleNo?: string | null;
}

/** e-way bill validity: 1 day per 200 km (regular cargo), minimum 1 day. */
export function ewayValidityDays(distanceKm: number | null | undefined): number {
  const km = num(distanceKm);
  return km > 0 ? Math.max(1, Math.ceil(km / 200)) : 1;
}

/**
 * Whether an IRN's invoice ALSO warrants an e-way bill — the signal that lets the
 * preparer flag Path A (generate both in one IRP call). A hint only: it uses the
 * consignment value (> threshold) and that goods actually move (distance > 0);
 * the execution service re-runs the full EWB pre-flight and embeds EwbDtls only
 * if that passes, so an over-eager hint never mis-files an e-way.
 */
export function invoiceNeedsEway(inv: InvoiceLike, threshold = 50_000): boolean {
  return num(inv.totalAmount) > threshold && num(inv.distanceKm) > 0;
}

/** Build the India e-invoice (INV-01 subset) payload for IRN generation. */
export function buildEinvoicePayload(inv: InvoiceLike): Record<string, unknown> {
  const includeEway = invoiceNeedsEway(inv);
  return {
    schema: 'INV-01',
    docType: 'INV',
    docNo: inv.invoiceNo,
    docDate: inv.invoiceDate,
    placeOfSupply: inv.placeOfSupply ?? null,
    buyerGstin: inv.gstin ?? null,
    taxableAmount: num(inv.taxableAmount),
    cgst: num(inv.cgstAmount),
    sgst: num(inv.sgstAmount),
    igst: num(inv.igstAmount),
    cess: num(inv.cessAmount),
    totalAmount: num(inv.totalAmount),
    // Path A: generate the e-way in the SAME IRN call when this B2B dispatch also
    // needs one. Read by the execution service (gst-execution.service), which
    // re-validates the EWB pre-flight before actually including EwbDtls.
    includeEway,
    note: includeEway
      ? 'READY-ONLY: IRN + e-way in one call (Path A) — transmission held for deployment'
      : 'READY-ONLY: no IRP/IRN call — transmission held for deployment',
  };
}

/** Build the India e-way-bill payload (Part-A shape) with computed validity. */
export function buildEwayPayload(inv: InvoiceLike): Record<string, unknown> {
  return {
    docNo: inv.invoiceNo,
    docDate: inv.invoiceDate,
    consignmentValue: num(inv.totalAmount),
    distanceKm: inv.distanceKm ?? null,
    validityDays: ewayValidityDays(inv.distanceKm),
    transportMode: inv.transportMode ?? null,
    vehicleNo: inv.vehicleNo ?? null,
    note: 'READY-ONLY: Part-A/Part-B not transmitted — held for deployment',
  };
}
