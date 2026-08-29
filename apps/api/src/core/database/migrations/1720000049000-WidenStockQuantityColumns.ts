import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen stock-quantity / capacity columns int → numeric(_,3): stop truncating
 * fractional units.
 *
 * materials.minimum_stock, materials.reorder_level and vehicles.capacity_m3 were
 * integer, so a reorder level of 2.5 tonnes, a minimum stock with a fractional
 * unit, or a mixer rated 7.5 m³ lost its fraction on save — the same paise-loss
 * problem the money columns had, one dimension over. Quantities/capacity belong
 * in numeric(_,3) like every other m³/quantity column in the schema.
 *
 * Additive + safe: int values cast to numeric exactly (no rounding, no backfill).
 * down() narrows back to integer, rounding to the nearest whole unit (the only
 * lossy direction), so it stays reversible.
 */
export class WidenStockQuantityColumns1720000049000 implements MigrationInterface {
  name = 'WidenStockQuantityColumns1720000049000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "materials" ALTER COLUMN "minimum_stock" TYPE numeric(14,3)`);
    await q.query(`ALTER TABLE "materials" ALTER COLUMN "reorder_level" TYPE numeric(14,3)`);
    await q.query(`ALTER TABLE "vehicles" ALTER COLUMN "capacity_m3" TYPE numeric(8,3)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "materials" ALTER COLUMN "minimum_stock" TYPE integer USING round("minimum_stock")`);
    await q.query(`ALTER TABLE "materials" ALTER COLUMN "reorder_level" TYPE integer USING round("reorder_level")`);
    await q.query(`ALTER TABLE "vehicles" ALTER COLUMN "capacity_m3" TYPE integer USING round("capacity_m3")`);
  }
}
