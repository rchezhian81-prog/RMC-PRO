import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { isTenantOwner } from '../rbac/access';
import { UserAccessService } from '../rbac/user-access.service';

/** A validated reporting window, both ends inclusive calendar dates (YYYY-MM-DD). */
export interface DashboardPeriod {
  from: string;
  to: string;
}

/** The longest window the summary and funnel accept, in calendar days (both ends counted). */
export const DASHBOARD_PERIOD_MAX_DAYS = 366;

const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a YYYY-MM-DD string as a UTC day, or null when it is not a real calendar date. */
function parseDay(s: string): number | null {
  const m = YMD.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

/**
 * Turn the optional `from`/`to` query strings into a period, or null when
 * neither is given (the all-time figures the dashboard always showed). Both
 * must be given together, be real dates, run forwards, and span at most
 * DASHBOARD_PERIOD_MAX_DAYS calendar days — a wider window is refused rather
 * than answered slowly with a figure nobody reads at that grain.
 */
export function parseDashboardPeriod(from?: string, to?: string): DashboardPeriod | null {
  const f = String(from ?? '').trim();
  const t = String(to ?? '').trim();
  if (!f && !t) return null;
  const bad = (message: string) =>
    new BadRequestException({ code: 'VALIDATION_ERROR', message, fields: { from: message, to: message } });
  if (!f || !t) throw bad('Give both a from and a to date (YYYY-MM-DD).');
  const fd = parseDay(f);
  const td = parseDay(t);
  if (fd == null || td == null) throw bad('Dates must be real calendar dates in YYYY-MM-DD form.');
  if (fd > td) throw bad('The from date must not be after the to date.');
  const days = Math.round((td - fd) / DAY_MS) + 1;
  if (days > DASHBOARD_PERIOD_MAX_DAYS) {
    throw bad(`The period can cover at most ${DASHBOARD_PERIOD_MAX_DAYS} days; this one covers ${days}.`);
  }
  return { from: f, to: t };
}

/**
 * Phase-1 cross-module dashboard KPIs + operations funnel (DEV-PLAN B15/F12).
 *
 * Two kinds of figure live side by side. COUNTS AND SUMS OF EVENTS — orders
 * booked, concrete batched and delivered, challans, invoices and receipts —
 * belong to a window, and honour the `period` when one is given (all time
 * otherwise, which is what the dashboard always showed). POINT-IN-TIME figures
 * — the outstanding, stock on hand, loads on the road, credit holds waiting —
 * have no window: they are always "now", whatever the period, and the response
 * names them under `live` so a screen can say which is which.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: TenantDbService,
    private readonly userAccess: UserAccessService,
  ) {}

  /**
   * The dashboard stays open to every tenant user (gating the whole thing is a
   * blank front door), but its company-wide money figures — receivables and
   * collections — are reporting data. Show them only to the owner or a holder of
   * reports.view; everyone else still gets the operational dashboard.
   */
  private async canSeeFinancials(tenantId: string, userId: string): Promise<boolean> {
    const access = await this.userAccess.get(tenantId, userId);
    return isTenantOwner(access) || access.permissions.includes('reports.view');
  }

  /**
   * Dotted paths of the summary figures that follow the period, and of those
   * that are always live — the screen reads these rather than guessing.
   */
  static readonly SUMMARY_PERIOD_METRICS = [
    'orders.confirmed', 'production.batchTicketsConfirmed', 'production.batchedM3',
    'dispatch.delivered', 'dispatch.deliveredM3', 'billing.invoicesIssued', 'billing.invoicedTotal', 'billing.receiptsTotal',
  ] as const;
  static readonly SUMMARY_LIVE_METRICS = [
    'orders.draft', 'orders.creditHold', 'creditHoldsPending', 'dispatch.active', 'dispatch.uninvoiced',
    'billing.outstandingTotal', 'inventory.lowStock', 'inventory.negativeStock', 'devices',
  ] as const;

  async summary(tenantId: string, userId: string, period: DashboardPeriod | null = null) {
    const canFinancials = await this.canSeeFinancials(tenantId, userId);
    return this.db.runInTenant(tenantId, async (m) => {
      // Every event query takes the same two parameters; without a period the
      // window clause is simply left out, so the figures are the all-time ones.
      const params = period ? [period.from, period.to] : [];
      const win = (dateExpr: string) => (period ? ` AND ${dateExpr} BETWEEN $1::date AND $2::date` : '');
      const one = async (sql: string, p: unknown[] = []): Promise<number> => {
        const r = await m.query(sql, p);
        return Number(r[0]?.n ?? 0);
      };
      const sum = async (sql: string, p: unknown[] = []): Promise<number> => {
        const r = await m.query(sql, p);
        return Number(r[0]?.s ?? 0);
      };
      // Sequential on purpose: runInTenant scopes one transaction-local
      // connection, so concurrent queries on the shared manager are unsafe.
      // Each is a counted index scan; the whole set is a few ms.
      const ordersConfirmed = await one(`SELECT count(*) n FROM orders WHERE order_status='confirmed'${win(`COALESCE(order_date, created_at::date)`)}`, params);
      const ordersDraft = await one(`SELECT count(*) n FROM orders WHERE order_status='draft'`);
      const ordersCreditHold = await one(`SELECT count(*) n FROM orders WHERE order_status='credit_hold'`);
      const creditHoldsPending = await one(`SELECT count(*) n FROM credit_hold_requests WHERE status='pending'`);
      const batchConfirmed = await one(`SELECT count(*) n FROM batch_tickets WHERE status='confirmed'${win(`COALESCE(batch_start_time, created_at)::date`)}`, params);
      const batchedM3 = await sum(`SELECT COALESCE(SUM(batch_quantity_m3),0) s FROM batch_tickets WHERE status='confirmed'${win(`COALESCE(batch_start_time, created_at)::date`)}`, params);
      const dispatchesActive = await one(`SELECT count(*) n FROM dispatches WHERE dispatch_status NOT IN ('completed','cancelled','rejected')`);
      const challansDelivered = await one(`SELECT count(*) n FROM delivery_challans WHERE challan_status='delivered'${win(`COALESCE(dispatch_time, created_at)::date`)}`, params);
      const deliveredM3 = await sum(`SELECT COALESCE(SUM(quantity_m3 - COALESCE(return_quantity_m3,0)),0) s FROM delivery_challans WHERE challan_status='delivered'${win(`COALESCE(dispatch_time, created_at)::date`)}`, params);
      const challansUninvoiced = await one(`SELECT count(*) n FROM delivery_challans WHERE invoice_status='not_invoiced' AND challan_status='delivered'`);
      const invoicesIssued = await one(`SELECT count(*) n FROM invoices WHERE invoice_status='issued'${win(`COALESCE(invoice_date, created_at::date)`)}`, params);
      const invoicedTotal = await sum(`SELECT COALESCE(SUM(total_amount),0) s FROM invoices WHERE invoice_status='issued'${win(`COALESCE(invoice_date, created_at::date)`)}`, params);
      // Company AR = issued-invoice outstanding — the single "outstanding"
      // definition, identical to the outstanding report's grand total. Credit
      // EXPOSURE (opening + un-invoiced orders + invoice outstanding −
      // advances) is a distinct number surfaced per-customer by the credit
      // gate, alerts and /customers/:id/exposure — deliberately not merged in.
      const outstandingTotal = await sum(`SELECT COALESCE(SUM(outstanding_amount),0) s FROM invoices WHERE invoice_status='issued'`);
      const lowStock = await one(`SELECT count(*) n FROM stock_balances b JOIN materials mt ON mt.id=b.material_id WHERE mt.reorder_level>0 AND b.current_quantity<=mt.reorder_level`);
      const negativeStock = await one(`SELECT count(*) n FROM stock_balances WHERE current_quantity<0`);
      const receiptsTotal = await sum(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE true${win(`COALESCE(receipt_date, created_at::date)`)}`, params);
      const devices = await one(`SELECT count(*) n FROM devices WHERE status='active'`);
      return {
        // null = all time (the figures the dashboard always showed).
        period,
        periodMetrics: DashboardService.SUMMARY_PERIOD_METRICS,
        live: DashboardService.SUMMARY_LIVE_METRICS,
        orders: { confirmed: ordersConfirmed, draft: ordersDraft, creditHold: ordersCreditHold },
        creditHoldsPending,
        production: { batchTicketsConfirmed: batchConfirmed, batchedM3 },
        dispatch: { active: dispatchesActive, delivered: challansDelivered, deliveredM3, uninvoiced: challansUninvoiced },
        // invoicesIssued is an operational count; the money figures are
        // reporting data, withheld (null, shape preserved) from a user who can't
        // see reports.
        billing: {
          invoicesIssued,
          invoicedTotal: canFinancials ? invoicedTotal : null,
          outstandingTotal: canFinancials ? outstandingTotal : null,
          receiptsTotal: canFinancials ? receiptsTotal : null,
        },
        inventory: { lowStock, negativeStock },
        devices,
      };
    });
  }

  /**
   * Order-to-cash funnel counts across modules. Every step is a count of
   * events, so all of them follow the period when one is given.
   */
  operationsFunnel(tenantId: string, period: DashboardPeriod | null = null) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = period ? [period.from, period.to] : [];
      const n = async (sql: string, dateExpr: string) => {
        const where = period ? `${sql.includes(' WHERE ') ? ' AND' : ' WHERE'} ${dateExpr} BETWEEN $1::date AND $2::date` : '';
        return Number((await m.query(sql + where, params))[0]?.n ?? 0);
      };
      return {
        period,
        leads: await n(`SELECT count(*) n FROM leads`, `created_at::date`),
        quotations: await n(`SELECT count(*) n FROM quotations`, `COALESCE(quotation_date, created_at::date)`),
        ordersConfirmed: await n(`SELECT count(*) n FROM orders WHERE order_status='confirmed'`, `COALESCE(order_date, created_at::date)`),
        batchTickets: await n(`SELECT count(*) n FROM batch_tickets WHERE status='confirmed'`, `COALESCE(batch_start_time, created_at)::date`),
        dispatches: await n(`SELECT count(*) n FROM dispatches`, `COALESCE(dispatch_time, created_at)::date`),
        challansDelivered: await n(`SELECT count(*) n FROM delivery_challans WHERE challan_status='delivered'`, `COALESCE(dispatch_time, created_at)::date`),
        invoicesIssued: await n(`SELECT count(*) n FROM invoices WHERE invoice_status='issued'`, `COALESCE(invoice_date, created_at::date)`),
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
