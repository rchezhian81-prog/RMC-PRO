/**
 * Fleet compliance alerts (Plan D1) — pure formatting of vehicle/driver renewal
 * documents into operator alerts, kept separate from the SQL in AlertsService so
 * the date-window rule is unit-testable without a database.
 *
 * A document is EXPIRED once its date is strictly before today (a document is
 * still valid through its expiry date). A document is EXPIRING when it falls
 * within the next `warnWithinDays`. Expired → one `danger` alert; expiring → one
 * `warning` alert; each names the soonest few. Returns [] when the fleet is clean.
 */
export type FleetAlertSeverity = 'danger' | 'warning' | 'info';

export interface FleetComplianceAlert {
  key: string;
  severity: FleetAlertSeverity;
  title: string;
  detail: string;
  href: string;
  count: number;
}

/** One renewable document on a vehicle or driver. `expiry` is ISO `YYYY-MM-DD`. */
export interface FleetDoc {
  asset: string; // vehicle number or driver name
  doc: string; // 'Insurance' | 'Fitness (FC)' | 'Permit' | 'Pollution (PUC)' | 'Road tax' | 'Licence'
  expiry: string;
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `today` (00:00 UTC) to an ISO date; negative = already past. */
function daysUntil(isoDate: string, today: Date): number | null {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / MS_PER_DAY);
}

const label = (d: FleetDoc): string => `${d.asset} — ${d.doc}`;
const names = (arr: FleetDoc[]): string =>
  arr.slice(0, 4).map(label).join(', ') + (arr.length > 4 ? ', …' : '');

export function fleetComplianceAlerts(
  docs: FleetDoc[],
  today: Date,
  warnWithinDays = 30,
): FleetComplianceAlert[] {
  const dated = docs
    .map((d) => ({ d, days: daysUntil(d.expiry, today) }))
    .filter((x): x is { d: FleetDoc; days: number } => x.days !== null);

  const expired = dated.filter((x) => x.days < 0).sort((a, b) => a.days - b.days).map((x) => x.d);
  const expiring = dated
    .filter((x) => x.days >= 0 && x.days <= warnWithinDays)
    .sort((a, b) => a.days - b.days)
    .map((x) => x.d);

  const out: FleetComplianceAlert[] = [];
  if (expired.length) {
    out.push({
      key: 'fleet_docs_expired',
      severity: 'danger',
      title: `${expired.length} fleet document${expired.length === 1 ? '' : 's'} expired`,
      detail: `Renew before the vehicle runs again — this is a compliance risk: ${names(expired)}.`,
      href: '/app/entity/vehicles',
      count: expired.length,
    });
  }
  if (expiring.length) {
    out.push({
      key: 'fleet_docs_expiring',
      severity: 'warning',
      title: `${expiring.length} fleet document${expiring.length === 1 ? '' : 's'} expiring within ${warnWithinDays} days`,
      detail: `Schedule renewal: ${names(expiring)}.`,
      href: '/app/entity/vehicles',
      count: expiring.length,
    });
  }
  return out;
}
