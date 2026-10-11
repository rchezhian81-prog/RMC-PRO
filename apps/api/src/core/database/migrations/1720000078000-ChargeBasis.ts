import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A basis for each charge on a priced line.
 *
 * Transport, pump and waiting were always per m³, folded into one all-in
 * rate. A quotation, rate contract or order line may now say transport is
 * per trip or a lump sum, pumping is per job or per pump hour, and waiting
 * is per hour on site. Everything defaults to per m³, so existing lines
 * read exactly as before.
 *
 * An invoice line records what it bills (`charge_type`: concrete, or a
 * transport / pump / waiting charge added from the order terms) and which
 * order it bills for, so a once-per-order charge is never added twice. A
 * pump job remembers the invoice line that billed its hours, released when
 * that invoice is cancelled.
 */
export class ChargeBasis1720000078000 implements MigrationInterface {
  name = 'ChargeBasis1720000078000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['quotation_items', 'rate_contract_items', 'order_items']) {
      await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS transport_basis varchar NOT NULL DEFAULT 'per_m3'`);
      await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS pump_basis varchar NOT NULL DEFAULT 'per_m3'`);
      await q.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS waiting_basis varchar NOT NULL DEFAULT 'per_m3'`);
    }
    await q.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS charge_type varchar`);
    await q.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_id uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_order_charge ON invoice_items (order_id, charge_type) WHERE order_id IS NOT NULL`);
    await q.query(`ALTER TABLE pump_jobs ADD COLUMN IF NOT EXISTS invoice_item_id uuid`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE pump_jobs DROP COLUMN IF EXISTS invoice_item_id`);
    await q.query(`DROP INDEX IF EXISTS idx_invoice_items_order_charge`);
    await q.query(`ALTER TABLE invoice_items DROP COLUMN IF EXISTS order_id`);
    await q.query(`ALTER TABLE invoice_items DROP COLUMN IF EXISTS charge_type`);
    for (const table of ['order_items', 'rate_contract_items', 'quotation_items']) {
      for (const col of ['waiting_basis', 'pump_basis', 'transport_basis']) {
        await q.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${col}`);
      }
    }
  }
}
