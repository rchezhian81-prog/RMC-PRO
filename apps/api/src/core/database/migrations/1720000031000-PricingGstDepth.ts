import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pricing & GST depth (Plan B2). Carry a real GST rate on quotation, rate-contract
 * and order line items (previously only a per-line gst_applicable boolean), so the
 * CGST/SGST/IGST breakup is known at quote/order time and reconciles at invoice.
 * Also records the pricing type (cash vs credit) on quotations and orders.
 *
 * Additive and reversible: `down()` drops the columns. Existing rows default to
 * an 18% rate and the 'credit' pricing type.
 */
export class PricingGstDepth1720000031000 implements MigrationInterface {
  name = 'PricingGstDepth1720000031000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE quotation_items ADD COLUMN gst_rate numeric(5,2) NOT NULL DEFAULT 18;`);
    await q.query(`ALTER TABLE rate_contract_items ADD COLUMN gst_rate numeric(5,2) NOT NULL DEFAULT 18;`);
    await q.query(`ALTER TABLE order_items ADD COLUMN gst_rate numeric(5,2) NOT NULL DEFAULT 18;`);
    await q.query(`ALTER TABLE quotations ADD COLUMN pricing_type varchar NOT NULL DEFAULT 'credit';`);
    await q.query(`ALTER TABLE orders ADD COLUMN pricing_type varchar NOT NULL DEFAULT 'credit';`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE orders DROP COLUMN IF EXISTS pricing_type;`);
    await q.query(`ALTER TABLE quotations DROP COLUMN IF EXISTS pricing_type;`);
    await q.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS gst_rate;`);
    await q.query(`ALTER TABLE rate_contract_items DROP COLUMN IF EXISTS gst_rate;`);
    await q.query(`ALTER TABLE quotation_items DROP COLUMN IF EXISTS gst_rate;`);
  }
}
