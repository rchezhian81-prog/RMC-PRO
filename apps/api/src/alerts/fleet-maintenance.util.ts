/**
 * Fleet maintenance-due alerts (Plan D3) — pure formatting of vehicle service
 * schedules into operator alerts, kept separate from the SQL in AlertsService so
 * the due-window rule is unit-testable without a database. Mirrors the D1
 * fleet-compliance util; the actual due classification is delegated to
 * `serviceDueState` in the fleet domain helpers so there is a single source of
 * truth for "overdue vs due soon".
 */
import { serviceDueState } from '../fleet/fleet.util';

export type FleetMaintenanceSeverity = 'danger' | 'warning' | 'info';

export interface FleetMaintenanceAlert {
  key: string;
  severity: FleetMaintenanceSeverity;
  title: string;
  detail: string;
  href: string;
  count: number;
}

/** One active service schedule with the vehicle's current odometer resolved. */
export interface MaintenanceDueRow {
  vehicle: string; // vehicle number
  serviceType: string;
  nextDueDate?: string | null; // ISO YYYY-MM-DD
  nextDueOdometer?: number | null;
  currentOdometer?: number | null;
}

const labelOf = (r: MaintenanceDueRow): string => `${r.vehicle} — ${r.serviceType}`;
const names = (arr: MaintenanceDueRow[]): string =>
  arr.slice(0, 4).map(labelOf).join(', ') + (arr.length > 4 ? ', …' : '');

/**
 * Group active schedules into an overdue (`danger`) alert and a due-soon
 * (`warning`) alert. `today` is a Date; km/day warning windows are configurable.
 * Returns [] when nothing is overdue or approaching.
 */
export function fleetMaintenanceAlerts(
  rows: MaintenanceDueRow[],
  today: Date,
  warnDays = 14,
  warnKm = 500,
): FleetMaintenanceAlert[] {
  const todayIso = today.toISOString().slice(0, 10);
  const overdue: MaintenanceDueRow[] = [];
  const dueSoon: MaintenanceDueRow[] = [];

  for (const r of rows) {
    const state = serviceDueState({
      nextDueOdometer: r.nextDueOdometer ?? null,
      currentOdometer: r.currentOdometer ?? null,
      nextDueDate: r.nextDueDate ?? null,
      today: todayIso,
      warnDays,
      warnKm,
    });
    if (state.status === 'overdue') overdue.push(r);
    else if (state.status === 'due_soon') dueSoon.push(r);
  }

  const out: FleetMaintenanceAlert[] = [];
  if (overdue.length) {
    out.push({
      key: 'fleet_service_overdue',
      severity: 'danger',
      title: `${overdue.length} vehicle service${overdue.length === 1 ? '' : 's'} overdue`,
      detail: `Service is past due by date or odometer — running these risks breakdown: ${names(overdue)}.`,
      href: '/app/fleet/maintenance',
      count: overdue.length,
    });
  }
  if (dueSoon.length) {
    out.push({
      key: 'fleet_service_due_soon',
      severity: 'warning',
      title: `${dueSoon.length} vehicle service${dueSoon.length === 1 ? '' : 's'} due soon`,
      detail: `Schedule these before they fall due: ${names(dueSoon)}.`,
      href: '/app/fleet/maintenance',
      count: dueSoon.length,
    });
  }
  return out;
}
