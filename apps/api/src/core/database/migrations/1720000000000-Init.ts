import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migrations M0–M3 (DEV-PLAN §4): platform + tenant-setup + IAM tables, the
 * non-superuser application role, grants, and PostgreSQL Row-Level Security
 * (Design Doc 9 §15.3, Doc 11 §6.4). Tenant isolation is DB-enforced: the app
 * role is subject to RLS; only rows matching current_setting('app.current_tenant_id')
 * are visible.
 */
export class Init1720000000000 implements MigrationInterface {
  name = 'Init1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const appPass = (process.env.APP_DB_PASSWORD ?? 'rmc_app').replace(/'/g, "''");

    const rlsTables = [
      'companies',
      'plants',
      'roles',
      'role_permissions',
      'user_roles',
      'user_plant_access',
    ];

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // Non-superuser application role (subject to RLS).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} LOGIN PASSWORD '${appPass}';
        END IF;
      END $$;
    `);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO ${appUser};`);

    const common = `
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    `;

    // ---- Platform tables (no RLS) ----
    await queryRunner.query(`
      CREATE TABLE tenants (
        ${common},
        tenant_code varchar NOT NULL UNIQUE,
        tenant_name varchar NOT NULL,
        legal_name varchar,
        status varchar NOT NULL DEFAULT 'active',
        default_language varchar NOT NULL DEFAULT 'en'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE permissions (
        ${common},
        permission_key varchar NOT NULL UNIQUE,
        module_key varchar NOT NULL,
        description varchar
      );
    `);

    await queryRunner.query(`
      CREATE TABLE users (
        ${common},
        tenant_id uuid REFERENCES tenants(id),
        name varchar NOT NULL,
        email varchar NOT NULL UNIQUE,
        mobile varchar,
        password_hash varchar NOT NULL,
        user_type varchar NOT NULL DEFAULT 'tenant_user',
        status varchar NOT NULL DEFAULT 'active',
        is_2fa_enabled boolean NOT NULL DEFAULT false,
        last_login_at timestamptz
      );
    `);

    // ---- Tenant-scoped tables (RLS-enforced) ----
    await queryRunner.query(`
      CREATE TABLE companies (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        company_name varchar NOT NULL,
        gstin varchar,
        state varchar
      );
    `);

    await queryRunner.query(`
      CREATE TABLE plants (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        company_id uuid REFERENCES companies(id),
        plant_code varchar NOT NULL,
        plant_name varchar NOT NULL,
        city varchar,
        status varchar NOT NULL DEFAULT 'active'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE roles (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        role_key varchar NOT NULL,
        role_name varchar NOT NULL,
        is_system_role boolean NOT NULL DEFAULT false,
        CONSTRAINT uq_roles_tenant_key UNIQUE (tenant_id, role_key)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE role_permissions (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permissions(id),
        CONSTRAINT uq_role_permissions UNIQUE (tenant_id, role_id, permission_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE user_roles (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        CONSTRAINT uq_user_roles UNIQUE (tenant_id, user_id, role_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE user_plant_access (
        ${common},
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plant_id uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        access_level varchar NOT NULL DEFAULT 'operate',
        CONSTRAINT uq_user_plant_access UNIQUE (tenant_id, user_id, plant_id)
      );
    `);

    // ---- Grants to the application role ----
    await queryRunner.query(`GRANT SELECT ON tenants, permissions TO ${appUser};`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE ON users TO ${appUser};`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${rlsTables.join(', ')} TO ${appUser};`,
    );

    // ---- Row-Level Security (tenant isolation) ----
    for (const t of rlsTables) {
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`
        CREATE POLICY tenant_isolation ON ${t}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
      // Helpful tenant index (Design Doc 6 §23).
      await queryRunner.query(`CREATE INDEX idx_${t}_tenant ON ${t} (tenant_id);`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [
      'user_plant_access',
      'user_roles',
      'role_permissions',
      'roles',
      'plants',
      'companies',
      'users',
      'permissions',
      'tenants',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
