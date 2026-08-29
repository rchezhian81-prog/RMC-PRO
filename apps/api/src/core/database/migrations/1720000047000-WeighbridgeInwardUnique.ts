import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One live material inward per weighbridge entry (Tier-A gap A3).
 *
 * A weighbridge entry could be converted to a material inward repeatedly —
 * `toInward` only blocked a cancelled entry — so the same truck's material could
 * be posted to stock more than once. The service now blocks a repeat conversion;
 * this partial unique index is the DB-level guarantee, ignoring cancelled
 * inwards so a mistaken one can be cancelled and re-converted.
 *
 * The preflight (integrity-constraints.ts UNIQUE_CONSTRAINTS) checks live data
 * for duplicate groups before this runs, so the deploy is gated rather than
 * aborting the migrate step. down() drops the index.
 */
export class WeighbridgeInwardUnique1720000047000 implements MigrationInterface {
  name = 'WeighbridgeInwardUnique1720000047000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE UNIQUE INDEX "uq_material_inwards_weighbridge_entry"
         ON "material_inwards" ("weighbridge_entry_id")
       WHERE "weighbridge_entry_id" IS NOT NULL AND status <> 'cancelled'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_material_inwards_weighbridge_entry"`);
  }
}
