import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Read-path index for the money reports that filter payments by receipt date.
 *
 * receiptsRegister and cashBankDayBook bound a tenant's payments to a
 * [from, to] receipt_date range. payments carried only a tenant_id index and
 * (customer_id, status) (added in PerformanceIndexes), so a date-bounded scan of
 * a tenant's receipts had no supporting index and seq-scanned the tenant's rows.
 *
 * Plain (non-unique) index — it changes no behaviour and never aborts on
 * existing data, so there is no integrity-constraints.ts entry to add (the
 * drift guard only tracks CHECK/FK/partial-UNIQUE constraints).
 */
export class PaymentsReceiptDateIndex1720000058000 implements MigrationInterface {
  name = 'PaymentsReceiptDateIndex1720000058000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX "idx_payments_receipt_date" ON payments (tenant_id, receipt_date)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_payments_receipt_date"`);
  }
}
