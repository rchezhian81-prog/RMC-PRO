/**
 * The basis of each charge on a priced line — transport, pump and waiting.
 *
 * Every charge used to be a per-m³ figure folded into one all-in rate, and the
 * invoice billed qty × (rate + transport + pump + waiting). That stays the
 * default. A line may instead carry transport per trip (one truck load) or as
 * a lump sum for the order, pumping per job or per pump hour, and waiting per
 * hour on site after a free period. The basis decides how the quotation
 * estimates the line, how the order values itself for the credit check, and
 * what the invoice adds beside the concrete lines.
 *
 * Shared by the API (validation, totals, invoicing) and the browser (the
 * live read-out beside a line form), so a figure reads the same on both.
 */
export const CHARGE_BASIS = {
  PER_M3: 'per_m3',
  PER_TRIP: 'per_trip',
  LUMP_SUM: 'lump_sum',
  PER_JOB: 'per_job',
  PER_HOUR: 'per_hour',
} as const;

export const TRANSPORT_BASES = [CHARGE_BASIS.PER_M3, CHARGE_BASIS.PER_TRIP, CHARGE_BASIS.LUMP_SUM] as const;
export const PUMP_BASES = [CHARGE_BASIS.PER_M3, CHARGE_BASIS.PER_JOB, CHARGE_BASIS.PER_HOUR] as const;
export const WAITING_BASES = [CHARGE_BASIS.PER_M3, CHARGE_BASIS.PER_HOUR] as const;

export type TransportBasis = (typeof TRANSPORT_BASES)[number];
export type PumpBasis = (typeof PUMP_BASES)[number];
export type WaitingBasis = (typeof WAITING_BASES)[number];
export type ChargeBasisValue = (typeof CHARGE_BASIS)[keyof typeof CHARGE_BASIS];

export const isTransportBasis = (v: unknown): v is TransportBasis =>
  typeof v === 'string' && (TRANSPORT_BASES as readonly string[]).includes(v);
export const isPumpBasis = (v: unknown): v is PumpBasis =>
  typeof v === 'string' && (PUMP_BASES as readonly string[]).includes(v);
export const isWaitingBasis = (v: unknown): v is WaitingBasis =>
  typeof v === 'string' && (WAITING_BASES as readonly string[]).includes(v);

/** The basis as it reads on a screen or a document: "per m³", "per trip", "lump sum", "per job", "per hour". */
export function chargeBasisLabel(basis: unknown): string {
  switch (basis) {
    case CHARGE_BASIS.PER_TRIP: return 'per trip';
    case CHARGE_BASIS.LUMP_SUM: return 'lump sum';
    case CHARGE_BASIS.PER_JOB: return 'per job';
    case CHARGE_BASIS.PER_HOUR: return 'per hour';
    default: return 'per m³';
  }
}

/** The unit an invoice line carries for a charge billed on this basis. */
export function chargeBasisUom(basis: unknown): string {
  switch (basis) {
    case CHARGE_BASIS.PER_TRIP: return 'trip';
    case CHARGE_BASIS.LUMP_SUM: return 'lot';
    case CHARGE_BASIS.PER_JOB: return 'job';
    case CHARGE_BASIS.PER_HOUR: return 'hour';
    default: return 'm3';
  }
}

/** Tenant settings the basis maths read, with the defaults the catalogue ships. */
export const TRUCK_M3_SETTING_KEY = 'billing.default_truck_m3';
export const DEFAULT_TRUCK_M3 = 6;
export const WAITING_FREE_MINUTES_SETTING_KEY = 'billing.waiting_free_minutes';
export const DEFAULT_WAITING_FREE_MINUTES = 60;

/** A stored truck size as the estimate uses it: a positive number, else the default. */
export function truckM3Setting(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRUCK_M3;
}

/** A stored free-waiting period as the invoice uses it: zero or more minutes, else the default. */
export function waitingFreeMinutesSetting(raw: unknown): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_WAITING_FREE_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WAITING_FREE_MINUTES;
}

export interface LineEstimateInput {
  qty: unknown;
  rate: unknown;
  transport?: unknown;
  transportBasis?: unknown;
  pump?: unknown;
  pumpBasis?: unknown;
  waiting?: unknown;
  waitingBasis?: unknown;
  /** Truck load in m³, for the per-trip count. Falls back to the default when missing. */
  truckM3?: unknown;
}

export interface LineEstimate {
  /** qty × concrete rate. */
  concrete: number;
  transport: number;
  pump: number;
  waiting: number;
  /** Trips counted for a per-trip transport charge (0 on any other basis). */
  trips: number;
  /** True when every charge is per m³, so one all-in ₹/m³ figure describes the line. */
  allPerM3: boolean;
  /** The ex-GST line value: concrete + the three charges. */
  total: number;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Trips a quantity takes at the given truck load, always at least one for a positive quantity. */
export function tripsFor(qty: unknown, truckM3: unknown): number {
  const q = num(qty);
  if (q <= 0) return 0;
  return Math.max(1, Math.ceil(q / truckM3Setting(truckM3) - 1e-9));
}

/**
 * Value a priced line the way its bases say: per-m³ charges multiply by the
 * quantity; per-trip transport multiplies by the trips the quantity takes at
 * the truck load; a lump sum and a per-job pump count once; a per-hour charge
 * counts nothing in an estimate (the hours are known only when billed).
 */
export function estimateLineParts(input: LineEstimateInput): LineEstimate {
  const qty = num(input.qty);
  const concrete = round2(qty * num(input.rate));
  const tBasis = isTransportBasis(input.transportBasis) ? input.transportBasis : CHARGE_BASIS.PER_M3;
  const pBasis = isPumpBasis(input.pumpBasis) ? input.pumpBasis : CHARGE_BASIS.PER_M3;
  const wBasis = isWaitingBasis(input.waitingBasis) ? input.waitingBasis : CHARGE_BASIS.PER_M3;
  const trips = tBasis === CHARGE_BASIS.PER_TRIP ? tripsFor(qty, input.truckM3) : 0;
  const transport =
    tBasis === CHARGE_BASIS.PER_TRIP ? round2(trips * num(input.transport))
    : tBasis === CHARGE_BASIS.LUMP_SUM ? round2(num(input.transport))
    : round2(qty * num(input.transport));
  const pump =
    pBasis === CHARGE_BASIS.PER_JOB ? round2(num(input.pump))
    : pBasis === CHARGE_BASIS.PER_HOUR ? 0
    : round2(qty * num(input.pump));
  const waiting = wBasis === CHARGE_BASIS.PER_HOUR ? 0 : round2(qty * num(input.waiting));
  const allPerM3 = tBasis === CHARGE_BASIS.PER_M3 && pBasis === CHARGE_BASIS.PER_M3 && wBasis === CHARGE_BASIS.PER_M3;
  return { concrete, transport, pump, waiting, trips, allPerM3, total: round2(concrete + transport + pump + waiting) };
}

/** The ex-GST value of a priced line under its charge bases (see estimateLineParts). */
export function estimateLineValue(input: LineEstimateInput): number {
  return estimateLineParts(input).total;
}

/**
 * The ₹/m³ a line bills per cubic metre: the concrete rate plus only the
 * charges that are themselves per m³. Charges on any other basis are billed
 * as lines of their own.
 */
export function perM3Rate(input: Omit<LineEstimateInput, 'qty' | 'truckM3'>): number {
  const t = isTransportBasis(input.transportBasis) && input.transportBasis !== CHARGE_BASIS.PER_M3 ? 0 : num(input.transport);
  const p = isPumpBasis(input.pumpBasis) && input.pumpBasis !== CHARGE_BASIS.PER_M3 ? 0 : num(input.pump);
  const w = isWaitingBasis(input.waitingBasis) && input.waitingBasis !== CHARGE_BASIS.PER_M3 ? 0 : num(input.waiting);
  return round2(num(input.rate) + t + p + w);
}

/**
 * Billable waiting hours for one delivery: the minutes from reaching the site
 * to the start of the pour, less the free period, rounded UP to the next
 * quarter hour. 0 when either stamp is missing, the pour started before the
 * arrival, or the wait stayed within the free period.
 */
export function billableWaitingHours(
  siteArrival: Date | string | null | undefined,
  pourStart: Date | string | null | undefined,
  freeMinutes: unknown,
): number {
  if (!siteArrival || !pourStart) return 0;
  const a = new Date(siteArrival).getTime();
  const b = new Date(pourStart).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const minutes = (b - a) / 60_000 - waitingFreeMinutesSetting(freeMinutes);
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 15 - 1e-9) * 0.25;
}
