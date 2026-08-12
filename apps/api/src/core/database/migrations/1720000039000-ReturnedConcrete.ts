import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Returned / short-load concrete & wastage (Plan B3). The returned quantity was
 * already captured on `dispatches` / `delivery_challans`; this adds the reason it
 * came back and the valuation of that wasted concrete:
 *   - `dispatches.return_reason`
 *   - `delivery_challans.return_reason` + `return_cost_per_m3` + `return_cost`
 * Column-only, no new tables (both tables already carry the RLS policy).
 * Reversible: `down()` drops the added columns.
 */
export class ReturnedConcrete1720000039000 implements MigrationInterface {
  name = 'ReturnedConcrete1720000039000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE dispatches ADD COLUMN return_reason varchar;`);
    await q.query(`ALTER TABLE delivery_challans ADD COLUMN return_reason varchar;`);
    await q.query(`ALTER TABLE delivery_challans ADD COLUMN return_cost_per_m3 numeric(14,2) NOT NULL DEFAULT 0;`);
    await q.query(`ALTER TABLE delivery_challans ADD COLUMN return_cost numeric(16,2) NOT NULL DEFAULT 0;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE delivery_challans DROP COLUMN IF EXISTS return_cost;`);
    await q.query(`ALTER TABLE delivery_challans DROP COLUMN IF EXISTS return_cost_per_m3;`);
    await q.query(`ALTER TABLE delivery_challans DROP COLUMN IF EXISTS return_reason;`);
    await q.query(`ALTER TABLE dispatches DROP COLUMN IF EXISTS return_reason;`);
  }
}
