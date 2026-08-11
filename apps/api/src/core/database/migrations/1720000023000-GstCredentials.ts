import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-tenant GST-portal (IRP / e-way) API credentials — the last hard blocker for
 * the live e-invoice adapter (`resolveTenantCreds`). One row per seller GSTIN.
 *
 * The portal password is stored ONLY as AES-256-GCM ciphertext (iv + ciphertext +
 * auth tag + key version); the master key lives solely in `GST_CRED_ENC_KEY` and
 * never touches this table. Tenant-scoped under FORCE RLS with the same
 * NULLIF-guarded clause as the other tenant tables, so a query that forgets the
 * tenant context returns nothing rather than leaking another tenant's secret.
 *
 * The app role gets full DML (SELECT/INSERT/UPDATE/DELETE) — a tenant admin
 * creates/updates/removes their own credential. Reversible: `down()` drops it.
 */
export class GstCredentials1720000023000 implements MigrationInterface {
  name = 'GstCredentials1720000023000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    await q.query(`
      CREATE TABLE tenant_gst_credentials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        gstin varchar(15) NOT NULL,
        portal_username varchar NOT NULL,
        key_version int NOT NULL,
        password_iv varchar NOT NULL,
        password_ciphertext text NOT NULL,
        password_auth_tag varchar NOT NULL,
        last_tested_at timestamptz,
        last_test_success boolean,
        last_test_message varchar,
        CONSTRAINT uq_tenant_gst_credentials UNIQUE (tenant_id, gstin)
      );
    `);
    await q.query(`CREATE INDEX idx_tenant_gst_credentials_tenant ON tenant_gst_credentials (tenant_id);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_gst_credentials TO ${appUser};`);
    await q.query(`ALTER TABLE tenant_gst_credentials ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE tenant_gst_credentials FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON tenant_gst_credentials
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
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON tenant_gst_credentials;`);
    await q.query(`ALTER TABLE tenant_gst_credentials NO FORCE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE tenant_gst_credentials DISABLE ROW LEVEL SECURITY;`);
    await q.query(`DROP TABLE IF EXISTS tenant_gst_credentials;`);
  }
}
