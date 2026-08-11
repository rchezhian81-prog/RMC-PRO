import type { EwbRequest, IrnRequest } from './gst.types';

/**
 * Pure builders + pre-flight validators for India GST transmission. No I/O — they
 * transform assembled invoice/seller/buyer projections into the INV-01 (e-invoice)
 * and EWB (e-way) request shapes, and fail fast on master-data problems BEFORE any
 * portal call is made. Deterministic, so they unit-test without a database.
 *
 * The exact minor schema version and mandatory-field set drift; confirm against
 * your GSP (see docs/deployment/INTEGRATION-RUNBOOK-01/02). These builders cover
 * the essential INV-01 v1.1 / EWB fields an RMC B2B dispatch needs.
 */

// ---- projections the execution service assembles from real rows ----

export interface SellerParty {
  gstin: string;
  legalName: string;
  tradeName?: string | null;
  address1: string;
  address2?: string | null;
  location: string;
  pincode: string;
  stateCode: string;
}

export interface BuyerParty {
  gstin?: string | null;
  legalName: string;
  posStateCode: string; // place-of-supply state code
  address1: string;
  location: string;
  pincode: string;
  stateCode: string;
}

export interface InvoiceHeader {
  docNo: string;
  docDate: string | null; // 'yyyy-mm-dd' from the DB
  docType?: 'INV' | 'CRN' | 'DBN'; // INV-01 DocDtls.Typ (invoice / credit note / debit note)
  supplyType?: string; // B2B | EXPWP | …
  reverseCharge?: boolean;
  /** True only for the rare intra-state supply charged as IGST (INV-01 IgstOnIntra). */
  igstOnIntra?: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  roundOff: number;
  total: number;
  distanceKm?: number | null;
  transportMode?: string | null; // 'road' | 'rail' | …
  vehicleNo?: string | null;
  transporterId?: string | null;
  transporterName?: string | null;
}

export interface InvoiceLine {
  slNo: number;
  hsn: string | null;
  qty: number;
  unit: string | null;
  unitPrice: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
  /** Goods vs service (INV-01 IsServc). RMC concrete is goods → default false. */
  isService?: boolean;
  /** Cess rate %; if absent it is derived from cess ÷ assessable value. */
  cessRate?: number | null;
  /** Optional product description (INV-01 PrdDesc). */
  description?: string | null;
}

// ---- helpers ----

export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** 15-char GSTIN: 2-digit state, 10-char PAN, entity digit, 'Z', checksum. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export function isGstin(g: string | null | undefined): boolean {
  return typeof g === 'string' && GSTIN_RE.test(g);
}
export function stateCodeOf(gstin: string): string {
  return gstin.slice(0, 2);
}
const HSN_RE = /^\d{4,8}$/; // HSN/SAC: 4–8 digits (6 required at higher AATO)
const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/i;

/** e-way validity: 1 day per 200 km (regular cargo), minimum 1 day. */
export function ewayValidityDays(distanceKm: number | null | undefined): number {
  const km = num(distanceKm);
  return km > 0 ? Math.max(1, Math.ceil(km / 200)) : 1;
}

/** 'yyyy-mm-dd' → 'dd/mm/yyyy' (the portal's date format). */
export function toPortalDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * INV-01 wants Pin as a 6-digit NUMBER, not a string. Returns the number for a
 * well-formed pincode, or undefined so JSON.stringify drops the field rather than
 * sending a malformed one (the portal then reports the missing mandatory field,
 * which is more actionable than a type rejection). Export/URP pincode handling is
 * a deploy concern — see the runbook.
 */
export function pinNum(pin: string | null | undefined): number | undefined {
  const s = String(pin ?? '').trim();
  return /^\d{6}$/.test(s) ? Number(s) : undefined;
}

export type PreflightResult = { ok: true } | { ok: false; errors: string[] };

/** Totals reconcile if component sum ≈ stated total (₹1 tolerance for rounding). */
function totalsReconcile(h: InvoiceHeader): boolean {
  const computed = h.taxable + h.cgst + h.sgst + h.igst + h.cess + h.roundOff;
  return Math.abs(computed - h.total) <= 1.0;
}

// ---- pre-flight validation (reject before any portal call) ----

export function validateIrnPreflight(
  h: InvoiceHeader,
  lines: InvoiceLine[],
  seller: SellerParty,
  buyer: BuyerParty,
): PreflightResult {
  const errors: string[] = [];
  if (!isGstin(seller.gstin)) errors.push('seller GSTIN is missing or malformed');
  if (buyer.gstin != null && buyer.gstin !== '' && !isGstin(buyer.gstin)) errors.push('buyer GSTIN is malformed');
  if (!buyer.posStateCode) errors.push('place of supply (state code) is missing');
  if (!h.docNo) errors.push('document number is missing');
  if (!h.docDate) errors.push('document date is missing');
  if (!lines.length) errors.push('invoice has no line items');
  for (const l of lines) {
    if (!l.hsn || !HSN_RE.test(l.hsn)) errors.push(`line ${l.slNo}: HSN/SAC missing or invalid`);
    if (num(l.qty) <= 0) errors.push(`line ${l.slNo}: quantity must be > 0`);
  }
  if (!totalsReconcile(h)) errors.push('invoice totals do not reconcile (taxable + tax + round-off ≠ total)');
  return errors.length ? { ok: false, errors } : { ok: true };
}

export interface EwbPreflightOptions {
  /** State-configurable consignment threshold; default ₹50,000. */
  thresholdValue?: number;
}

export function validateEwbPreflight(
  h: InvoiceHeader,
  seller: SellerParty,
  buyer: BuyerParty,
  opts: EwbPreflightOptions = {},
): PreflightResult {
  const errors: string[] = [];
  const threshold = opts.thresholdValue ?? 50_000;
  if (num(h.total) <= threshold) errors.push(`consignment value ₹${num(h.total)} is at/below the ₹${threshold} threshold`);
  if (!isGstin(seller.gstin)) errors.push('from (seller) GSTIN is missing or malformed');
  if (buyer.gstin != null && buyer.gstin !== '' && !isGstin(buyer.gstin)) errors.push('to (buyer) GSTIN is malformed');
  if (num(h.distanceKm) <= 0) errors.push('transport distance (km) is missing or ≤ 0');
  const mode = (h.transportMode ?? 'road').toLowerCase();
  if (mode === 'road') {
    const hasVehicle = h.vehicleNo && VEHICLE_RE.test(h.vehicleNo);
    if (!hasVehicle && !h.transporterId) errors.push('road transport needs a valid vehicle number or a transporter id (Part B)');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---- builders (assembled → portal request shapes) ----

const transModeCode: Record<string, string> = { road: '1', rail: '2', air: '3', ship: '4' };

/**
 * One INV-01 `ItemList` entry. NIC mandates `IsServc` (goods/service), a gross
 * `TotAmt` (Qty × UnitPrice, before discount) distinct from the assessable
 * `AssAmt`, and a cess RATE alongside the cess amount. `CesRt` is taken from the
 * line when given, else derived from cess ÷ assessable value (0 when no cess).
 */
function buildIrnItem(l: InvoiceLine): Record<string, unknown> {
  const qty = round2(num(l.qty));
  const unitPrice = round2(num(l.unitPrice));
  const assess = round2(num(l.taxable));
  const cesAmt = round2(num(l.cess));
  const cesRt =
    l.cessRate != null ? round2(num(l.cessRate)) : assess > 0 ? round2((cesAmt / assess) * 100) : 0;
  return {
    SlNo: String(l.slNo),
    PrdDesc: l.description ?? undefined,
    IsServc: l.isService ? 'Y' : 'N',
    HsnCd: l.hsn,
    Qty: qty,
    Unit: l.unit ?? 'NOS',
    UnitPrice: unitPrice,
    TotAmt: round2(qty * unitPrice), // gross (before discount)
    Discount: 0,
    AssAmt: assess, // assessable value (taxable)
    GstRt: round2(num(l.gstRate)),
    IgstAmt: round2(num(l.igst)),
    CgstAmt: round2(num(l.cgst)),
    SgstAmt: round2(num(l.sgst)),
    CesRt: cesRt,
    CesAmt: cesAmt,
    TotItemVal: round2(num(l.total)),
  };
}

export function buildIrnRequest(
  h: InvoiceHeader,
  lines: InvoiceLine[],
  seller: SellerParty,
  buyer: BuyerParty,
): IrnRequest {
  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: h.supplyType ?? 'B2B',
      RegRev: h.reverseCharge ? 'Y' : 'N',
      IgstOnIntra: h.igstOnIntra ? 'Y' : 'N',
    },
    DocDtls: { Typ: h.docType ?? 'INV', No: h.docNo, Dt: toPortalDate(h.docDate) },
    SellerDtls: {
      Gstin: seller.gstin, LglNm: seller.legalName, TrdNm: seller.tradeName ?? undefined,
      Addr1: seller.address1, Addr2: seller.address2 ?? undefined,
      Loc: seller.location, Pin: pinNum(seller.pincode), Stcd: seller.stateCode,
    },
    BuyerDtls: {
      Gstin: buyer.gstin ?? 'URP', LglNm: buyer.legalName, Pos: buyer.posStateCode,
      Addr1: buyer.address1, Loc: buyer.location, Pin: pinNum(buyer.pincode), Stcd: buyer.stateCode,
    },
    ItemList: lines.map(buildIrnItem),
    ValDtls: {
      AssVal: round2(h.taxable), CgstVal: round2(h.cgst), SgstVal: round2(h.sgst),
      IgstVal: round2(h.igst), CesVal: round2(h.cess), RndOffAmt: round2(h.roundOff),
      TotInvVal: round2(h.total),
    },
  };
}

export function buildEwbRequest(h: InvoiceHeader, seller: SellerParty, buyer: BuyerParty): EwbRequest {
  const mode = (h.transportMode ?? 'road').toLowerCase();
  return {
    validityDays: ewayValidityDays(h.distanceKm),
    supplyType: 'O', // outward
    subSupplyType: '1', // supply
    docType: 'INV',
    docNo: h.docNo,
    docDate: toPortalDate(h.docDate),
    fromGstin: seller.gstin,
    fromPincode: seller.pincode,
    fromStateCode: seller.stateCode,
    toGstin: buyer.gstin ?? 'URP',
    toPincode: buyer.pincode,
    toStateCode: buyer.stateCode,
    totInvValue: round2(h.total),
    transDistance: num(h.distanceKm),
    transMode: transModeCode[mode] ?? '1',
    vehicleType: 'R',
    vehicleNo: h.vehicleNo ?? undefined,
    transporterId: h.transporterId ?? undefined,
    transporterName: h.transporterName ?? undefined,
  };
}
