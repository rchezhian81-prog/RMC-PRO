import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Weighbridge hardware bridge (Plan E1). Adds a `weighbridge_indicators` config
 * table (the scale head reachable over serial/COM or TCP) under the same
 * FORCE-RLS, NULLIF-guarded policy as the rest of the schema, and three
 * provenance columns on `weighbridge_entries` so a captured weight records
 * whether it came off the device or was hand-keyed. Reversible: `down()` drops
 * the columns and the table.
 */
export class WeighbridgeIndicator1720000035000 implements MigrationInterface {
  name = 'WeighbridgeIndicator1720000035000';

  private readonly tables = ['weighbridge_indicators'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await q.query(`
      CREATE TABLE weighbridge_indicators (
        ${base},
        name varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        connection_type varchar NOT NULL DEFAULT 'simulated',
        host varchar,
        port int,
        com_port varchar,
        baud_rate int,
        unit varchar NOT NULL DEFAULT 'kg',
        simulated_weight_kg numeric(16,3),
        is_active boolean NOT NULL DEFAULT true,
        CONSTRAINT uq_weighbridge_indicators_name UNIQUE (tenant_id, name)
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

    // Provenance of the weights on an entry (device read vs hand-keyed).
    await q.query(`ALTER TABLE weighbridge_entries ADD COLUMN weight_source varchar NOT NULL DEFAULT 'manual';`);
    await q.query(`ALTER TABLE weighbridge_entries ADD COLUMN indicator_id uuid;`);
    await q.query(`ALTER TABLE weighbridge_entries ADD COLUMN manual_override boolean NOT NULL DEFAULT false;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE weighbridge_entries DROP COLUMN IF EXISTS manual_override;`);
    await q.query(`ALTER TABLE weighbridge_entries DROP COLUMN IF EXISTS indicator_id;`);
    await q.query(`ALTER TABLE weighbridge_entries DROP COLUMN IF EXISTS weight_source;`);
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
