import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial-unique backstops for the concurrency guards added in Tier-1A (row
 * locks). The locks serialise racing writers within one process; these indexes
 * make the "at most one live X" invariant true even across processes / a logic
 * bug, and each is partial so a cancelled row frees the slot to be re-created.
 *
 *  - delivery_challans(dispatch_id): one live challan per dispatch — a second
 *    would double the billable candidates for the same load.
 *  - batch_queue(order_item_id): one live queue entry per order line — the order
 *    path already dedupes; the plan path (and any race) is backstopped here.
 *  - vendor_bills(tenant_id, supplier_id, supplier_bill_no): one live bill per
 *    supplier invoice number — the double-payable / double-ITC guard.
 *
 * The migration preflight checks each table for pre-existing duplicate groups
 * (declared in integrity-constraints.ts) before this runs, so a live tenant with
 * a stray duplicate surfaces at the deploy gate rather than aborting the CREATE.
 */
export class ConcurrencyUniqueIndexes1720000055000 implements MigrationInterface {
  name = 'ConcurrencyUniqueIndexes1720000055000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE UNIQUE INDEX "uq_delivery_challans_dispatch" ON delivery_challans (dispatch_id) ` +
        `WHERE dispatch_id IS NOT NULL AND challan_status <> 'cancelled'`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_batch_queue_order_item" ON batch_queue (order_item_id) ` +
        `WHERE order_item_id IS NOT NULL AND queue_status <> 'cancelled'`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_vendor_bills_supplier_billno" ON vendor_bills (tenant_id, supplier_id, supplier_bill_no) ` +
        `WHERE supplier_bill_no IS NOT NULL AND status <> 'cancelled'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_vendor_bills_supplier_billno"`);
    await q.query(`DROP INDEX IF EXISTS "uq_batch_queue_order_item"`);
    await q.query(`DROP INDEX IF EXISTS "uq_delivery_challans_dispatch"`);
  }
}
