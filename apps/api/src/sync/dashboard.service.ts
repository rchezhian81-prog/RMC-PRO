import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { loadUserAccess, isTenantOwner } from '../rbac/access';

/** Phase-1 cross-module dashboard KPIs + operations funnel (DEV-PLAN B15/F12). */
@Injectable()
export class DashboardService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * The dashboard stays open to every tenant user (gating the whole thing is a
   * blank front door), but its company-wide money figures — receivables and
   * collections — are reporting data. Show them only to the owner or a holder of
   * reports.view; everyone else still gets the operational dashboard.
   */
  private async canSeeFinancials(tenantId: string, userId: string): Promise<boolean> {
    const access = await loadUserAccess(this.db, tenantId, userId);
    return isTenantOwner(access) || access.permissions.includes('reports.view');
  }

  summary(tenantId: string, userId: string) {
    return this.canSeeFinancials(tenantId, userId).then((canFinancials) =>
    this.db.runInTenant(tenantId, async (m) => {
      const one = async (sql: string, params: unknown[] = []): Promise<number> => {
        const r = await m.query(sql, params);
        return Number(r[0]?.n ?? 0);
      };
      const sum = async (sql: string): Promise<number> => {
        const r = await m.query(sql);
        return Number(r[0]?.s ?? 0);
      };
      const [
        ordersConfirmed, ordersDraft, ordersCreditHold, creditHoldsPending,
        batchConfirmed, dispatchesActive, challansDelivered, challansUninvoiced,
        invoicesIssued, outstandingTotal, lowStock, negativeStock, receiptsTotal, devices,
      ] = await Promise.all([
        one(`SELECT count(*) n FROM orders WHERE order_status='confirmed'`),
        one(`SELECT count(*) n FROM orders WHERE order_status='draft'`),
        one(`SELECT count(*) n FROM orders WHERE order_status='credit_hold'`),
        one(`SELECT count(*) n FROM credit_hold_requests WHERE status='pending'`),
        one(`SELECT count(*) n FROM batch_tickets WHERE status='confirmed'`),
        one(`SELECT count(*) n FROM dispatches WHERE dispatch_status NOT IN ('completed','cancelled','rejected')`),
        one(`SELECT count(*) n FROM delivery_challans WHERE challan_status='delivered'`),
        one(`SELECT count(*) n FROM delivery_challans WHERE invoice_status='not_invoiced' AND challan_status='delivered'`),
        one(`SELECT count(*) n FROM invoices WHERE invoice_status='issued'`),
        // Company AR = issued-invoice outstanding — the single "outstanding"
        // definition, identical to the outstanding report's grand total. Credit
        // EXPOSURE (opening + un-invoiced orders + invoice outstanding −
        // advances) is a distinct number surfaced per-customer by the credit
        // gate, alerts and /customers/:id/exposure — deliberately not merged in.
        sum(`SELECT COALESCE(SUM(outstanding_amount),0) s FROM invoices WHERE invoice_status='issued'`),
        one(`SELECT count(*) n FROM stock_balances b JOIN materials mt ON mt.id=b.material_id WHERE mt.reorder_level>0 AND b.current_quantity<=mt.reorder_level`),
        one(`SELECT count(*) n FROM stock_balances WHERE current_quantity<0`),
        sum(`SELECT COALESCE(SUM(amount),0) s FROM payments`),
        one(`SELECT count(*) n FROM devices WHERE status='active'`),
      ]);
      return {
        orders: { confirmed: ordersConfirmed, draft: ordersDraft, creditHold: ordersCreditHold },
        creditHoldsPending,
        production: { batchTicketsConfirmed: batchConfirmed },
        dispatch: { active: dispatchesActive, delivered: challansDelivered, uninvoiced: challansUninvoiced },
        // invoicesIssued is an operational count; the two money figures are
        // reporting data, withheld (null, shape preserved) from a user who can't
        // see reports.
        billing: {
          invoicesIssued,
          outstandingTotal: canFinancials ? outstandingTotal : null,
          receiptsTotal: canFinancials ? receiptsTotal : null,
        },
        inventory: { lowStock, negativeStock },
        devices,
      };
    }));
  }

  /** Order-to-cash funnel counts across modules. */
  operationsFunnel(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const n = async (sql: string) => Number((await m.query(sql))[0]?.n ?? 0);
      return {
        leads: await n(`SELECT count(*) n FROM leads`),
        quotations: await n(`SELECT count(*) n FROM quotations`),
        ordersConfirmed: await n(`SELECT count(*) n FROM orders WHERE order_status='confirmed'`),
        batchTickets: await n(`SELECT count(*) n FROM batch_tickets WHERE status='confirmed'`),
        dispatches: await n(`SELECT count(*) n FROM dispatches`),
        challansDelivered: await n(`SELECT count(*) n FROM delivery_challans WHERE challan_status='delivered'`),
        invoicesIssued: await n(`SELECT count(*) n FROM invoices WHERE invoice_status='issued'`),
      };
    });
  }

  /**
   * Daily activity trend-lines for the dashboard — one dense, gap-filled point
   * per day across the requested window (default 30 days, clamped 7–90).
   *
   * Every series returns EXACTLY `days` points, zero-filled server-side via a
   * `generate_series` date spine LEFT JOINed to the source table, so the client
   * draws a continuous line with no gaps (and honestly flat at zero on an empty
   * pilot rather than a jagged fabricated shape). Read-only; each source table's
   * domain date is COALESCEd with created_at so no dated row is silently dropped.
   *
   * `table`, `dateExpr`, `where` and `value` come only from the static catalog
   * below — never from the request. The sole request-derived value is the window
   * size, bound as an int parameter. `metrics` merely selects which catalogued
   * series to run, so nothing user-supplied is ever interpolated into SQL.
   */
  private static readonly TRENDS: {
    key: string; label: string; unit: 'count' | 'inr'; table: string; dateExpr: string; where?: string; value: string;
  }[] = [
    { key: 'invoiced', label: 'Invoiced', unit: 'count', table: 'invoices', dateExpr: `COALESCE(t.invoice_date, t.created_at::date)`, where: `t.invoice_status = 'issued'`, value: `count(t.id)` },
    { key: 'collected', label: 'Collected', unit: 'inr', table: 'payments', dateExpr: `COALESCE(t.receipt_date, t.created_at::date)`, value: `COALESCE(sum(t.amount), 0)` },
    { key: 'produced', label: 'Batch tickets', unit: 'count', table: 'batch_tickets', dateExpr: `COALESCE(t.batch_start_time, t.created_at)::date`, where: `t.status = 'confirmed'`, value: `count(t.id)` },
    { key: 'dispatched', label: 'Dispatches', unit: 'count', table: 'dispatches', dateExpr: `COALESCE(t.dispatch_time, t.created_at)::date`, value: `count(t.id)` },
    { key: 'ordered', label: 'Confirmed orders', unit: 'count', table: 'orders', dateExpr: `COALESCE(t.order_date, t.created_at::date)`, where: `t.order_status = 'confirmed'`, value: `count(t.id)` },
    { key: 'delivered', label: 'Delivered', unit: 'count', table: 'delivery_challans', dateExpr: `t.created_at::date`, where: `t.challan_status = 'delivered'`, value: `count(t.id)` },
  ];
  private static readonly TRENDS_DEFAULT = ['invoiced', 'collected', 'produced', 'dispatched'];

  async trends(tenantId: string, userId: string, days = 30, metrics?: string[]) {
    const win = Math.min(90, Math.max(7, Math.floor(Number(days) || 30)));
    const wanted = new Set((metrics && metrics.length ? metrics : DashboardService.TRENDS_DEFAULT).map((k) => k.trim()));
    // Preserve catalogue order; ignore any unknown keys so a bad param can't error.
    // Money series (unit 'inr' — e.g. collections) are reporting data, dropped for
    // a user who cannot see reports; the count series stay.
    const canFinancials = await this.canSeeFinancials(tenantId, userId);
    const defs = DashboardService.TRENDS.filter((d) => wanted.has(d.key) && (canFinancials || d.unit !== 'inr'));
    return this.db.runInTenant(tenantId, async (m) => {
      const [win_row] = await m.query(
        `SELECT to_char(current_date - ($1::int - 1), 'YYYY-MM-DD') AS from_d, to_char(current_date, 'YYYY-MM-DD') AS to_d`,
        [win],
      );
      // Sequential, NOT Promise.all: runInTenant scopes one transaction-local
      // connection, so concurrent queries on the shared manager are unsafe (and
      // deprecated in pg). Each query is a few ms over a ≤90-row spine.
      const series = [];
      for (const d of defs) {
        const sql = `
          WITH spine AS (
            SELECT generate_series((current_date - ($1::int - 1)), current_date, interval '1 day')::date AS d
          )
          SELECT to_char(spine.d, 'YYYY-MM-DD') AS d, ${d.value} AS v
          FROM spine
          LEFT JOIN ${d.table} t ON ${d.dateExpr} = spine.d${d.where ? `\n           AND ${d.where}` : ''}
          GROUP BY spine.d
          ORDER BY spine.d`;
        const rows: { d: string; v: string }[] = await m.query(sql, [win]);
        series.push({ key: d.key, label: d.label, unit: d.unit, points: rows.map((r) => ({ d: r.d, v: Number(r.v) })) });
      }
      return { from: win_row?.from_d ?? null, to: win_row?.to_d ?? null, days: win, series };
    });
  }
}
