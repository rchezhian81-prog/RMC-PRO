import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Puts the last two tenant tables under database-enforced Row-Level Security.
 * `users` and `tenant_modules` each carry a `tenant_id` but were previously
 * isolated by application code only, so a query that forgot a tenant filter
 * would fail OPEN (leak across tenants). This closes audit gap G9 / R5.
 *
 * The policy is fail-CLOSED and has two clauses:
 *   - tenant clause:   tenant_id = app.current_tenant_id   (normal per-tenant access)
 *   - platform clause: app.platform = 'on'                 (authentication + super-admin)
 * With NEITHER GUC set, both clauses are false and the query returns nothing —
 * a future bug that forgets both contexts leaks nothing instead of everything.
 *
 * The platform clause exists because authentication is inherently tenant-
 * agnostic: a user is looked up by email/id before the tenant is known, and
 * platform super-admins have `tenant_id = NULL` (so a pure tenant policy would
 * make them invisible and break login). The runtime opts into that clause only
 * through `TenantDbService.runAsPlatform`, at a small, grep-able set of
 * identity/platform call sites; every other access runs under `runInTenant` and
 * is confined to one tenant.
 *
 * MUST ship together with the code changes that convert the auth/platform reads
 * to `runAsPlatform` / `runInTenant`. The migration is safe to apply first on
 * connections that already set a tenant GUC, but the plain-connection auth reads
 * would return 0 rows and break login until the code is deployed — so land them
 * in the same release. Reversible: `down()` drops the policies and disables RLS,
 * restoring the prior app-enforced behaviour with no data change.
 *
 * `rmc_app` already holds SELECT/INSERT/UPDATE on `users` and full DML on
 * `tenant_modules`; RLS narrows WHICH rows those privileges see, not the grants.
 */
export class UsersTenantModulesRls1720000018000 implements MigrationInterface {
  name = 'UsersTenantModulesRls1720000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const t of ['users', 'tenant_modules']) {
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      // FORCE so the policy applies even to the table owner — the app role is
      // non-superuser, but this matches the guarantee on the other 51 tables.
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
      // NULLIF(..,'') guards the uuid cast: a placeholder GUC that was set
      // transaction-locally once on a pooled connection reverts to '' (not
      // NULL) afterwards, and ''::uuid would RAISE. Under runAsPlatform the
      // tenant GUC is left at that '' and the platform clause carries the row —
      // so the cast must not error. NULLIF turns '' back into NULL (→ no match),
      // keeping the tenant clause fail-closed without throwing.
      await queryRunner.query(`
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
    // tenant_modules already has idx_tenant_modules_tenant (Platform migration);
    // users had no tenant index because it was never RLS-scoped before.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_tenant;`);
    for (const t of ['users', 'tenant_modules']) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
      await queryRunner.query(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY;`);
    }
  }
}
