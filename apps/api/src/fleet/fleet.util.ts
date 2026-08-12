/**
 * Fleet maintenance & fuel-log pure helpers (Plan D3). No NestJS/DB imports so
 * each is unit-testable in isolation (the .mjs tests import the compiled dist).
 *
 * Covers three bits of arithmetic the services and the dashboard alert share:
 *   - `computeNextDue`  — roll a service anchor forward by its km/day interval.
 *   - `serviceDueState` — classify a schedule as ok / due_soon / overdue against
 *     the vehicle's current odometer and today's date.
 *   - `fuelEfficiency` / `summariseFuel` — km-per-litre for one fill and the
 *     tank-to-tank mileage + cost-per-km across a vehicle's log.
 */

const MS_PER_DAY = 86_400_000;
const round1 = (v: number): number => Math.round((Number(v) || 0) * 10) / 10;
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parse an ISO `YYYY-MM-DD` to epoch ms at 00:00 UTC; null if unparseable. */
function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Format epoch ms as an ISO `YYYY-MM-DD` (UTC). */
function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (positive = future); null if either is bad. */
function daysBetween(fromIso: string, toIso: string): number | null {
  const a = isoToMs(fromIso);
  const b = isoToMs(toIso);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Next-due computation
// ---------------------------------------------------------------------------

export interface NextDueInput {
  /** Odometer at the last service — the km anchor. */
  baseOdometer?: number | null;
  /** ISO date of the last service — the date anchor. */
  baseDate?: string | null;
  intervalKm?: number | null;
  intervalDays?: number | null;
}

export interface NextDue {
  nextDueOdometer: number | null;
  nextDueDate: string | null;
}

/**
 * Roll a service anchor forward by its interval. A km next-due needs both a base
 * odometer and a positive km interval; a date next-due needs both a base date and
 * a positive day interval. Either half may be null independently.
 */
export function computeNextDue(input: NextDueInput): NextDue {
  const { baseOdometer, baseDate, intervalKm, intervalDays } = input;

  let nextDueOdometer: number | null = null;
  if (isNum(baseOdometer) && isNum(intervalKm) && intervalKm > 0) {
    nextDueOdometer = round1(baseOdometer + intervalKm);
  }

  let nextDueDate: string | null = null;
  const baseMs = isoToMs(baseDate);
  if (baseMs !== null && isNum(intervalDays) && intervalDays > 0) {
    nextDueDate = msToIso(baseMs + intervalDays * MS_PER_DAY);
  }

  return { nextDueOdometer, nextDueDate };
}

// ---------------------------------------------------------------------------
// Due-state classification
// ---------------------------------------------------------------------------

export type ServiceDueStatus = 'ok' | 'due_soon' | 'overdue';

export interface ServiceDueInput {
  nextDueOdometer?: number | null;
  currentOdometer?: number | null;
  nextDueDate?: string | null;
  /** ISO `YYYY-MM-DD` for "now". */
  today: string;
  /** Warn when the odometer is within this many km of the due reading. */
  warnKm?: number;
  /** Warn when the due date is within this many days. */
  warnDays?: number;
}

export interface ServiceDueResult {
  status: ServiceDueStatus;
  /** nextDueOdometer − currentOdometer (negative = overrun); null if either unknown. */
  kmRemaining: number | null;
  /** Whole days from today to nextDueDate (negative = past); null if no due date. */
  daysRemaining: number | null;
  overdueByKm: boolean;
  overdueByDate: boolean;
  reasons: string[];
}

/**
 * Classify a schedule. Overdue if the due date has passed OR the odometer has
 * reached/passed the due reading; else due_soon if within either warning window;
 * else ok. A schedule with no due date and no due odometer is `ok` (nothing to
 * measure against).
 */
export function serviceDueState(input: ServiceDueInput): ServiceDueResult {
  const { nextDueOdometer, currentOdometer, nextDueDate, today } = input;
  const warnKm = isNum(input.warnKm) ? input.warnKm : 500;
  const warnDays = isNum(input.warnDays) ? input.warnDays : 14;

  const kmRemaining =
    isNum(nextDueOdometer) && isNum(currentOdometer) ? round1(nextDueOdometer - currentOdometer) : null;
  const daysRemaining = nextDueDate ? daysBetween(today, nextDueDate) : null;

  const overdueByKm = kmRemaining !== null && kmRemaining <= 0;
  const overdueByDate = daysRemaining !== null && daysRemaining < 0;

  const dueSoonByKm = kmRemaining !== null && kmRemaining > 0 && kmRemaining <= warnKm;
  const dueSoonByDate = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= warnDays;

  const reasons: string[] = [];
  if (overdueByDate) reasons.push(`${Math.abs(daysRemaining as number)} day(s) past due`);
  if (overdueByKm) reasons.push(`${Math.abs(kmRemaining as number)} km past due`);
  if (!overdueByDate && dueSoonByDate) reasons.push(`due in ${daysRemaining} day(s)`);
  if (!overdueByKm && dueSoonByKm) reasons.push(`due in ${kmRemaining} km`);

  let status: ServiceDueStatus = 'ok';
  if (overdueByKm || overdueByDate) status = 'overdue';
  else if (dueSoonByKm || dueSoonByDate) status = 'due_soon';

  return { status, kmRemaining, daysRemaining, overdueByKm, overdueByDate, reasons };
}

// ---------------------------------------------------------------------------
// Fuel efficiency
// ---------------------------------------------------------------------------

export interface FuelEfficiencyInput {
  /** Odometer at the previous full-tank fill; null when this is the first fill. */
  prevOdometer?: number | null;
  currOdometer: number;
  litres: number;
}

export interface FuelEfficiency {
  distanceKm: number;
  kmPerLitre: number;
}

/**
 * km-per-litre for a single full-tank interval. Returns null when there is no
 * previous reading, the odometer did not advance, or no fuel was recorded — i.e.
 * whenever a mileage figure would be meaningless rather than zero.
 */
export function fuelEfficiency(input: FuelEfficiencyInput): FuelEfficiency | null {
  const { prevOdometer, currOdometer, litres } = input;
  if (!isNum(prevOdometer) || !isNum(currOdometer) || !isNum(litres)) return null;
  if (litres <= 0) return null;
  const distance = currOdometer - prevOdometer;
  if (distance <= 0) return null;
  return { distanceKm: round1(distance), kmPerLitre: round2(distance / litres) };
}

// ---------------------------------------------------------------------------
// Fuel-log roll-up
// ---------------------------------------------------------------------------

export interface FuelSummaryRow {
  quantityLitres: number;
  amount: number;
  /** Distance this fill closed; null/0 for the baseline (first) fill. */
  distanceKm?: number | null;
}

export interface FuelSummary {
  entryCount: number;
  totalLitres: number;
  totalAmount: number;
  /** Sum of measured tank-to-tank distances. */
  totalDistanceKm: number;
  /** totalDistanceKm ÷ litres burned over those distances; null with no measured interval. */
  avgKmPerLitre: number | null;
  /** cost over measured distances ÷ those distances; null with no measured interval. */
  avgCostPerKm: number | null;
}

/**
 * Tank-to-tank mileage across a vehicle's fuel log. Only fills that closed a
 * measured interval (a non-null, positive `distanceKm`) contribute to the
 * average — the baseline fill's litres are excluded so km/L isn't understated.
 */
export function summariseFuel(rows: FuelSummaryRow[]): FuelSummary {
  let totalLitres = 0;
  let totalAmount = 0;
  let totalDistanceKm = 0;
  let litresOverDistance = 0;
  let amountOverDistance = 0;

  for (const r of rows) {
    const litres = Number(r.quantityLitres) || 0;
    const amount = Number(r.amount) || 0;
    totalLitres += litres;
    totalAmount += amount;
    const distance = Number(r.distanceKm) || 0;
    if (r.distanceKm != null && distance > 0) {
      totalDistanceKm += distance;
      litresOverDistance += litres;
      amountOverDistance += amount;
    }
  }

  return {
    entryCount: rows.length,
    totalLitres: round2(totalLitres),
    totalAmount: round2(totalAmount),
    totalDistanceKm: round1(totalDistanceKm),
    avgKmPerLitre: litresOverDistance > 0 ? round2(totalDistanceKm / litresOverDistance) : null,
    avgCostPerKm: totalDistanceKm > 0 ? round2(amountOverDistance / totalDistanceKm) : null,
  };
}
