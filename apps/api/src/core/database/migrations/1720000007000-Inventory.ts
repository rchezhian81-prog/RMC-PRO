import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 8: inventory completion (DEV-PLAN M8, B11). Adds material_inwards,
 * weighbridge_entries and negative_stock_requests on top of the Sprint-6 stock
 * ledger. All tenant-scoped and RLS-enforced (Doc 11 §6.4).
 */
export class Inventory1720000007000 implements MigrationInterface {
  name = 'Inventory1720000007000';

  private readonly tables = ['material_inwards', 'weighbridge_entries', 'negative_stock_requests'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      CREATE TABLE weighbridge_entries (
        ${base},
        slip_no varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        vehicle_no varchar,
        supplier_id uuid REFERENCES suppliers(id),
        material_id uuid REFERENCES materials(id),
        material_label varchar,
        gross_weight numeric(16,3) NOT NULL DEFAULT 0,
        tare_weight numeric(16,3) NOT NULL DEFAULT 0,
        net_weight numeric(16,3) NOT NULL DEFAULT 0,
        supplier_challan_no varchar,
        entry_datetime timestamptz,
        operator_user_id uuid,
        status varchar NOT NULL DEFAULT 'draft',
        remarks varchar,
        CONSTRAINT uq_weighbridge_entries_slip UNIQUE (tenant_id, slip_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE material_inwards (
        ${base},
        inward_no varchar NOT NULL,
        plant_id uuid REFERENCES plants(id),
        supplier_id uuid REFERENCES suppliers(id),
        material_id uuid REFERENCES materials(id),
        material_label varchar,
        vehicle_no varchar,
        supplier_challan_no varchar,
        weighbridge_entry_id uuid REFERENCES weighbridge_entries(id),
        quantity_received numeric(16,3) NOT NULL DEFAULT 0,
        quantity_accepted numeric(16,3) NOT NULL DEFAULT 0,
        rate numeric(14,2) NOT NULL DEFAULT 0,
        amount numeric(16,2) NOT NULL DEFAULT 0,
        uom varchar,
        status varchar NOT NULL DEFAULT 'draft',
        CONSTRAINT uq_material_inwards_no UNIQUE (tenant_id, inward_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE negative_stock_requests (
        ${base},
        plant_id uuid REFERENCES plants(id),
        material_id uuid REFERENCES materials(id),
        material_label varchar,
        available_quantity numeric(16,3) NOT NULL DEFAULT 0,
        required_quantity numeric(16,3) NOT NULL DEFAULT 0,
        negative_quantity numeric(16,3) NOT NULL DEFAULT 0,
        reference_type varchar, reference_id uuid,
        requested_by uuid, request_reason varchar,
        approval_status varchar NOT NULL DEFAULT 'pending',
        approved_by uuid, approved_at timestamptz, approval_remarks varchar
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

    await queryRunner.query(`CREATE INDEX idx_material_inwards_status ON material_inwards (status);`);
    await queryRunner.query(`CREATE INDEX idx_weighbridge_entries_status ON weighbridge_entries (status);`);
    await queryRunner.query(`CREATE INDEX idx_negative_stock_requests_status ON negative_stock_requests (approval_status);`);
    await queryRunner.query(`CREATE INDEX idx_negative_stock_requests_material ON negative_stock_requests (material_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
