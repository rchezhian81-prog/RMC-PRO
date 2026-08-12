import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Batching Integration (Plan A4). Adds a `batching_controllers` config table
 * (the plant batching controller the actuals report is fetched from) under the
 * same FORCE-RLS, NULLIF-guarded policy as the rest of the schema, plus three
 * ingest-provenance columns on `batch_tickets` (which controller, its batch
 * reference, and when the actuals were ingested). Reversible: `down()` drops
 * the columns and the table.
 */
export class BatchingIntegration1720000036000 implements MigrationInterface {
  name = 'BatchingIntegration1720000036000';

  private readonly tables = ['batching_controllers'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await q.query(`
      CREATE TABLE batching_controllers (
        ${base},
        name varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        connection_type varchar NOT NULL DEFAULT 'simulated',
        host varchar,
        port int,
        log_path varchar,
        make varchar,
        is_active boolean NOT NULL DEFAULT true,
        CONSTRAINT uq_batching_controllers_name UNIQUE (tenant_id, name)
      );
    `);

    for (const t of this.tables) {
      await q.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await q.query(`
        CREATE POLICY tenant_isolation ON ${t}
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

    await q.query(`ALTER TABLE batch_tickets ADD COLUMN controller_id uuid;`);
    await q.query(`ALTER TABLE batch_tickets ADD COLUMN controller_batch_ref varchar;`);
    await q.query(`ALTER TABLE batch_tickets ADD COLUMN ingested_at timestamptz;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE batch_tickets DROP COLUMN IF EXISTS ingested_at;`);
    await q.query(`ALTER TABLE batch_tickets DROP COLUMN IF EXISTS controller_batch_ref;`);
    await q.query(`ALTER TABLE batch_tickets DROP COLUMN IF EXISTS controller_id;`);
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
