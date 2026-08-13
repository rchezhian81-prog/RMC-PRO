import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GPS tracking (activate the `gps` module). Adds a `dispatch_location_pings`
 * table (the truck's position over time for an in-transit dispatch) under the
 * same FORCE-RLS, NULLIF-guarded policy as the rest of the schema, plus the
 * denormalised latest fix on `dispatches` (last_latitude / last_longitude /
 * last_location_at / last_speed_kmph) so the board reads without a subquery.
 * Reversible: `down()` drops the columns and the table.
 */
export class GpsTracking1720000042000 implements MigrationInterface {
  name = 'GpsTracking1720000042000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');

    await q.query(`
      CREATE TABLE dispatch_location_pings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        dispatch_id uuid NOT NULL REFERENCES dispatches(id),
        vehicle_id uuid REFERENCES vehicles(id),
        latitude numeric(10,6) NOT NULL,
        longitude numeric(10,6) NOT NULL,
        speed_kmph numeric(6,2),
        heading numeric(6,2),
        accuracy_m numeric(8,2),
        source varchar NOT NULL DEFAULT 'device',
        recorded_at timestamptz
      );
    `);

    await q.query(`CREATE INDEX idx_dispatch_location_pings_tenant ON dispatch_location_pings (tenant_id);`);
    await q.query(`CREATE INDEX idx_dispatch_location_pings_dispatch ON dispatch_location_pings (dispatch_id);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON dispatch_location_pings TO ${appUser};`);
    await q.query(`ALTER TABLE dispatch_location_pings ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE dispatch_location_pings FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON dispatch_location_pings
        USING (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        )
        WITH CHECK (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        );
    `);

    await q.query(`ALTER TABLE dispatches ADD COLUMN last_latitude numeric(10,6);`);
    await q.query(`ALTER TABLE dispatches ADD COLUMN last_longitude numeric(10,6);`);
    await q.query(`ALTER TABLE dispatches ADD COLUMN last_location_at timestamptz;`);
    await q.query(`ALTER TABLE dispatches ADD COLUMN last_speed_kmph numeric(6,2);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE dispatches DROP COLUMN IF EXISTS last_speed_kmph;`);
    await q.query(`ALTER TABLE dispatches DROP COLUMN IF EXISTS last_location_at;`);
    await q.query(`ALTER TABLE dispatches DROP COLUMN IF EXISTS last_longitude;`);
    await q.query(`ALTER TABLE dispatches DROP COLUMN IF EXISTS last_latitude;`);
    await q.query(`DROP TABLE IF EXISTS dispatch_location_pings CASCADE;`);
  }
}
