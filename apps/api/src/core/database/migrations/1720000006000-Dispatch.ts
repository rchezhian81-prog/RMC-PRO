import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 7: dispatch & delivery challan (DEV-PLAN M7 dispatch tables, B10).
 * Tables: dispatches, delivery_challans, delivery_status_history. All
 * tenant-scoped and RLS-enforced (Doc 11 §6.4).
 */
export class Dispatch1720000006000 implements MigrationInterface {
  name = 'Dispatch1720000006000';

  private readonly tables = ['dispatches', 'delivery_challans', 'delivery_status_history'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      CREATE TABLE dispatches (
        ${base},
        dispatch_no varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        order_id uuid REFERENCES orders(id),
        batch_ticket_id uuid REFERENCES batch_tickets(id),
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        vehicle_id uuid REFERENCES vehicles(id),
        driver_id uuid REFERENCES drivers(id),
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        dispatch_status varchar NOT NULL DEFAULT 'waiting',
        dispatch_time timestamptz, site_arrival_time timestamptz,
        pour_start_time timestamptz, pour_end_time timestamptz,
        return_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        delay_reason varchar,
        CONSTRAINT uq_dispatches_no UNIQUE (tenant_id, dispatch_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE delivery_challans (
        ${base},
        challan_no varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        dispatch_id uuid REFERENCES dispatches(id),
        order_id uuid REFERENCES orders(id),
        batch_ticket_id uuid REFERENCES batch_tickets(id),
        customer_id uuid REFERENCES customers(id),
        site_id uuid REFERENCES sites(id),
        vehicle_id uuid REFERENCES vehicles(id),
        driver_id uuid REFERENCES drivers(id),
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        slump varchar,
        dispatch_time timestamptz,
        receiver_name varchar,
        return_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        invoice_status varchar NOT NULL DEFAULT 'not_invoiced',
        challan_status varchar NOT NULL DEFAULT 'draft',
        CONSTRAINT uq_delivery_challans_no UNIQUE (tenant_id, challan_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE delivery_status_history (
        ${base},
        dispatch_id uuid REFERENCES dispatches(id) ON DELETE CASCADE,
        challan_id uuid REFERENCES delivery_challans(id) ON DELETE CASCADE,
        old_status varchar, new_status varchar NOT NULL,
        location_latitude numeric(10,6), location_longitude numeric(10,6),
        changed_by uuid, note varchar
      );
    `);

    for (const t of this.tables) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`);
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      await queryRunner.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
    }

    await queryRunner.query(`CREATE INDEX idx_dispatches_status ON dispatches (dispatch_status);`);
    await queryRunner.query(`CREATE INDEX idx_dispatches_batch ON dispatches (batch_ticket_id);`);
    await queryRunner.query(`CREATE INDEX idx_delivery_challans_dispatch ON delivery_challans (dispatch_id);`);
    await queryRunner.query(`CREATE INDEX idx_delivery_challans_status ON delivery_challans (challan_status);`);
    await queryRunner.query(`CREATE INDEX idx_delivery_status_history_dispatch ON delivery_status_history (dispatch_id);`);
    await queryRunner.query(`CREATE INDEX idx_delivery_status_history_challan ON delivery_status_history (challan_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
