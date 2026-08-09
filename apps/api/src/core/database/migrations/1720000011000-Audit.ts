import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audit trail (Design Doc — B18). One tenant-scoped, append-only table.
 *
 * The security property lives in the GRANT: the app role gets SELECT and INSERT
 * and nothing else. With no UPDATE or DELETE privilege, neither a bug nor a
 * compromised application can rewrite history — only the migration/owner role
 * (used for schema and backups) could, and it does not run at request time.
 */
export class Audit1720000011000 implements MigrationInterface {
  name = 'Audit1720000011000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');

    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        actor_user_id uuid,
        actor_email varchar,
        actor_name varchar,
        action varchar NOT NULL,
        entity_type varchar,
        entity_id uuid,
        entity_label varchar,
        summary varchar NOT NULL,
        details jsonb,
        ip_address varchar
      );
    `);

    // Append-only: read the trail, write to the trail, never change or erase it.
    await q.query(`GRANT SELECT, INSERT ON audit_logs TO ${appUser};`);
    await q.query(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON audit_logs
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    `);

    // Newest-first per tenant for the trail view; by-entity for one record's history.
    await q.query(`CREATE INDEX idx_audit_logs_tenant_time ON audit_logs (tenant_id, created_at DESC);`);
    await q.query(`CREATE INDEX idx_audit_logs_entity ON audit_logs (tenant_id, entity_type, entity_id);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_logs CASCADE;`);
  }
}
