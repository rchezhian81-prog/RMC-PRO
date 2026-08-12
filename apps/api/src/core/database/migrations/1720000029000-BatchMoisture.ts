import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Batch moisture correction (Plan A2). Records, per batch-ticket material, the
 * snapshot batching properties (material_type, water_absorption_pct), the
 * moisture used (measured_moisture_pct), and the moisture-corrected batch weight
 * (corrected_target_quantity) with the free surface water it carries
 * (free_water_quantity). All nullable and additive — existing tickets keep their
 * SSD targets. Reversible: `down()` drops the columns.
 */
export class BatchMoisture1720000029000 implements MigrationInterface {
  name = 'BatchMoisture1720000029000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE batch_ticket_materials
        ADD COLUMN material_type varchar,
        ADD COLUMN water_absorption_pct numeric(6,3),
        ADD COLUMN measured_moisture_pct numeric(6,3),
        ADD COLUMN corrected_target_quantity numeric(14,3),
        ADD COLUMN free_water_quantity numeric(14,3);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE batch_ticket_materials
        DROP COLUMN IF EXISTS material_type,
        DROP COLUMN IF EXISTS water_absorption_pct,
        DROP COLUMN IF EXISTS measured_moisture_pct,
        DROP COLUMN IF EXISTS corrected_target_quantity,
        DROP COLUMN IF EXISTS free_water_quantity;
    `);
  }
}
