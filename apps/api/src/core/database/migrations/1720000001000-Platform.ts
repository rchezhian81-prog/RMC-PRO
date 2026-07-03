import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 2: subscription plans, plan modules, module catalog, and effective
 * per-tenant module enablement. These are platform-managed (no RLS) so Super
 * Admin APIs manage them cross-tenant; the module guard reads tenant_modules
 * scoped by the authenticated tenant_id.
 */
export class Platform1720000001000 implements MigrationInterface {
  name = 'Platform1720000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const common = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    `;

    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN current_plan_id uuid;`);

    await queryRunner.query(`
      CREATE TABLE subscription_plans (
        ${common},
        plan_code varchar NOT NULL UNIQUE,
        plan_name varchar NOT NULL,
        monthly_price int NOT NULL DEFAULT 0,
        yearly_price int NOT NULL DEFAULT 0,
        max_plants int NOT NULL DEFAULT 1,
        max_users int NOT NULL DEFAULT 5,
        is_active boolean NOT NULL DEFAULT true
      );
    `);

    await queryRunner.query(`
      ALTER TABLE tenants
        ADD CONSTRAINT fk_tenants_plan
        FOREIGN KEY (current_plan_id) REFERENCES subscription_plans(id);
    `);

    await queryRunner.query(`
      CREATE TABLE plan_modules (
        ${common},
        plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
        module_key varchar NOT NULL,
        is_enabled boolean NOT NULL DEFAULT true,
        CONSTRAINT uq_plan_modules UNIQUE (plan_id, module_key)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE modules (
        ${common},
        module_key varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        phase int NOT NULL,
        is_active boolean NOT NULL DEFAULT true
      );
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_modules (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        module_key varchar NOT NULL,
        is_enabled boolean NOT NULL DEFAULT true,
        CONSTRAINT uq_tenant_modules UNIQUE (tenant_id, module_key)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_tenant_modules_tenant ON tenant_modules (tenant_id);`);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON
         subscription_plans, plan_modules, modules, tenant_modules TO ${appUser};`,
    );
    // Super Admin (via the app role) creates/updates tenants.
    await queryRunner.query(`GRANT INSERT, UPDATE ON tenants TO ${appUser};`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS fk_tenants_plan;`);
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS current_plan_id;`);
    for (const t of ['tenant_modules', 'plan_modules', 'modules', 'subscription_plans']) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
