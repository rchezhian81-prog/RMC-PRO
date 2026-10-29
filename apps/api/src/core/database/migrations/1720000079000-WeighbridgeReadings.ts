import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indicator-only weighing.
 *
 * Every weight an indicator gives is logged (`weighbridge_readings`: the
 * indicator, the kg, whether the reading was stable, when, and who asked).
 * With the tenant setting `weighbridge.indicator_only` on, a slip only takes
 * a weight that matches one of those readings from the last few minutes, so
 * a figure cannot be typed, edited or invented at the gate. The log is pruned
 * to two days on each read. Same FORCE-RLS policy as every tenant table.
 */
export class WeighbridgeReadings1720000079000 implements MigrationInterface {
  name = 'WeighbridgeReadings1720000079000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    await q.query(`
      CREATE TABLE IF NOT EXISTS weighbridge_readings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        indicator_id uuid NOT NULL,
        weight_kg numeric(16,3) NOT NULL,
        stable boolean NOT NULL DEFAULT true,
        read_at timestamptz NOT NULL DEFAULT now(),
        user_id uuid
      );
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_weighbridge_readings_tenant ON weighbridge_readings (tenant_id);`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_weighbridge_readings_recent ON weighbridge_readings (tenant_id, indicator_id, read_at DESC);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON weighbridge_readings TO ${appUser};`);
    await q.query(`ALTER TABLE weighbridge_readings ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE weighbridge_readings FORCE ROW LEVEL SECURITY;`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON weighbridge_readings;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON weighbridge_readings
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
    await q.query(`DROP TABLE IF EXISTS weighbridge_readings`);
  }
}
