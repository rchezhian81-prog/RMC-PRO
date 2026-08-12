import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Document correction / amendment trail (Plan F2). One tenant-scoped table,
 * `document_corrections`, logging edits to posted documents (field, old → new
 * value, reason, corrected-by) under the same FORCE-RLS, NULLIF-guarded policy
 * as the rest of the schema. Reversible: `down()` drops the table.
 */
export class DocumentCorrections1720000041000 implements MigrationInterface {
  name = 'DocumentCorrections1720000041000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');

    await q.query(`
      CREATE TABLE document_corrections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        document_type varchar NOT NULL,
        document_id uuid NOT NULL,
        document_label varchar,
        field varchar NOT NULL,
        old_value varchar,
        new_value varchar,
        reason varchar,
        corrected_by uuid
      );
    `);

    await q.query(`CREATE INDEX idx_document_corrections_tenant ON document_corrections (tenant_id);`);
    await q.query(`CREATE INDEX idx_document_corrections_doc ON document_corrections (document_type, document_id);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON document_corrections TO ${appUser};`);
    await q.query(`ALTER TABLE document_corrections ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE document_corrections FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON document_corrections
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
    await q.query(`DROP TABLE IF EXISTS document_corrections CASCADE;`);
  }
}
