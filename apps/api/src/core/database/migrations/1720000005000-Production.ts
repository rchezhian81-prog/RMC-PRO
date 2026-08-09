import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 6: production & batching (DEV-PLAN M4 mix designs + M7 production +
 * minimal M8 stock ledger). Tables: mix_designs, mix_design_materials,
 * production_plans, production_plan_items, batch_queue, batch_tickets,
 * batch_ticket_materials, stock_balances, stock_transactions. All tenant-scoped
 * and RLS-enforced (Doc 11 §6.4).
 */
export class Production1720000005000 implements MigrationInterface {
  name = 'Production1720000005000';

  private readonly tables = [
    'mix_designs',
    'mix_design_materials',
    'production_plans',
    'production_plan_items',
    'batch_queue',
    'batch_tickets',
    'batch_ticket_materials',
    'stock_balances',
    'stock_transactions',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const base = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL REFERENCES tenants(id)
    `;

    await queryRunner.query(`
      CREATE TABLE mix_designs (
        ${base},
        plant_id uuid REFERENCES plants(id),
        grade_id uuid REFERENCES concrete_grades(id),
        mix_code varchar NOT NULL,
        version_no int NOT NULL DEFAULT 1,
        slump_min int, slump_max int,
        cement_type varchar,
        water_cement_ratio numeric(6,3),
        pumpable boolean NOT NULL DEFAULT false,
        approval_status varchar NOT NULL DEFAULT 'draft',
        approved_by uuid, approved_at timestamptz,
        is_active_version boolean NOT NULL DEFAULT true,
        notes text,
        CONSTRAINT uq_mix_designs_code UNIQUE (tenant_id, mix_code, version_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE mix_design_materials (
        ${base},
        mix_design_id uuid NOT NULL REFERENCES mix_designs(id) ON DELETE CASCADE,
        material_id uuid REFERENCES materials(id),
        material_label varchar,
        target_quantity numeric(14,3) NOT NULL DEFAULT 0,
        uom varchar,
        tolerance_percentage numeric(6,2) NOT NULL DEFAULT 2,
        sequence_no int NOT NULL DEFAULT 0
      );
    `);

    await queryRunner.query(`
      CREATE TABLE production_plans (
        ${base},
        plant_id uuid REFERENCES plants(id),
        plan_no varchar NOT NULL,
        plan_date date, shift varchar,
        status varchar NOT NULL DEFAULT 'draft',
        created_by uuid, notes text,
        CONSTRAINT uq_production_plans_no UNIQUE (tenant_id, plan_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE production_plan_items (
        ${base},
        production_plan_id uuid NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
        order_id uuid REFERENCES orders(id),
        order_item_id uuid REFERENCES order_items(id),
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        sequence_no int NOT NULL DEFAULT 0,
        planned_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        priority varchar,
        status varchar NOT NULL DEFAULT 'planned'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE batch_queue (
        ${base},
        plant_id uuid REFERENCES plants(id),
        order_id uuid REFERENCES orders(id),
        order_item_id uuid REFERENCES order_items(id),
        production_plan_item_id uuid REFERENCES production_plan_items(id),
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        mix_design_id uuid REFERENCES mix_designs(id),
        planned_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        produced_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        queue_status varchar NOT NULL DEFAULT 'waiting'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE batch_tickets (
        ${base},
        plant_id uuid REFERENCES plants(id),
        batch_ticket_no varchar NOT NULL,
        order_id uuid REFERENCES orders(id),
        batch_queue_id uuid REFERENCES batch_queue(id),
        grade_id uuid REFERENCES concrete_grades(id),
        grade_label varchar,
        mix_design_id uuid REFERENCES mix_designs(id),
        batch_quantity_m3 numeric(12,3) NOT NULL DEFAULT 0,
        batch_start_time timestamptz, batch_end_time timestamptz,
        operator_user_id uuid,
        source_type varchar NOT NULL DEFAULT 'manual',
        variance_exceeded boolean NOT NULL DEFAULT false,
        status varchar NOT NULL DEFAULT 'draft',
        notes text,
        CONSTRAINT uq_batch_tickets_no UNIQUE (tenant_id, batch_ticket_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE batch_ticket_materials (
        ${base},
        batch_ticket_id uuid NOT NULL REFERENCES batch_tickets(id) ON DELETE CASCADE,
        material_id uuid REFERENCES materials(id),
        material_label varchar,
        target_quantity numeric(14,3) NOT NULL DEFAULT 0,
        actual_quantity numeric(14,3) NOT NULL DEFAULT 0,
        variance_quantity numeric(14,3) NOT NULL DEFAULT 0,
        variance_percentage numeric(8,2) NOT NULL DEFAULT 0,
        uom varchar,
        tolerance_percentage numeric(6,2) NOT NULL DEFAULT 2,
        within_tolerance boolean NOT NULL DEFAULT true
      );
    `);

    await queryRunner.query(`
      CREATE TABLE stock_balances (
        ${base},
        plant_id uuid REFERENCES plants(id),
        material_id uuid NOT NULL REFERENCES materials(id),
        material_label varchar,
        current_quantity numeric(16,3) NOT NULL DEFAULT 0,
        uom varchar,
        last_updated_at timestamptz,
        CONSTRAINT uq_stock_balances_plant_material UNIQUE (tenant_id, plant_id, material_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE stock_transactions (
        ${base},
        plant_id uuid REFERENCES plants(id),
        material_id uuid NOT NULL REFERENCES materials(id),
        material_label varchar,
        transaction_type varchar NOT NULL,
        reference_type varchar, reference_id uuid,
        in_quantity numeric(16,3) NOT NULL DEFAULT 0,
        out_quantity numeric(16,3) NOT NULL DEFAULT 0,
        balance_after numeric(16,3) NOT NULL DEFAULT 0,
        remarks varchar, created_by uuid
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

    await queryRunner.query(`CREATE INDEX idx_mix_design_materials_mix ON mix_design_materials (mix_design_id);`);
    await queryRunner.query(`CREATE INDEX idx_mix_designs_grade ON mix_designs (grade_id, approval_status);`);
    await queryRunner.query(`CREATE INDEX idx_production_plan_items_plan ON production_plan_items (production_plan_id);`);
    await queryRunner.query(`CREATE INDEX idx_batch_queue_order ON batch_queue (order_id);`);
    await queryRunner.query(`CREATE INDEX idx_batch_queue_status ON batch_queue (queue_status);`);
    await queryRunner.query(`CREATE INDEX idx_batch_tickets_order ON batch_tickets (order_id);`);
    await queryRunner.query(`CREATE INDEX idx_batch_ticket_materials_ticket ON batch_ticket_materials (batch_ticket_id);`);
    await queryRunner.query(`CREATE INDEX idx_stock_transactions_material ON stock_transactions (material_id, created_at);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
