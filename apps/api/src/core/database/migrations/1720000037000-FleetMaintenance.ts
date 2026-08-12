import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fleet maintenance & fuel log (Plan D3). Three tenant-scoped tables under the
 * same FORCE-RLS, NULLIF-guarded policy as the rest of the schema:
 *   - `vehicle_service_schedules` — preventive service plan per vehicle + type.
 *   - `vehicle_maintenance_jobs`  — service / repair / breakdown events + cost.
 *   - `vehicle_fuel_logs`         — diesel fills, with computed km/litre.
 * Each references `vehicles(id)`; a maintenance job optionally references its
 * schedule. Reversible: `down()` drops the three tables.
 */
export class FleetMaintenance1720000037000 implements MigrationInterface {
  name = 'FleetMaintenance1720000037000';

  private readonly tables = ['vehicle_service_schedules', 'vehicle_maintenance_jobs', 'vehicle_fuel_logs'];

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await q.query(`
      CREATE TABLE vehicle_service_schedules (
        ${base},
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        service_type varchar NOT NULL,
        interval_km int,
        interval_days int,
        last_service_odometer numeric(12,1),
        last_service_date date,
        next_due_odometer numeric(12,1),
        next_due_date date,
        is_active boolean NOT NULL DEFAULT true,
        remarks varchar
      );
    `);

    await q.query(`
      CREATE TABLE vehicle_maintenance_jobs (
        ${base},
        job_no varchar NOT NULL,
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        schedule_id uuid REFERENCES vehicle_service_schedules(id),
        job_type varchar NOT NULL DEFAULT 'service',
        reported_date date,
        completed_date date,
        odometer numeric(12,1),
        vendor_name varchar,
        labour_cost numeric(14,2) NOT NULL DEFAULT 0,
        parts_cost numeric(14,2) NOT NULL DEFAULT 0,
        total_cost numeric(14,2) NOT NULL DEFAULT 0,
        downtime_hours numeric(10,1),
        description varchar,
        status varchar NOT NULL DEFAULT 'open',
        CONSTRAINT uq_vehicle_maintenance_jobs_no UNIQUE (tenant_id, job_no)
      );
    `);

    await q.query(`
      CREATE TABLE vehicle_fuel_logs (
        ${base},
        vehicle_id uuid NOT NULL REFERENCES vehicles(id),
        fuel_date date,
        odometer numeric(12,1) NOT NULL DEFAULT 0,
        fuel_type varchar NOT NULL DEFAULT 'diesel',
        quantity_litres numeric(12,2) NOT NULL DEFAULT 0,
        rate_per_litre numeric(10,2) NOT NULL DEFAULT 0,
        amount numeric(14,2) NOT NULL DEFAULT 0,
        is_tank_full boolean NOT NULL DEFAULT true,
        station varchar,
        distance_km numeric(12,1),
        km_per_litre numeric(10,2),
        remarks varchar
      );
    `);

    for (const t of this.tables) {
      await q.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
      await q.query(`CREATE INDEX idx_${t}_vehicle ON ${t} (vehicle_id);`);
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
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await q.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
