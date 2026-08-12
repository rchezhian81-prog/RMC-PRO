import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Excel / CSV bulk import framework (Plan F1). One tenant-scoped table,
 * `import_jobs`, tracking each bulk-load run (entity type, success / error
 * counts, per-row errors as jsonb) under the same FORCE-RLS, NULLIF-guarded
 * policy as the rest of the schema. Reversible: `down()` drops the table.
 */
export class ImportJobs1720000040000 implements MigrationInterface {
  name = 'ImportJobs1720000040000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');

    await q.query(`
      CREATE TABLE import_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        entity_type varchar NOT NULL,
        file_name varchar,
        status varchar NOT NULL DEFAULT 'completed',
        total_rows int NOT NULL DEFAULT 0,
        success_count int NOT NULL DEFAULT 0,
        error_count int NOT NULL DEFAULT 0,
        errors jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_by uuid
      );
    `);

    await q.query(`CREATE INDEX idx_import_jobs_tenant ON import_jobs (tenant_id);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs TO ${appUser};`);
    await q.query(`ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON import_jobs
        USING (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        )
        WITH CHECK (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        );
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS import_jobs CASCADE;`);
  }
}
