import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 11 hardening: two performance indexes surfaced by the Phase-1
 * database index review.
 *
 *  - users(tenant_id): `users` is the only tenant-scoped table without a
 *    tenant_id index. Every tenant-scoped user lookup (login, listings,
 *    permission joins) filters on tenant_id, so a bare heap scan grows with
 *    the whole platform's user count rather than the tenant's.
 *  - number_series(tenant_id, document_type): the hot document-numbering /
 *    reservation path looks a series up by (tenant_id, document_type) on every
 *    challan / invoice / batch created. The existing single-column tenant
 *    index still scans every series for the tenant; the composite makes it a
 *    direct hit.
 *
 * Indexes only — no data or schema change, and no new GRANT (index access is
 * governed by the table's existing grants). Idempotent via IF NOT EXISTS.
 */
export class Indexes1720000010000 implements MigrationInterface {
  name = 'Indexes1720000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_number_series_lookup ON number_series (tenant_id, document_type);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_number_series_lookup;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_tenant;`);
  }
}
