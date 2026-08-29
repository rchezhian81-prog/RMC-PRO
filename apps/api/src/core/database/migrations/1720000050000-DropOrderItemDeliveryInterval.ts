import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the dead order_items.delivery_interval_minutes column.
 *
 * It was created with the sales schema but never written or read anywhere in the
 * API or web — no form sets it, no service or report references it. The delivery
 * cadence between trucks is expressed on the pour schedule (truck_spacing_minutes
 * on pour_schedule_slots), which is the column actually used. Removing the unused
 * column keeps the order-item shape honest.
 *
 * down() re-adds it as a nullable integer (its original shape); no data is
 * restored because none was ever stored.
 */
export class DropOrderItemDeliveryInterval1720000050000 implements MigrationInterface {
  name = 'DropOrderItemDeliveryInterval1720000050000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "order_items" DROP COLUMN IF EXISTS "delivery_interval_minutes"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "order_items" ADD COLUMN "delivery_interval_minutes" integer`);
  }
}
