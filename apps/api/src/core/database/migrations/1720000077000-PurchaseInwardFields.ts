import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Purchase orders and material inwards, as the buyer and the gate key them.
 *
 * A purchase order line carries a trade discount (a percentage off the rate),
 * and the quantity may be entered in a unit other than the material's own —
 * cement ordered in bags where stock is kept in tonnes. Both the keyed figure
 * and the converted one are stored, so the document still reads as it was
 * typed. The order's grand total is rounded to the whole rupee, with the
 * signed difference kept as `round_off`, exactly as a tax invoice does. The
 * vendor bill raised from the order carries the same discount and round-off.
 *
 * A material inward records the supplier's bill number beside the challan
 * number, who posted it to stock, the quantity as entered (unit + figure),
 * and the supplier's invoice as an attachment (the bytes base64 in a text
 * column, like the company logo — a few hundred KB per load, never listed).
 */
export class PurchaseInwardFields1720000077000 implements MigrationInterface {
  name = 'PurchaseInwardFields1720000077000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS round_off numeric(16,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS discount_pct numeric(6,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS entered_uom varchar`);
    await q.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS entered_quantity numeric(16,3)`);

    await q.query(`ALTER TABLE vendor_bills ADD COLUMN IF NOT EXISTS round_off numeric(16,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE vendor_bill_items ADD COLUMN IF NOT EXISTS discount_pct numeric(6,2) NOT NULL DEFAULT 0`);

    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS supplier_bill_no varchar`);
    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS posted_by_user_id uuid`);
    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS entered_uom varchar`);
    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS entered_quantity numeric(16,3)`);
    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS attachment_name varchar`);
    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS attachment_mime varchar`);
    await q.query(`ALTER TABLE material_inwards ADD COLUMN IF NOT EXISTS attachment_data text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const col of ['attachment_data', 'attachment_mime', 'attachment_name', 'entered_quantity', 'entered_uom', 'posted_by_user_id', 'supplier_bill_no']) {
      await q.query(`ALTER TABLE material_inwards DROP COLUMN IF EXISTS ${col}`);
    }
    await q.query(`ALTER TABLE vendor_bill_items DROP COLUMN IF EXISTS discount_pct`);
    await q.query(`ALTER TABLE vendor_bills DROP COLUMN IF EXISTS round_off`);
    for (const col of ['entered_quantity', 'entered_uom', 'discount_pct']) {
      await q.query(`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS ${col}`);
    }
    await q.query(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS round_off`);
  }
}
