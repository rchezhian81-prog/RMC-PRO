import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credit-exposure fix (pilot gap): store the GST-inclusive order value.
 *
 * Credit control previously assessed exposure from `estimated_order_value`,
 * which is ex-GST — understating what the customer actually owes by the GST
 * amount (~18%) and risking a booking passing that should have been held. This
 * adds a nullable `estimated_order_value_incl_gst` populated at draft creation
 * with the same GST logic quotations use, so order value, outstanding and
 * credit-hold logic all reconcile.
 *
 * Additive + reversible: the column is nullable and the credit code falls back
 * to `estimated_order_value` for any legacy row where it is null, so no backfill
 * is required. `down()` drops the column.
 */
export class OrderValueInclGst1720000043000 implements MigrationInterface {
  name = 'OrderValueInclGst1720000043000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" ADD COLUMN "estimated_order_value_incl_gst" numeric(16,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN "estimated_order_value_incl_gst"`);
  }
}
