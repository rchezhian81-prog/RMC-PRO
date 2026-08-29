import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Returned-concrete billing policy on the order (Tier 5B).
 *
 * A delivery challan can come back with returned m³ (short pour / rejected at
 * site), but invoicing billed the full loaded quantity regardless — over-billing
 * the customer for concrete they never received, and disagreeing with the
 * delivery register (which already nets returns). These columns let each order
 * choose the policy: 'net' (poured only, the default), 'gross' (full load), or
 * 'net_plus_fee' (poured + a return charge of return_fee_per_m3 × returned m³).
 *
 * Additive + safe: both columns have defaults ('net' / 0) so existing orders
 * keep today's-intent net billing with no backfill. down() drops them.
 */
export class OrderReturnBilling1720000046000 implements MigrationInterface {
  name = 'OrderReturnBilling1720000046000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" ADD COLUMN "return_billing_policy" varchar NOT NULL DEFAULT 'net'`);
    await q.query(`ALTER TABLE "orders" ADD COLUMN "return_fee_per_m3" numeric(14,2) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN "return_fee_per_m3"`);
    await q.query(`ALTER TABLE "orders" DROP COLUMN "return_billing_policy"`);
  }
}
