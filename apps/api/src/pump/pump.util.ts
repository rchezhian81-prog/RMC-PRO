/**
 * Pump management — pure helpers (no NestJS / DB imports) so the rules are unit
 * tested on their own:
 *
 *   - `isPumpVehicle`        — which vehicle-master rows are pumps.
 *   - `canPumpTransition`    — the job state machine.
 *   - `pumpHoursBetween`     — hours from the pumping start/end stamps.
 *   - `pumpCharge`           — the job's charge from its basis.
 *   - `reconcilePumpJobs`    — pump jobs against what the orders were billed.
 */

export const PUMP_STATUSES = ['planned', 'on_site', 'pumping', 'completed', 'cancelled'] as const;
export type PumpStatus = (typeof PUMP_STATUSES)[number];

export const CHARGE_BASES = ['per_m3', 'per_hour', 'fixed', 'included'] as const;
export type ChargeBasis = (typeof CHARGE_BASES)[number];

const NEXT: Record<PumpStatus, readonly PumpStatus[]> = {
  planned: ['on_site', 'pumping', 'cancelled'],
  on_site: ['pumping', 'completed', 'cancelled'],
  pumping: ['completed'],
  completed: [],
  cancelled: [],
};

const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round((Number(v) || 0) * f) / f;
};

/** A vehicle-master type that means a concrete pump (concrete_pump, "Boom pump", "Line Pump" …). */
export function isPumpVehicle(vehicleType: unknown): boolean {
  return /pump/i.test(String(vehicleType ?? ''));
}

export const isPumpStatus = (s: unknown): s is PumpStatus =>
  typeof s === 'string' && (PUMP_STATUSES as readonly string[]).includes(s);

export const isChargeBasis = (s: unknown): s is ChargeBasis =>
  typeof s === 'string' && (CHARGE_BASES as readonly string[]).includes(s);

export function canPumpTransition(from: string, to: string): boolean {
  return isPumpStatus(from) && isPumpStatus(to) && NEXT[from].includes(to);
}

/** Hours between two stamps, 2 dp; null when either is missing or the end is before the start. */
export function pumpHoursBetween(start: Date | string | null | undefined, end: Date | string | null | undefined): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return round((b - a) / 3_600_000, 2);
}

/** What the job charges, from its basis: per m³ pumped, per pump hour, a fixed sum, or nothing (included in the concrete rate). */
export function pumpCharge(basis: string, rate: unknown, pumpedM3: unknown, hours: unknown): number {
  const r = Number(rate) || 0;
  switch (basis) {
    case 'per_m3': return round(r * (Number(pumpedM3) || 0), 2);
    case 'per_hour': return round(r * (Number(hours) || 0), 2);
    case 'fixed': return round(r, 2);
    default: return 0;
  }
}

export interface PumpJobLite {
  status: string;
  pumpedM3: unknown;
  hours: unknown;
  chargeAmount: unknown;
  chargeBasis: string;
}

export interface OrderPumpFacts {
  orderId: string;
  orderNo: string;
  customerName: string | null;
  /** Any order line (or the site) says a pump is needed. */
  pumpRequired: boolean;
  /** The pump charge per m³ on the order lines (quantity-weighted), i.e. what the invoice bills. */
  pumpChargePerM3: number;
  /** Concrete delivered on the order (delivered challans, net of returns). */
  deliveredM3: number;
  jobs: PumpJobLite[];
}

export interface PumpReconciliationRow {
  orderId: string;
  orderNo: string;
  customerName: string | null;
  pumpRequired: boolean;
  pumpChargePerM3: number;
  deliveredM3: number;
  jobs: number;
  openJobs: number;
  pumpedM3: number;
  pumpHours: number;
  /** Σ job charge amounts (what the pump jobs say the pumping is worth). */
  jobChargeAmount: number;
  /** pumpChargePerM3 × deliveredM3 — what the order's billing already carries for pumping. */
  billedPumpCharge: number;
  /** Plain-words findings; empty when everything lines up. */
  flags: string[];
}

/**
 * Line the pump jobs up against each order's billing.
 *
 *   - a pump was required (or a pump charge is billed) but no job was raised
 *     (the pour may have gone unpumped or unrecorded);
 *   - pumping happened on an order that carries no pump charge (unbilled pumping);
 *   - pumped m³ differs from delivered m³ by more than 5 % once the order is
 *     fully pumped (a job's quantity was mis-keyed, or part of the pour was
 *     placed without the pump).
 */
export function reconcilePumpJobs(orders: OrderPumpFacts[]): { rows: PumpReconciliationRow[]; totals: Record<string, number> } {
  const rows: PumpReconciliationRow[] = orders.map((o) => {
    const live = o.jobs.filter((j) => j.status !== 'cancelled');
    const done = live.filter((j) => j.status === 'completed');
    const pumpedM3 = round(done.reduce((s, j) => s + (Number(j.pumpedM3) || 0), 0), 3);
    const pumpHours = round(done.reduce((s, j) => s + (Number(j.hours) || 0), 0), 2);
    const jobChargeAmount = round(done.reduce((s, j) => s + (Number(j.chargeAmount) || 0), 0), 2);
    const billedPumpCharge = round((Number(o.pumpChargePerM3) || 0) * (Number(o.deliveredM3) || 0), 2);
    const flags: string[] = [];
    // A pump was asked for (order / line / site flag) or is being billed
    // (a pump charge on the lines) — either way a pour with no pump job is a gap.
    if ((o.pumpRequired || (Number(o.pumpChargePerM3) || 0) > 0) && live.length === 0) {
      flags.push(o.pumpRequired ? 'Pump required on the order but no pump job was raised' : 'A pump charge is billed on the order but no pump job was raised');
    }
    if (pumpedM3 > 0 && (Number(o.pumpChargePerM3) || 0) === 0 && done.some((j) => j.chargeBasis !== 'included')) {
      flags.push('Pumping recorded on an order that bills no pump charge');
    }
    const delivered = Number(o.deliveredM3) || 0;
    if (done.length > 0 && live.length === done.length && delivered > 0 && pumpedM3 > 0) {
      const diff = Math.abs(pumpedM3 - delivered) / delivered;
      if (diff > 0.05) flags.push(`Pumped ${pumpedM3} m³ against ${delivered} m³ delivered (${round(diff * 100, 1)} % apart)`);
    }
    return {
      orderId: o.orderId, orderNo: o.orderNo, customerName: o.customerName,
      pumpRequired: o.pumpRequired, pumpChargePerM3: round(o.pumpChargePerM3, 2), deliveredM3: round(delivered, 3),
      jobs: live.length, openJobs: live.length - done.length,
      pumpedM3, pumpHours, jobChargeAmount, billedPumpCharge, flags,
    };
  });
  const totals = {
    orders: rows.length,
    jobs: rows.reduce((s, r) => s + r.jobs, 0),
    pumpedM3: round(rows.reduce((s, r) => s + r.pumpedM3, 0), 3),
    pumpHours: round(rows.reduce((s, r) => s + r.pumpHours, 0), 2),
    jobChargeAmount: round(rows.reduce((s, r) => s + r.jobChargeAmount, 0), 2),
    billedPumpCharge: round(rows.reduce((s, r) => s + r.billedPumpCharge, 0), 2),
    flagged: rows.filter((r) => r.flags.length > 0).length,
  };
  return { rows, totals };
}
