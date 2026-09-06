import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Read-path indexes for hot queries a gap scan flagged as seq-scanning as tenant
 * data grows. All are plain (non-unique) indexes — they change no behaviour and
 * never abort on existing data, so there is no integrity-constraints.ts entry to
 * add. Each is justified by a query that filters/sorts on these columns TODAY:
 *
 *  - payments(customer_id, status): credit-exposure (exposure.util pending-cheque
 *    + advance reads), collection-efficiency and customer-statement all filter a
 *    single customer's payments; payments had only a tenant_id index, so each was
 *    a seq scan of the tenant's payments.
 *  - invoices(tenant_id, invoice_status, invoice_date): the GST/sales reports that
 *    already aggregate in SQL (hsn-summary, sales-mis, grade-margin,
 *    collection-efficiency) filter issued invoices by a date range with no
 *    supporting index (the existing index leads with customer_id).
 *  - orders(tenant_id, order_status), batch_tickets(tenant_id, status): the
 *    dashboard summary / operations-funnel status counts scanned these whole
 *    tables (existing indexes lead with the wrong column).
 *  - (tenant_id, created_at DESC) on orders / invoices / delivery_challans /
 *    dispatches: every list route sorts by created_at DESC with only the
 *    single-column tenant index, so it sorted the whole tenant's rows each call.
 *
 * NOTE: plain CREATE INDEX takes a brief ACCESS EXCLUSIVE lock. These tables are
 * small at pilot scale so it is momentary; if any grows very large before a
 * future deploy, switch that one to CREATE INDEX CONCURRENTLY (outside a tx).
 */
export class PerformanceIndexes1720000057000 implements MigrationInterface {
  name = 'PerformanceIndexes1720000057000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX "idx_payments_customer_status" ON payments (customer_id, status)`);
    await q.query(`CREATE INDEX "idx_invoices_status_date" ON invoices (tenant_id, invoice_status, invoice_date)`);
    await q.query(`CREATE INDEX "idx_orders_status" ON orders (tenant_id, order_status)`);
    await q.query(`CREATE INDEX "idx_batch_tickets_status" ON batch_tickets (tenant_id, status)`);
    await q.query(`CREATE INDEX "idx_orders_created" ON orders (tenant_id, created_at DESC)`);
    await q.query(`CREATE INDEX "idx_invoices_created" ON invoices (tenant_id, created_at DESC)`);
    await q.query(`CREATE INDEX "idx_delivery_challans_created" ON delivery_challans (tenant_id, created_at DESC)`);
    await q.query(`CREATE INDEX "idx_dispatches_created" ON dispatches (tenant_id, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_dispatches_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_delivery_challans_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_invoices_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_orders_created"`);
    await q.query(`DROP INDEX IF EXISTS "idx_batch_tickets_status"`);
    await q.query(`DROP INDEX IF EXISTS "idx_orders_status"`);
    await q.query(`DROP INDEX IF EXISTS "idx_invoices_status_date"`);
    await q.query(`DROP INDEX IF EXISTS "idx_payments_customer_status"`);
  }
}
