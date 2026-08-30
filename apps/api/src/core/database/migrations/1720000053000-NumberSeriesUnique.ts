import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unique key on number_series (Tier-4C #20). Numbering relies on
 * SELECT … FOR UPDATE to serialise allocations, but that only locks an existing
 * row: two concurrent first-ever documents of a type each find zero rows, lock
 * nothing, and INSERT their own series — a cold-start race that yields duplicate
 * (shadow) series, and the CRUD editor could likewise create two active rows for
 * the same document type. The natural key is
 * (tenant_id, document_type, plant_id, financial_year), and plant_id /
 * financial_year are nullable, so NULLS NOT DISTINCT (Postgres 15+) is required
 * for the null-plant / null-FY case to collide instead of slipping through.
 *
 * The migration preflight checks for pre-existing duplicate groups (grouped with
 * the same null-equal semantics) before this runs, so a live tenant with a stray
 * duplicate surfaces at the deploy gate rather than aborting the migration.
 */
export class NumberSeriesUnique1720000053000 implements MigrationInterface {
  name = 'NumberSeriesUnique1720000053000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE UNIQUE INDEX "uq_number_series_key" ON number_series ` +
        `(tenant_id, document_type, plant_id, financial_year) NULLS NOT DISTINCT`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_number_series_key"`);
  }
}
