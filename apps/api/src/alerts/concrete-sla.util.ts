/**
 * Concrete-on-road SLA alert (Tier-5E) — pure formatting of the "loads still out
 * past their on-road life" count into an operator alert, kept separate from the
 * SQL in AlertsService so the rule is unit-testable without a database.
 *
 * Ready-mix concrete has a limited working life from batching (IS 4926 places it
 * around 90–120 min to discharge, depending on admixtures/temperature). A load
 * dispatched from the plant but not yet marked delivered past that window risks
 * setting on the truck — scrap plus a cleanup. This flags how many are over the
 * threshold right now, and how long the oldest has been out.
 */

export type ConcreteSlaSeverity = 'danger' | 'warning' | 'info';

export interface ConcreteSlaAlert {
  key: string;
  severity: ConcreteSlaSeverity;
  title: string;
  detail: string;
  href: string;
  count: number;
}

/** Default on-road SLA in minutes (dispatch → delivered). */
export const CONCRETE_SLA_MINUTES = 120;

export interface OnRoadSlaRow {
  /** Dispatches on the road longer than the SLA. */
  overSla: number | string | null;
  /** Minutes the oldest over-SLA load has been out. */
  oldestMinutes: number | string | null;
}

const n = (v: number | string | null | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

export function concreteSlaAlerts(
  row: OnRoadSlaRow | undefined,
  slaMinutes: number = CONCRETE_SLA_MINUTES,
): ConcreteSlaAlert[] {
  const over = Math.trunc(n(row?.overSla));
  if (over <= 0) return [];
  const oldest = Math.round(n(row?.oldestMinutes));
  const loads = `${over} load${over === 1 ? '' : 's'}`;
  return [
    {
      key: 'concrete_on_road_sla',
      severity: 'danger',
      title: `${loads} on the road past the ${slaMinutes}-min SLA`,
      detail: `${over} dispatch${over === 1 ? '' : 'es'} left the plant over ${slaMinutes} min ago and aren't marked delivered — concrete risks setting on the truck. Oldest is ${oldest} min out.`,
      href: '/app/dispatch/board',
      count: over,
    },
  ];
}
