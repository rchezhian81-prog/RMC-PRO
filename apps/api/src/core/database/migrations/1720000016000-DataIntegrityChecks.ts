import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Defense-in-depth DB integrity (roadmap Wave 2, gap G9/R12). The app already
 * validates these, but nothing at the database stopped a bug (or a raw write)
 * from persisting a negative amount or a vehicle pointing at a non-existent
 * driver. This adds:
 *
 *  - non-negative CHECK constraints on the columns where a negative value is
 *    unambiguously invalid (money totals, tax amounts, rates, line quantities,
 *    credit limits, capacities); and
 *  - the missing vehicles.driver_id -> drivers(id) foreign key.
 *
 * Deliberately EXCLUDED because negative is a legitimate value there:
 *   - invoices.round_off (rounding can go either way),
 *   - invoices.outstanding_amount (can go negative on an overpayment),
 *   - stock_balances.current_quantity and stock_transactions.quantity (negative
 *     stock is an APPROVED feature; ledger deltas are signed).
 *
 * Safe failure mode: if any existing row violated a new constraint, the ALTER
 * fails and the deploy's migrate step aborts (with the pre-redeploy backup
 * already taken) — it never corrupts or drops data. Reversible via down().
 */
export class DataIntegrityChecks1720000016000 implements MigrationInterface {
  name = 'DataIntegrityChecks1720000016000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE invoices ADD CONSTRAINT chk_invoices_nonneg CHECK (
      taxable_amount >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0
      AND cess_amount >= 0 AND total_amount >= 0 AND amount_paid >= 0)`);
    await q.query(`ALTER TABLE invoice_items ADD CONSTRAINT chk_invoice_items_nonneg CHECK (
      quantity >= 0 AND rate >= 0 AND taxable_amount >= 0 AND gst_rate >= 0
      AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0 AND cess_amount >= 0
      AND line_total >= 0)`);
    await q.query(`ALTER TABLE payments ADD CONSTRAINT chk_payments_nonneg CHECK (
      amount >= 0 AND allocated_amount >= 0 AND unallocated_amount >= 0)`);
    await q.query(`ALTER TABLE payment_allocations ADD CONSTRAINT chk_payment_allocations_nonneg CHECK (
      allocated_amount >= 0)`);
    await q.query(`ALTER TABLE customers ADD CONSTRAINT chk_customers_nonneg CHECK (
      credit_limit >= 0 AND credit_days >= 0)`);
    await q.query(`ALTER TABLE materials ADD CONSTRAINT chk_materials_nonneg CHECK (
      minimum_stock >= 0 AND reorder_level >= 0 AND standard_rate >= 0)`);
    await q.query(`ALTER TABLE vehicles ADD CONSTRAINT chk_vehicles_nonneg CHECK (capacity_m3 >= 0)`);

    // Vehicle -> driver referential integrity (was unenforced). SET NULL so
    // removing a driver just unlinks the vehicle rather than blocking the delete.
    await q.query(`ALTER TABLE vehicles ADD CONSTRAINT fk_vehicles_driver
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS fk_vehicles_driver`);
    await q.query(`ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS chk_vehicles_nonneg`);
    await q.query(`ALTER TABLE materials DROP CONSTRAINT IF EXISTS chk_materials_nonneg`);
    await q.query(`ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customers_nonneg`);
    await q.query(`ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS chk_payment_allocations_nonneg`);
    await q.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_nonneg`);
    await q.query(`ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS chk_invoice_items_nonneg`);
    await q.query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_nonneg`);
  }
}
