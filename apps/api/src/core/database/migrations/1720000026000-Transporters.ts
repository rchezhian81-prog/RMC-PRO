import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transporter master + invoice link (Gap G18). A tenant-scoped `transporters`
 * table under the same FORCE-RLS, NULLIF-guarded policy as the other tenant
 * tables, plus a nullable `transporter_id` FK on `invoices` so an invoice can
 * point at a managed transporter. The e-way bill then sources its `TransId`
 * (GST Transporter ID / TRANSIN, or GSTIN) and `TransName` from the master
 * instead of the free-text `transporter_name` column.
 *
 * Reversible: `down()` drops the invoice column, the policy, and the table.
 */
export class Transporters1720000026000 implements MigrationInterface {
  name = 'Transporters1720000026000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    await q.query(`
      CREATE TABLE transporters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        transporter_code varchar NOT NULL,
        transporter_name varchar NOT NULL,
        transin varchar(15),
        gstin varchar,
        contact_person varchar,
        mobile varchar,
        email varchar,
        state varchar,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_transporters_code UNIQUE (tenant_id, transporter_code)
      );
    `);
    await q.query(`CREATE INDEX idx_transporters_tenant ON transporters (tenant_id);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON transporters TO ${appUser};`);
    await q.query(`ALTER TABLE transporters ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE transporters FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON transporters
        USING (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        )
        WITH CHECK (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        );
    `);
    // Link an invoice to a transporter master (nullable → optional).
    await q.query(`ALTER TABLE invoices ADD COLUMN transporter_id uuid REFERENCES transporters(id);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS transporter_id;`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON transporters;`);
    await q.query(`ALTER TABLE transporters NO FORCE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE transporters DISABLE ROW LEVEL SECURITY;`);
    await q.query(`DROP TABLE IF EXISTS transporters CASCADE;`);
  }
}
