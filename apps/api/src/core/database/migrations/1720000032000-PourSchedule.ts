import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pour scheduling (Plan B1). A tenant-scoped `pour_schedule_slots` table turning
 * an order into a timed pour plan (date, start time, quantity, truck spacing,
 * pump, sequence). FORCE-RLS with the NULLIF-guarded tenant policy, as the other
 * tenant tables. Reversible: `down()` drops the table.
 */
export class PourSchedule1720000032000 implements MigrationInterface {
  name = 'PourSchedule1720000032000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    await q.query(`
      CREATE TABLE pour_schedule_slots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        site_id uuid,
        slot_date date NOT NULL,
        start_time varchar,
        quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        truck_spacing_minutes int,
        pump_required boolean NOT NULL DEFAULT false,
        sequence_no int NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'planned',
        remarks varchar
      );
    `);
    await q.query(`CREATE INDEX idx_pour_schedule_slots_tenant ON pour_schedule_slots (tenant_id);`);
    await q.query(`CREATE INDEX idx_pour_schedule_slots_order ON pour_schedule_slots (order_id);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON pour_schedule_slots TO ${appUser};`);
    await q.query(`ALTER TABLE pour_schedule_slots ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE pour_schedule_slots FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON pour_schedule_slots
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
    await q.query(`DROP TABLE IF EXISTS pour_schedule_slots CASCADE;`);
  }
}
