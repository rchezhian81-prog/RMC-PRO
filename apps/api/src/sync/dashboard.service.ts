import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';

/** Phase-1 cross-module dashboard KPIs + operations funnel (DEV-PLAN B15/F12). */
@Injectable()
export class DashboardService {
  constructor(private readonly db: TenantDbService) {}

  summary(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
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
        billing: { invoicesIssued, outstandingTotal, receiptsTotal },
        inventory: { lowStock, negativeStock },
        devices,
      };
    });
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
}
