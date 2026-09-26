import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase-2 close-out: the four pieces that turn the catalogue's "partial" rows
 * into working features without an outside party.
 *
 *   1. Driver phone screen — `drivers.user_id` links a driver record to a login,
 *      so "My Trips" can show a driver exactly the deliveries assigned to them.
 *   2. Pump management — `pump_jobs`: a pump booked to an order/site, its
 *      operator, on-site / pumping / done times, pumped m³, pump hours and the
 *      charge worked out from the job's basis.
 *   3. WhatsApp Business (Meta Cloud API) — `tenant_whatsapp_credentials`: one
 *      row per tenant holding the phone-number id and the access token sealed
 *      with AES-256-GCM (same master key as the GST credentials, GST_CRED_ENC_KEY).
 *   4. GPS vendor feed — `gps_ingest_keys` (a per-tenant API key, stored as a
 *      SHA-256 hash, that a tracking vendor posts positions with) plus the last
 *      known position on `vehicles` so an idle truck is still on the map, and
 *      `vehicles.gps_device_id` so a vendor can post by IMEI instead of number.
 *
 * Every new tenant table is under the same FORCE-RLS, NULLIF-guarded policy as
 * the rest of the schema. Reversible: `down()` drops the tables and columns.
 */
export class DriverPumpWhatsAppGps1720000073000 implements MigrationInterface {
  name = 'DriverPumpWhatsAppGps1720000073000';

  private readonly tables = ['pump_jobs', 'tenant_whatsapp_credentials', 'gps_ingest_keys'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    // 1. Driver ↔ login.
    await q.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_user ON drivers (tenant_id, user_id) WHERE user_id IS NOT NULL`);

    // 4. Vehicle: device id + last known position (vendor feed / driver phone).
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gps_device_id varchar`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_latitude numeric(10,6)`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_longitude numeric(10,6)`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_location_at timestamptz`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_speed_kmph numeric(6,2)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_gps_device ON vehicles (tenant_id, upper(gps_device_id)) WHERE gps_device_id IS NOT NULL`);

    // 2. Pump jobs.
    await q.query(`
      CREATE TABLE IF NOT EXISTS pump_jobs (
        ${base},
        job_no varchar NOT NULL,
        order_id uuid REFERENCES orders(id),
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        pump_vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        operator_driver_id uuid REFERENCES drivers(id),
        scheduled_date date,
        scheduled_time varchar,
        arrived_at timestamptz,
        pumping_start_at timestamptz,
        pumping_end_at timestamptz,
        pumped_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        pump_hours numeric(8,2) NOT NULL DEFAULT 0,
        pipeline_length_m numeric(8,1),
        charge_basis varchar NOT NULL DEFAULT 'per_m3',
        rate numeric(14,2) NOT NULL DEFAULT 0,
        charge_amount numeric(16,2) NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'planned',
        remarks varchar,
        created_by uuid,
        CONSTRAINT uq_pump_jobs_no UNIQUE (tenant_id, job_no)
      );
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_pump_jobs_vehicle ON pump_jobs (pump_vehicle_id);`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_pump_jobs_order ON pump_jobs (order_id);`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_pump_jobs_date ON pump_jobs (tenant_id, scheduled_date);`);

    // 3. WhatsApp Business credentials — one per tenant.
    await q.query(`
      CREATE TABLE IF NOT EXISTS tenant_whatsapp_credentials (
        ${base},
        provider varchar NOT NULL DEFAULT 'meta',
        phone_number_id varchar NOT NULL,
        business_number varchar,
        key_version int NOT NULL,
        token_iv varchar NOT NULL,
        token_ciphertext text NOT NULL,
        token_auth_tag varchar NOT NULL,
        template_name varchar,
        template_language varchar NOT NULL DEFAULT 'en',
        last_tested_at timestamptz,
        last_test_success boolean,
        last_test_message varchar,
        CONSTRAINT uq_tenant_whatsapp_credentials UNIQUE (tenant_id)
      );
    `);

    // 4. GPS vendor ingest keys.
    await q.query(`
      CREATE TABLE IF NOT EXISTS gps_ingest_keys (
        ${base},
        key_hash varchar NOT NULL,
        key_hint varchar NOT NULL,
        label varchar,
        created_by uuid,
        last_used_at timestamptz,
        revoked_at timestamptz,
        CONSTRAINT uq_gps_ingest_keys_hash UNIQUE (key_hash)
      );
    `);

    for (const t of this.tables) {
      await q.query(`CREATE INDEX IF NOT EXISTS idx_${t}_tenant ON ${t} (tenant_id);`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
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
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
    await q.query(`DROP INDEX IF EXISTS uq_vehicles_gps_device`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS last_speed_kmph`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS last_location_at`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS last_longitude`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS last_latitude`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS gps_device_id`);
    await q.query(`DROP INDEX IF EXISTS uq_drivers_user`);
    await q.query(`ALTER TABLE drivers DROP COLUMN IF EXISTS user_id`);
  }
}
