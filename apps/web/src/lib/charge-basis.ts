import { CHARGE_BASIS, chargeBasisLabel, estimateLineParts, perM3Rate, type LineEstimate } from '@rmc/shared';

/**
 * The charge bases as a priced line carries them on screen — the quotation,
 * rate-contract and order line tables and the forms that add a line. The
 * maths (trips at the truck load, a lump sum once, per hour not estimated)
 * is the shared estimateLineParts; this file only words it.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const money = (v: unknown) => '₹' + num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A saved line (an API row) or the line form being typed — read by key, so either shape fits. */
export type PricedLine = Record<string, unknown>;

/** The bases a blank line form starts with. */
export const DEFAULT_BASES = { transportBasis: 'per_m3', pumpBasis: 'per_m3', waitingBasis: 'per_m3' };

/** The basis a saved line carries, or per m³ when the record predates the basis. */
export const basisOf = (v: unknown): string => (typeof v === 'string' && v ? v : CHARGE_BASIS.PER_M3);

/** The ₹/m³ a line bills per cubic metre: the concrete plus the charges that are per m³. */
export function linePerM3(it: PricedLine): number {
  return perM3Rate({
    rate: it.ratePerM3, transport: it.transportCharge, transportBasis: basisOf(it.transportBasis),
    pump: it.pumpCharge, pumpBasis: basisOf(it.pumpBasis), waiting: it.waitingCharge, waitingBasis: basisOf(it.waitingBasis),
  });
}

/** The line valued under its bases, for a quantity, at the tenant's truck load. */
export function lineParts(it: PricedLine, qty: unknown, truckM3: unknown): LineEstimate {
  return estimateLineParts({
    qty, rate: it.ratePerM3,
    transport: it.transportCharge, transportBasis: basisOf(it.transportBasis),
    pump: it.pumpCharge, pumpBasis: basisOf(it.pumpBasis),
    waiting: it.waitingCharge, waitingBasis: basisOf(it.waitingBasis),
    truckM3,
  });
}

/** True when every charge on the line is per m³, so one all-in ₹/m³ describes it. */
export function allPerM3(it: PricedLine): boolean {
  return basisOf(it.transportBasis) === CHARGE_BASIS.PER_M3 && basisOf(it.pumpBasis) === CHARGE_BASIS.PER_M3 && basisOf(it.waitingBasis) === CHARGE_BASIS.PER_M3;
}

/**
 * The charges on a line, each with its basis unless per m³ — "transport
 * ₹1,500.00 per trip · pump ₹300.00 · waiting ₹400.00 per hour". Empty when
 * every charge is 0.
 */
export function chargeWords(it: PricedLine): string {
  const one = (label: string, amount: unknown, basis: unknown) => {
    if (!(num(amount) > 0)) return '';
    const b = basisOf(basis);
    return `${label} ${money(amount)}${b === CHARGE_BASIS.PER_M3 ? '' : ` ${chargeBasisLabel(b)}`}`;
  };
  return [one('transport', it.transportCharge, it.transportBasis), one('pump', it.pumpCharge, it.pumpBasis), one('waiting', it.waitingCharge, it.waitingBasis)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The charges that are not per m³ as terms, without a quantity — "transport
 * ₹1,500.00 per trip", "pump ₹3,500.00 per job", "waiting ₹400.00 per hour
 * after the free period" — for a rate contract, which has no quantity.
 */
export function termWords(it: PricedLine): string[] {
  const out: string[] = [];
  const one = (label: string, amount: unknown, basis: unknown, tail = '') => {
    const b = basisOf(basis);
    if (b !== CHARGE_BASIS.PER_M3 && num(amount) > 0) out.push(`${label} ${money(amount)} ${chargeBasisLabel(b)}${tail}`);
  };
  one('transport', it.transportCharge, it.transportBasis);
  one('pump', it.pumpCharge, it.pumpBasis);
  one('waiting', it.waitingCharge, it.waitingBasis, ' after the free period');
  return out;
}

/**
 * What the estimate counted for each charge that is not per m³, in words —
 * "transport 3 trips at ₹1,500.00", "pump ₹3,500.00 per job", "waiting
 * ₹400.00 per hour, billed on site time". The per-m³ charges are in the ₹/m³
 * figure and are not repeated here.
 */
export function estimateWords(it: PricedLine, parts: LineEstimate): string[] {
  const out: string[] = [];
  const t = basisOf(it.transportBasis);
  const p = basisOf(it.pumpBasis);
  const w = basisOf(it.waitingBasis);
  if (t === CHARGE_BASIS.PER_TRIP && num(it.transportCharge) > 0) {
    out.push(`transport ${parts.trips} ${parts.trips === 1 ? 'trip' : 'trips'} at ${money(it.transportCharge)} = ${money(parts.transport)}`);
  } else if (t === CHARGE_BASIS.LUMP_SUM && num(it.transportCharge) > 0) {
    out.push(`transport ${money(it.transportCharge)} lump sum`);
  }
  if (p === CHARGE_BASIS.PER_JOB && num(it.pumpCharge) > 0) out.push(`pump ${money(it.pumpCharge)} per job`);
  else if (p === CHARGE_BASIS.PER_HOUR && num(it.pumpCharge) > 0) out.push(`pump ${money(it.pumpCharge)} per hour, billed on the job's hours`);
  if (w === CHARGE_BASIS.PER_HOUR && num(it.waitingCharge) > 0) out.push(`waiting ${money(it.waitingCharge)} per hour, billed on site time`);
  return out;
}
