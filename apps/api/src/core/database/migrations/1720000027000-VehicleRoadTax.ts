import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fleet compliance (Plan D1). Add `road_tax_expiry` to `vehicles` so road tax
 * joins insurance / fitness (FC) / permit / pollution (PUC) as a tracked
 * renewal document; the AlertsService warns before any of them lapse.
 *
 * Nullable, no backfill needed. Reversible: `down()` drops the column.
 */
export class VehicleRoadTax1720000027000 implements MigrationInterface {
  name = 'VehicleRoadTax1720000027000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE vehicles ADD COLUMN road_tax_expiry date;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS road_tax_expiry;`);
  }
}
