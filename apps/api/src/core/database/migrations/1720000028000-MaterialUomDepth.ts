import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Material & UOM master depth (Plan A1). Deepens the material master with the
 * batching properties A2 needs (type, specific gravity, bulk density, aggregate
 * water-absorption and default free-moisture), and introduces a proper unit
 * master (`uoms`) plus a pairwise conversion table (`uom_conversions`) to
 * replace free-text units. Both new tables are tenant-scoped under the same
 * FORCE-RLS, NULLIF-guarded policy as the other tenant tables.
 *
 * Additive and reversible: `down()` drops the tables and the added columns.
 */
export class MaterialUomDepth1720000028000 implements MigrationInterface {
  name = 'MaterialUomDepth1720000028000';

  private tenantPolicy(table: string): string {
    return `
      CREATE POLICY tenant_isolation ON ${table}
        USING (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        )
        WITH CHECK (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        );`;
  }

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');

    await q.query(`
      ALTER TABLE materials
        ADD COLUMN material_type varchar,
        ADD COLUMN specific_gravity numeric(6,3),
        ADD COLUMN bulk_density numeric(10,3),
        ADD COLUMN water_absorption_pct numeric(6,3),
        ADD COLUMN default_moisture_pct numeric(6,3);
    `);

    await q.query(`
      CREATE TABLE uoms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        uom_code varchar NOT NULL,
        uom_name varchar NOT NULL,
        uom_category varchar,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_uoms_code UNIQUE (tenant_id, uom_code)
      );
    `);
    await q.query(`
      CREATE TABLE uom_conversions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        from_uom varchar NOT NULL,
        to_uom varchar NOT NULL,
        factor numeric(18,6) NOT NULL,
        CONSTRAINT uq_uom_conversions UNIQUE (tenant_id, from_uom, to_uom)
      );
    `);

    for (const t of ['uoms', 'uom_conversions']) {
      await q.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await q.query(this.tenantPolicy(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS uom_conversions CASCADE;`);
    await q.query(`DROP TABLE IF EXISTS uoms CASCADE;`);
    await q.query(`
      ALTER TABLE materials
        DROP COLUMN IF EXISTS material_type,
        DROP COLUMN IF EXISTS specific_gravity,
        DROP COLUMN IF EXISTS bulk_density,
        DROP COLUMN IF EXISTS water_absorption_pct,
        DROP COLUMN IF EXISTS default_moisture_pct;
    `);
  }
}
