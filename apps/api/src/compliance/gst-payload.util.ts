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

/**
 * Map a stored UOM to a valid NIC UQC (unit quantity code). The IRP / e-way
 * portal validates `Unit` against a fixed UQC master, so a raw UOM like `m3`
 * (the default on a concrete line) is rejected — cubic metres must be `CBM`.
 * An already-valid UQC passes through unchanged; an unknown unit falls back to
 * `OTH` (the portal's explicit catch-all) so a payload is never built with an
 * invalid code. Pure, so it unit-tests in isolation.
 */
const NIC_UQC = new Set([
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN',
  'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MTR', 'MLT', 'MTS',
  'NOS', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD',
  'TON', 'TUB', 'UGS', 'UNT', 'YDS', 'OTH',
]);
const UOM_TO_UQC: Record<string, string> = {
  m3: 'CBM', 'm³': 'CBM', cbm: 'CBM', cum: 'CBM', cu: 'CBM', cubicmeter: 'CBM', cubicmetre: 'CBM',
  kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', kilograms: 'KGS',
  ton: 'TON', tons: 'TON', tonne: 'TON', tonnes: 'TON', mt: 'TON', t: 'TON',
  ltr: 'LTR', l: 'LTR', litre: 'LTR', liter: 'LTR', litres: 'LTR', liters: 'LTR',
  bag: 'BAG', bags: 'BAG',
  nos: 'NOS', no: 'NOS', number: 'NOS', unit: 'UNT', units: 'UNT', unt: 'UNT',
  m2: 'SQM', 'm²': 'SQM', sqm: 'SQM', sft: 'SQF', sqft: 'SQF',
  mtr: 'MTR', m: 'MTR', metre: 'MTR', meter: 'MTR', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS',
};
export function toUqc(uom: string | null | undefined): string {
  const raw = String(uom ?? '').trim();
  if (!raw) return 'OTH';
  if (NIC_UQC.has(raw.toUpperCase())) return raw.toUpperCase();
  const key = raw.toLowerCase().replace(/[\s.]/g, '');
  return UOM_TO_UQC[key] ?? 'OTH';
}

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
  /** Transport document no + date — required by non-road e-way Part B (rail/air/ship). */
  transDocNo?: string | null;
  transDocDate?: string | null; // 'yyyy-mm-dd'
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

/**
 * GST state/UT name → 2-digit state code (the numeric code the portal uses).
 * Keys are normalised (lower-cased, '&'→'and', collapsed spaces). Common
 * aliases and pre-2020 spellings are included so a state saved as "Orissa" or
 * "Pondicherry" still resolves.
 */
const GST_STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01',
  'himachal pradesh': '02',
  punjab: '03',
  chandigarh: '04',
  uttarakhand: '05',
  uttaranchal: '05',
  haryana: '06',
  delhi: '07',
  'new delhi': '07',
  'nct of delhi': '07',
  rajasthan: '08',
  'uttar pradesh': '09',
  bihar: '10',
  sikkim: '11',
  'arunachal pradesh': '12',
  nagaland: '13',
  manipur: '14',
  mizoram: '15',
  tripura: '16',
  meghalaya: '17',
  assam: '18',
  'west bengal': '19',
  jharkhand: '20',
  odisha: '21',
  orissa: '21',
  chhattisgarh: '22',
  chattisgarh: '22',
  'madhya pradesh': '23',
  gujarat: '24',
  'daman and diu': '26',
  'dadra and nagar haveli': '26',
  'dadra and nagar haveli and daman and diu': '26',
  maharashtra: '27',
  karnataka: '29',
  goa: '30',
  lakshadweep: '31',
  kerala: '32',
  'tamil nadu': '33',
  tamilnadu: '33',
  puducherry: '34',
  pondicherry: '34',
  'andaman and nicobar islands': '35',
  'andaman and nicobar': '35',
  telangana: '36',
  'andhra pradesh': '37',
  ladakh: '38',
  'other territory': '97',
};

const normaliseStateKey = (s: string): string =>
  s.trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');

/**
 * Resolve the 2-digit GST state code for an invoice's place of supply. The
 * portal's Pos / state-code fields require the numeric code (e.g. '33'), but
 * invoices store the place of supply as the customer's state NAME. Resolution
 * order: an already-numeric 2-digit value is kept as-is; a known state name is
 * mapped; otherwise a valid GSTIN's own state code is used; else '' (the
 * payload validator then flags the missing POS rather than sending a bad one).
 */
export function gstStateCode(placeOfSupply?: string | null, gstin?: string | null): string {
  const v = (placeOfSupply ?? '').trim();
  if (/^\d{2}$/.test(v)) return v;
  const named = GST_STATE_CODES[normaliseStateKey(v)];
  if (named) return named;
  if (isGstin(gstin)) return stateCodeOf(gstin as string);
  return '';
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
  /**
   * Intra-state Part-B exemption: some states exempt an intra-state move shorter
   * than this many km. When set and the move is intra-state (same state code) and
   * shorter than this, no e-way is required. Default 0 (no exemption).
   */
  intraStateExemptBelowKm?: number;
}

export function validateEwbPreflight(
  h: InvoiceHeader,
  lines: InvoiceLine[],
  seller: SellerParty,
  buyer: BuyerParty,
  opts: EwbPreflightOptions = {},
): PreflightResult {
  const errors: string[] = [];
  const threshold = opts.thresholdValue ?? 50_000;
  const distance = num(h.distanceKm);
  const intraState = !!seller.stateCode && seller.stateCode === buyer.stateCode;

  if (num(h.total) <= threshold) {
    errors.push(`consignment value ₹${num(h.total)} is at/below the ₹${threshold} threshold`);
  }
  // Intra-state short-haul exemption (state-configurable) — no e-way required.
  const exemptKm = opts.intraStateExemptBelowKm ?? 0;
  if (exemptKm > 0 && intraState && distance > 0 && distance < exemptKm) {
    errors.push(`intra-state move of ${distance} km is under the ${exemptKm} km exemption — no e-way bill required`);
  }

  if (!isGstin(seller.gstin)) errors.push('from (seller) GSTIN is missing or malformed');
  if (buyer.gstin != null && buyer.gstin !== '' && !isGstin(buyer.gstin)) errors.push('to (buyer) GSTIN is malformed');
  if (!buyer.stateCode) errors.push('to (destination) state code is missing');
  if (distance <= 0) errors.push('transport distance (km) is missing or ≤ 0');

  if (!lines.length) errors.push('invoice has no line items');
  for (const l of lines) {
    if (!l.hsn || !HSN_RE.test(l.hsn)) errors.push(`line ${l.slNo}: HSN/SAC missing or invalid`);
  }

  // Part B by transport mode.
  const mode = (h.transportMode ?? 'road').toLowerCase();
  if (mode === 'road') {
    const hasVehicle = h.vehicleNo && VEHICLE_RE.test(h.vehicleNo);
    if (!hasVehicle && !h.transporterId) {
      errors.push('road transport needs a valid vehicle number or a transporter id (Part B)');
    }
  } else if (mode === 'rail' || mode === 'air' || mode === 'ship') {
    if (!h.transDocNo || !h.transDocDate) {
      errors.push(`${mode} transport needs a transport document number and date (Part B)`);
    }
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
    Unit: toUqc(l.unit),
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

export interface IrnBuildOptions {
  /**
   * Include EwbDtls so the IRP returns the e-way bill in the SAME call (Path A,
   * runbook 02 §4) — no separate EWB auth. Only set this when the transport
   * details are complete (the EWB pre-flight passes); an incomplete EwbDtls makes
   * the portal reject the whole IRN request.
   */
  includeEwb?: boolean;
  /** R = regular (default), O = over-dimensional cargo — for the EwbDtls block. */
  vehicleType?: 'R' | 'O';
}

/** Part-B transport block embedded in the INV-01 to generate the e-way inline. */
function buildEwbDtls(h: InvoiceHeader, vehicleType: 'R' | 'O'): Record<string, unknown> {
  const mode = (h.transportMode ?? 'road').toLowerCase();
  const nonRoad = mode === 'rail' || mode === 'air' || mode === 'ship';
  return {
    TransId: h.transporterId ?? undefined,
    TransName: h.transporterName ?? undefined,
    TransMode: transModeCode[mode] ?? '1',
    Distance: num(h.distanceKm),
    VehNo: mode === 'road' ? h.vehicleNo ?? undefined : undefined,
    VehType: vehicleType,
    TransDocNo: nonRoad ? h.transDocNo ?? undefined : undefined,
    TransDocDt: nonRoad ? toPortalDate(h.transDocDate ?? null) ?? undefined : undefined,
  };
}

export function buildIrnRequest(
  h: InvoiceHeader,
  lines: InvoiceLine[],
  seller: SellerParty,
  buyer: BuyerParty,
  opts: IrnBuildOptions = {},
): IrnRequest {
  const req: IrnRequest = {
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
  if (opts.includeEwb) req.EwbDtls = buildEwbDtls(h, opts.vehicleType ?? 'R');
  return req;
}

/** One e-way `itemList` entry (NIC EWB schema — HSN + qty + assessable + rates). */
function buildEwbItem(l: InvoiceLine): Record<string, unknown> {
  const inter = num(l.igst) > 0;
  const gstRate = round2(num(l.gstRate));
  const assess = round2(num(l.taxable));
  const cesAmt = round2(num(l.cess));
  const cessRate = l.cessRate != null ? round2(num(l.cessRate)) : assess > 0 ? round2((cesAmt / assess) * 100) : 0;
  return {
    productName: l.description ?? `Item ${l.slNo}`,
    productDesc: l.description ?? undefined,
    hsnCode: l.hsn ? Number(l.hsn) : undefined, // NIC EWB hsnCode is numeric
    quantity: round2(num(l.qty)),
    qtyUnit: toUqc(l.unit),
    taxableAmount: assess,
    sgstRate: inter ? 0 : round2(gstRate / 2),
    cgstRate: inter ? 0 : round2(gstRate / 2),
    igstRate: inter ? gstRate : 0,
    cessRate,
  };
}

export interface EwbBuildOptions {
  /** EWB document type: INV (tax invoice, default), CHL (delivery challan), BIL, BOE. */
  docType?: 'INV' | 'CHL' | 'BIL' | 'BOE';
  /** Sub-supply type code (1=supply default, e.g. job-work / branch transfer). */
  subSupplyType?: string;
  /** R = regular (default), O = over-dimensional cargo. */
  vehicleType?: 'R' | 'O';
}

export function buildEwbRequest(
  h: InvoiceHeader,
  lines: InvoiceLine[],
  seller: SellerParty,
  buyer: BuyerParty,
  opts: EwbBuildOptions = {},
): EwbRequest {
  const mode = (h.transportMode ?? 'road').toLowerCase();
  const nonRoad = mode === 'rail' || mode === 'air' || mode === 'ship';
  return {
    validityDays: ewayValidityDays(h.distanceKm),
    // ---- Part A ----
    supplyType: 'O', // outward
    subSupplyType: opts.subSupplyType ?? '1', // supply
    docType: opts.docType ?? 'INV',
    docNo: h.docNo,
    docDate: toPortalDate(h.docDate),
    fromGstin: seller.gstin,
    fromPincode: pinNum(seller.pincode),
    fromStateCode: seller.stateCode,
    toGstin: buyer.gstin ?? 'URP',
    toPincode: pinNum(buyer.pincode),
    toStateCode: buyer.stateCode,
    itemList: lines.map(buildEwbItem),
    totalValue: round2(h.taxable), // assessable value
    cgstValue: round2(h.cgst),
    sgstValue: round2(h.sgst),
    igstValue: round2(h.igst),
    cessValue: round2(h.cess),
    otherValue: round2(h.roundOff), // round-off / other charges (may be negative)
    totInvValue: round2(h.total),
    transDistance: num(h.distanceKm),
    // ---- Part B ----
    transMode: transModeCode[mode] ?? '1',
    vehicleType: opts.vehicleType ?? 'R',
    vehicleNo: mode === 'road' ? h.vehicleNo ?? undefined : undefined,
    transporterId: h.transporterId ?? undefined,
    transporterName: h.transporterName ?? undefined,
    transDocNo: nonRoad ? h.transDocNo ?? undefined : undefined,
    transDocDate: nonRoad ? toPortalDate(h.transDocDate ?? null) ?? undefined : undefined,
  };
}
