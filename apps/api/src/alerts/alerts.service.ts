import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { fleetComplianceAlerts, type FleetDoc } from './fleet-compliance.util';

export type AlertSeverity = 'danger' | 'warning' | 'info';

export interface Alert {
  /** Stable identifier for the rule that produced this alert. */
  key: string;
  severity: AlertSeverity;
  /** One-line headline, already formatted for display (₹ in Indian grouping). */
  title: string;
  /** Supporting sentence — names, counts, what to do. */
  detail: string;
  /** Screen that resolves the alert. */
  href: string;
  count?: number;
  amount?: number;
}

const inr = (v: unknown): string =>
  '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown): number => Number(v ?? 0);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Deterministic operational alerts — plain SQL rules over the tenant's own data.
 *
 * This is the always-available counterpart to the (optional, paid) AI insights:
 * same job — "what should the owner notice today" — but computed from the
 * database, so it is instant, free, and can never state a figure that isn't in
 * the ledger. Every query runs inside the caller's RLS context.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly db: TenantDbService) {}

  async list(tenantId: string): Promise<{ alerts: Alert[]; generatedAt: string }> {
    const alerts = await this.db.runInTenant(tenantId, async (m) => {
      const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
        m.query(sql, params) as Promise<T[]>;

      const [receivables, overLimit, stockCounts, stockNames, ops, month, quotes, backlog, fleetDocs, qc] = await Promise.all([
        // Receivables, bucketed by age of the invoice and by contractual due date.
        q(`SELECT
             COALESCE(sum(outstanding_amount) FILTER (WHERE invoice_date IS NOT NULL AND CURRENT_DATE - invoice_date > 90), 0)::float AS over90_amount,
             count(*)                          FILTER (WHERE invoice_date IS NOT NULL AND CURRENT_DATE - invoice_date > 90)            AS over90_count,
             COALESCE(sum(outstanding_amount) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE), 0)::float               AS past_due_amount,
             count(*)                          FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE)                         AS past_due_count,
             COALESCE(sum(outstanding_amount), 0)::float                                                                               AS total_amount
           FROM invoices
          WHERE invoice_status = 'issued' AND outstanding_amount > 0`),

        // Customers whose unpaid balance has passed the credit limit on their master.
        q(`SELECT c.customer_name,
                  c.credit_limit::float                AS credit_limit,
                  sum(i.outstanding_amount)::float     AS outstanding
             FROM invoices i JOIN customers c ON c.id = i.customer_id
            WHERE i.invoice_status = 'issued' AND i.outstanding_amount > 0 AND c.credit_limit > 0
            GROUP BY c.id, c.customer_name, c.credit_limit
           HAVING sum(i.outstanding_amount) > c.credit_limit
            ORDER BY sum(i.outstanding_amount) - c.credit_limit DESC`),

        q(`SELECT
             count(*) FILTER (WHERE b.current_quantity < 0)                                                                  AS negative_count,
             count(*) FILTER (WHERE mt.reorder_level > 0 AND b.current_quantity >= 0 AND b.current_quantity <= mt.reorder_level) AS low_count
           FROM stock_balances b JOIN materials mt ON mt.id = b.material_id`),

        // The worst-off materials, for naming in the alert detail.
        q(`SELECT COALESCE(b.material_label, mt.material_name) AS name,
                  b.current_quantity::float                    AS quantity,
                  b.uom
             FROM stock_balances b JOIN materials mt ON mt.id = b.material_id
            WHERE b.current_quantity < 0
               OR (mt.reorder_level > 0 AND b.current_quantity <= mt.reorder_level)
            ORDER BY (b.current_quantity - mt.reorder_level) ASC
            LIMIT 4`),

        q(`SELECT
             (SELECT count(*) FROM credit_hold_requests WHERE status = 'pending')                                              AS credit_holds,
             (SELECT count(*) FROM delivery_challans WHERE challan_status = 'delivered' AND invoice_status = 'not_invoiced')    AS uninvoiced,
             (SELECT count(*) FROM mix_designs WHERE is_active_version = true AND approval_status <> 'approved')                AS mixes_pending`),

        q(`SELECT COALESCE(sum(total_amount), 0)::float AS amount, count(*) AS count
             FROM invoices
            WHERE invoice_status = 'issued'
              AND invoice_date IS NOT NULL
              AND date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)`),

        q(`SELECT
             count(*) FILTER (WHERE valid_until < CURRENT_DATE)                                          AS expired,
             count(*) FILTER (WHERE valid_until >= CURRENT_DATE AND valid_until <= CURRENT_DATE + 7)     AS expiring
           FROM quotations
          WHERE status = 'active' AND approval_status = 'approved' AND valid_until IS NOT NULL`),

        q(`SELECT count(*) AS waiting FROM batch_queue WHERE queue_status = 'waiting'`),

        // Fleet renewal documents (vehicle FC/insurance/PUC/permit/road-tax + driver
        // licence) that are already expired or fall due within the warning window.
        q<FleetDoc>(`
          SELECT asset, doc, to_char(expiry, 'YYYY-MM-DD') AS expiry FROM (
            SELECT vehicle_no AS asset, 'Insurance'       AS doc, insurance_expiry AS expiry, status FROM vehicles WHERE insurance_expiry IS NOT NULL
            UNION ALL SELECT vehicle_no, 'Fitness (FC)',    fitness_expiry,   status FROM vehicles WHERE fitness_expiry   IS NOT NULL
            UNION ALL SELECT vehicle_no, 'Permit',          permit_expiry,    status FROM vehicles WHERE permit_expiry    IS NOT NULL
            UNION ALL SELECT vehicle_no, 'Pollution (PUC)', pollution_expiry, status FROM vehicles WHERE pollution_expiry IS NOT NULL
            UNION ALL SELECT vehicle_no, 'Road tax',        road_tax_expiry,  status FROM vehicles WHERE road_tax_expiry  IS NOT NULL
            UNION ALL SELECT driver_name, 'Licence',        license_expiry,   status FROM drivers  WHERE license_expiry   IS NOT NULL
          ) d
          WHERE COALESCE(status, '') <> 'inactive' AND expiry <= CURRENT_DATE + 30
          ORDER BY expiry ASC`),

        // QC cube sets due for 28-day testing, and any that failed IS 456 acceptance.
        q(`SELECT
             count(*) FILTER (
               WHERE cast_date + 28 <= CURRENT_DATE AND status IN ('open', 'tested')
                 AND NOT EXISTS (SELECT 1 FROM qc_cube_results r WHERE r.cube_set_id = s.id AND r.test_age_days >= 28)
             ) AS cubes_due,
             count(*) FILTER (WHERE acceptance_status = 'rejected') AS cubes_failed
           FROM qc_cube_sets s`),
      ]);

      const r = receivables[0] ?? {};
      const s = stockCounts[0] ?? {};
      const o = ops[0] ?? {};
      const mo = month[0] ?? {};
      const qt = quotes[0] ?? {};
      const bl = backlog[0] ?? {};
      const out: Alert[] = [];

      // ---- Money at risk -----------------------------------------------
      const over90 = num(r.over90_amount);
      if (over90 > 0) {
        out.push({
          key: 'receivables_over_90',
          severity: 'danger',
          title: `${inr(over90)} outstanding for more than 90 days`,
          detail: `${plural(num(r.over90_count), 'invoice')} unpaid past 90 days. Follow up before it ages further.`,
          href: '/app/billing/outstanding',
          count: num(r.over90_count),
          amount: over90,
        });
      }

      const pastDue = num(r.past_due_amount);
      if (pastDue > 0) {
        out.push({
          key: 'invoices_past_due',
          severity: 'warning',
          title: `${inr(pastDue)} past its due date`,
          detail: `${plural(num(r.past_due_count), 'invoice')} is past the agreed payment date.`,
          href: '/app/billing/outstanding',
          count: num(r.past_due_count),
          amount: pastDue,
        });
      }

      if (overLimit.length) {
        const worst = overLimit[0] as Record<string, unknown>;
        const excess = num(worst.outstanding) - num(worst.credit_limit);
        out.push({
          key: 'credit_limit_breached',
          severity: 'danger',
          title:
            overLimit.length === 1
              ? `${String(worst.customer_name)} is over their credit limit`
              : `${overLimit.length} customers are over their credit limit`,
          detail: `${String(worst.customer_name)} owes ${inr(worst.outstanding)} against a limit of ${inr(
            worst.credit_limit,
          )} — ${inr(excess)} over. New orders will hit credit hold.`,
          href: '/app/billing/outstanding',
          count: overLimit.length,
        });
      }

      // ---- Revenue not yet billed ---------------------------------------
      if (num(o.uninvoiced) > 0) {
        out.push({
          key: 'delivered_uninvoiced',
          severity: 'warning',
          title: `${plural(num(o.uninvoiced), 'delivered challan')} not yet invoiced`,
          detail: 'Concrete has been supplied but not billed. Raise the invoices to start the payment clock.',
          href: '/app/billing/invoices',
          count: num(o.uninvoiced),
        });
      }

      // ---- Stock ---------------------------------------------------------
      const named = (stockNames as Record<string, unknown>[])
        .map((x) => `${String(x.name)} (${num(x.quantity).toLocaleString('en-IN')} ${String(x.uom ?? '')})`.trim())
        .join(', ');

      if (num(s.negative_count) > 0) {
        out.push({
          key: 'stock_negative',
          severity: 'danger',
          title: `${plural(num(s.negative_count), 'material')} at negative stock`,
          detail: named
            ? `Over-consumed against recorded receipts: ${named}. Record the pending inward or correct the batch entries.`
            : 'Over-consumed against recorded receipts. Record the pending inward or correct the batch entries.',
          href: '/app/inventory/negative-stock',
          count: num(s.negative_count),
        });
      }

      if (num(s.low_count) > 0) {
        out.push({
          key: 'stock_low',
          severity: 'warning',
          title: `${plural(num(s.low_count), 'material')} at or below reorder level`,
          detail: named ? `Lowest: ${named}. Raise a purchase before the next pour.` : 'Raise a purchase before the next pour.',
          href: '/app/inventory/reports',
          count: num(s.low_count),
        });
      }

      // ---- Things waiting on a decision ----------------------------------
      if (num(o.credit_holds) > 0) {
        out.push({
          key: 'credit_holds_pending',
          severity: 'warning',
          title: `${plural(num(o.credit_holds), 'order')} waiting on credit approval`,
          detail: 'These orders cannot be scheduled for production until they are approved or rejected.',
          href: '/app/credit-holds',
          count: num(o.credit_holds),
        });
      }

      if (num(bl.waiting) > 0) {
        out.push({
          key: 'batch_queue_waiting',
          severity: 'info',
          title: `${plural(num(bl.waiting), 'batch')} waiting in the production queue`,
          detail: 'Queued for batching but not yet produced.',
          href: '/app/production/batch-queue',
          count: num(bl.waiting),
        });
      }

      if (num(qt.expired) > 0 || num(qt.expiring) > 0) {
        const bits: string[] = [];
        if (num(qt.expired) > 0) bits.push(`${plural(num(qt.expired), 'quotation')} already expired`);
        if (num(qt.expiring) > 0) bits.push(`${num(qt.expiring)} expiring within 7 days`);
        out.push({
          key: 'quotations_expiring',
          severity: 'info',
          title: 'Approved quotations need follow-up',
          detail: `${bits.join(', ')}. Convert them to orders or re-issue with current rates.`,
          href: '/app/sales/quotations',
          count: num(qt.expired) + num(qt.expiring),
        });
      }

      if (num(o.mixes_pending) > 0) {
        out.push({
          key: 'mix_designs_pending',
          severity: 'info',
          title: `${plural(num(o.mixes_pending), 'mix design')} not approved`,
          detail: 'Unapproved designs cannot be used to raise a batch ticket.',
          href: '/app/production/mix-designs',
          count: num(o.mixes_pending),
        });
      }

      // ---- Fleet compliance ----------------------------------------------
      out.push(...fleetComplianceAlerts(fleetDocs, new Date()));

      // ---- QC / Lab ------------------------------------------------------
      const qcRow = qc[0] ?? {};
      if (num(qcRow.cubes_failed) > 0) {
        out.push({
          key: 'qc_cubes_failed',
          severity: 'danger',
          title: `${plural(num(qcRow.cubes_failed), 'cube set')} failed IS 456 acceptance`,
          detail: 'Concrete of a rejected set does not meet the specified strength — review the pour and notify the customer.',
          href: '/app/qc/cubes',
          count: num(qcRow.cubes_failed),
        });
      }
      if (num(qcRow.cubes_due) > 0) {
        out.push({
          key: 'qc_cubes_due',
          severity: 'warning',
          title: `${plural(num(qcRow.cubes_due), 'cube set')} due for 28-day testing`,
          detail: 'These cubes have reached 28 days but have no result recorded. Test and record the strength.',
          href: '/app/qc/cubes',
          count: num(qcRow.cubes_due),
        });
      }

      // ---- Always-on context ---------------------------------------------
      out.push({
        key: 'sales_this_month',
        severity: 'info',
        title: `${inr(mo.amount)} invoiced this month`,
        detail:
          num(mo.count) > 0
            ? `Across ${plural(num(mo.count), 'issued invoice')}. Total receivable outstanding: ${inr(r.total_amount)}.`
            : 'No invoices issued yet this month.',
        href: '/app/billing/reports',
        count: num(mo.count),
        amount: num(mo.amount),
      });

      return out;
    });

    const rank: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.amount ?? 0) - (a.amount ?? 0));
    return { alerts, generatedAt: new Date().toISOString() };
  }
}
