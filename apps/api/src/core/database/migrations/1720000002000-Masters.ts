import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 3: tenant setup extras (number_series, tenant_settings) and core
 * masters (customers, sites, materials, suppliers, vehicles, drivers,
 * concrete_grades). All tenant-scoped and RLS-enforced (Doc 11 §6.4).
 */
export class Masters1720000002000 implements MigrationInterface {
  name = 'Masters1720000002000';

  private readonly tables = [
    'number_series',
    'tenant_settings',
    'customers',
    'sites',
    'materials',
    'suppliers',
    'vehicles',
    'drivers',
    'concrete_grades',
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
      CREATE TABLE number_series (
        ${base},
        plant_id uuid REFERENCES plants(id),
        document_type varchar NOT NULL,
        prefix varchar,
        suffix varchar,
        current_number int NOT NULL DEFAULT 0,
        padding_length int NOT NULL DEFAULT 4,
        financial_year varchar,
        reset_frequency varchar NOT NULL DEFAULT 'yearly',
        is_active boolean NOT NULL DEFAULT true
      );
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_settings (
        ${base},
        setting_key varchar NOT NULL,
        setting_value text,
        data_type varchar NOT NULL DEFAULT 'string',
        CONSTRAINT uq_tenant_settings_key UNIQUE (tenant_id, setting_key)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE customers (
        ${base},
        customer_code varchar NOT NULL,
        customer_name varchar NOT NULL,
        gstin varchar, customer_type varchar, billing_address varchar,
        city varchar, state varchar, contact_person varchar, mobile varchar, email varchar,
        credit_limit int NOT NULL DEFAULT 0,
        credit_days int NOT NULL DEFAULT 0,
        opening_balance int NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_customers_code UNIQUE (tenant_id, customer_code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE sites (
        ${base},
        customer_id uuid REFERENCES customers(id),
        site_code varchar NOT NULL,
        site_name varchar NOT NULL,
        address varchar, city varchar, state varchar,
        contact_person varchar, mobile varchar,
        pump_required boolean NOT NULL DEFAULT false,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_sites_code UNIQUE (tenant_id, site_code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE materials (
        ${base},
        material_code varchar NOT NULL,
        material_name varchar NOT NULL,
        category varchar, uom varchar, hsn_code varchar,
        minimum_stock int NOT NULL DEFAULT 0,
        reorder_level int NOT NULL DEFAULT 0,
        standard_rate int NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_materials_code UNIQUE (tenant_id, material_code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE suppliers (
        ${base},
        supplier_code varchar NOT NULL,
        supplier_name varchar NOT NULL,
        gstin varchar, contact_person varchar, mobile varchar, email varchar,
        state varchar, payment_terms varchar,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_suppliers_code UNIQUE (tenant_id, supplier_code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE vehicles (
        ${base},
        vehicle_no varchar NOT NULL,
        vehicle_type varchar,
        capacity_m3 int NOT NULL DEFAULT 0,
        ownership_type varchar,
        driver_id uuid,
        insurance_expiry date, fitness_expiry date, permit_expiry date, pollution_expiry date,
        status varchar NOT NULL DEFAULT 'available',
        CONSTRAINT uq_vehicles_no UNIQUE (tenant_id, vehicle_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE drivers (
        ${base},
        driver_code varchar NOT NULL,
        driver_name varchar NOT NULL,
        mobile varchar, license_no varchar, license_expiry date,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_drivers_code UNIQUE (tenant_id, driver_code)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE concrete_grades (
        ${base},
        grade_code varchar NOT NULL,
        grade_name varchar NOT NULL,
        strength_class varchar,
        status varchar NOT NULL DEFAULT 'active',
        CONSTRAINT uq_grades_code UNIQUE (tenant_id, grade_code)
      );
    `);

    for (const t of this.tables) {
      await queryRunner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${appUser};`,
      );
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      await queryRunner.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [...this.tables].reverse()) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
