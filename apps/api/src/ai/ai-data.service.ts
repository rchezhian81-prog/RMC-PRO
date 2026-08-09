import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';

/**
 * Read-only, tenant-scoped data reads shared by the AI features (assistant tools
 * and insights). Every query runs inside the caller's RLS context, so it can
 * only ever return this tenant's own rows.
 */
@Injectable()
export class AiDataService {
  constructor(private readonly db: TenantDbService) {}

  businessSummary(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const [row] = await m.query(
        `SELECT
           (SELECT count(*) FROM customers WHERE status='active')                                   AS active_customers,
           (SELECT count(*) FROM orders WHERE order_status='confirmed')                              AS confirmed_orders,
           (SELECT count(*) FROM orders WHERE order_status='draft')                                  AS draft_orders,
           (SELECT count(*) FROM orders WHERE order_status='credit_hold')                            AS credit_hold_orders,
           (SELECT count(*) FROM invoices WHERE invoice_status='issued')                             AS issued_invoices,
           (SELECT COALESCE(sum(outstanding_amount),0)::float FROM invoices WHERE invoice_status='issued') AS total_outstanding,
           (SELECT COALESCE(sum(total_amount),0)::float FROM invoices
              WHERE invoice_status='issued'
                AND invoice_date IS NOT NULL
                AND date_trunc('month', invoice_date::date) = date_trunc('month', CURRENT_DATE))     AS sales_this_month`,
      );
      return row ?? {};
    });
  }

  topOutstanding(tenantId: string, limit = 5) {
    return this.db.runInTenant(tenantId, (m) =>
      m.query(
        `SELECT c.customer_name, c.customer_code, COALESCE(sum(i.outstanding_amount),0)::float AS outstanding
           FROM invoices i JOIN customers c ON c.id = i.customer_id
          WHERE i.invoice_status='issued' AND i.outstanding_amount > 0
          GROUP BY c.id, c.customer_name, c.customer_code
          ORDER BY outstanding DESC
          LIMIT $1`,
        [limit],
      ),
    );
  }

  lowStock(tenantId: string, limit = 8) {
    return this.db.runInTenant(tenantId, (m) =>
      m.query(
        `SELECT material_label, current_quantity::float AS quantity, uom
           FROM stock_balances
          ORDER BY current_quantity ASC
          LIMIT $1`,
        [limit],
      ),
    );
  }

  recentOrders(tenantId: string, status: string | null, limit = 10) {
    return this.db.runInTenant(tenantId, (m) =>
      m.query(
        `SELECT order_no, order_date, order_status
           FROM orders
          WHERE ($1::text IS NULL OR order_status = $1)
          ORDER BY created_at DESC
          LIMIT $2`,
        [status, limit],
      ),
    );
  }

  /** One combined snapshot used to generate insights. */
  async snapshot(tenantId: string) {
    const [summary, topOutstanding, lowStock, creditHolds] = await Promise.all([
      this.businessSummary(tenantId),
      this.topOutstanding(tenantId, 5),
      this.lowStock(tenantId, 6),
      this.recentOrders(tenantId, 'credit_hold', 10),
    ]);
    return { summary, topOutstanding, lowStock, creditHolds };
  }
}
