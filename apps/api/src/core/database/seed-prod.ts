import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { In, type EntityManager } from 'typeorm';
import { MODULE_CATALOG, PERMISSIONS, SYSTEM_ROLE_KEYS } from '@rmc/shared';
import { AppDataSource } from './data-source';
import { provisionTenantRoles, provisionTenantCompany, revokePlatformPermissions } from './provision-tenant-roles';
import {
  ModuleEntity,
  Permission,
  PlanModule,
  Role,
  RolePermission,
  SubscriptionPlan,
  Tenant,
  TenantModule,
  User,
} from './entities';

/**
 * PRODUCTION bootstrap seed (`pnpm seed:prod`).
 *
 * Unlike the development `seed.ts`, this is **non-destructive and idempotent**:
 *   - It NEVER truncates any table.
 *   - It creates NO demo tenants (no Alpha/Beta) and no demo master data.
 *   - It uses NO hardcoded demo password.
 *   - It only ensures the platform-global data needed to operate — the module
 *     catalog, the permission catalog, the default subscription plans (+ their
 *     module grants) — and, optionally, ONE platform Super Admin.
 *   - Running it repeatedly is safe: every step inserts only what is missing.
 *
 * Three tenant-level steps exist, all following the same rule — fill in what was
 * never decided, never overwrite what was:
 *   - When a NEW permission key is added to the catalog it is granted to each
 *     tenant's system roles (Company Owner / Company Admin), or the API would
 *     enforce a key granted to nobody and silently remove access for every
 *     non-owner user. Only keys created in the same run are granted, so a
 *     deliberately revoked permission is never restored.
 *   - Tenant roles (Company Owner/Admin plus Plant Manager, Batching Operator,
 *     …) are created for tenants that lack them, and only at creation. The
 *     tenant-creation API provisions the same set through the same code, so
 *     this only catches tenants that predate it.
 *   - `platform.*` grants are removed from tenant roles. Those keys govern the
 *     SaaS platform, not one company's data, and older code handed a tenant's
 *     Owner and Admin the entire catalogue.
 *   - Tenants with no `tenant_modules` rows are provisioned, so subscription
 *     enforcement has something to enforce. A tenant that already has rows is
 *     left exactly as the super admin configured it.
 *
 * The Super Admin is created only when `SUPERADMIN_EMAIL` is provided and no user
 * with that email exists yet. Its password comes from `SUPERADMIN_PASSWORD`
 * (required for creation, rejected if weak/demo). Connects as the owner role
 * (POSTGRES_USER) like all migrations/seed — never as the RLS-bound app role.
 */

const DEFAULT_PLANS = [
  {
    planCode: 'STARTER',
    planName: 'Starter',
    monthlyPrice: 2999,
    yearlyPrice: 29990,
    maxPlants: 1,
    maxUsers: 5,
    // 'production' is not an upsell: an RMC plant that cannot batch concrete has
    // no reason to buy the software. Weighbridge and offline sync are the paid
    // steps up from here.
    modules: [
      'masters', 'sales', 'orders', 'production', 'dispatch', 'inventory', 'billing', 'reports',
    ],
  },
  {
    planCode: 'PRO',
    planName: 'Professional',
    monthlyPrice: 7999,
    yearlyPrice: 79990,
    maxPlants: 5,
    maxUsers: 25,
    modules: MODULE_CATALOG.filter((mod) => mod.phase === 1).map((mod) => mod.key),
  },
] as const;

// Passwords that must never protect a production Super Admin.
const WEAK_PASSWORDS = new Set([
  'Passw0rd!', 'password', 'Password1', 'admin', 'admin123', 'changeme', 'change-me', 'rmc', 'rmc_app',
]);

function assertStrongPassword(pw: string): void {
  if (WEAK_PASSWORDS.has(pw)) {
    throw new Error('SUPERADMIN_PASSWORD is a known-weak/demo value — choose a unique strong password.');
  }
  const strong = pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
  if (!strong) {
    throw new Error('SUPERADMIN_PASSWORD must be ≥12 chars and include lower, upper and a digit.');
  }
}

/**
 * Grant `perms` to every tenant's system roles, skipping grants that already
 * exist.
 *
 * Why this exists: a tenant is created with whatever permissions happened to
 * exist at that moment, and nothing back-filled it afterwards. Every new
 * permission key therefore silently shrank what an existing tenant's Company
 * Admin could do — a key the API had started enforcing was simply never
 * granted to anyone but the owner (who bypasses checks entirely).
 *
 * The routine call passes only keys created in *this* run, so it cannot
 * resurrect a permission an administrator deliberately revoked. The opt-in
 * repair path (BACKFILL_SYSTEM_ROLE_PERMISSIONS) passes the whole catalogue and
 * therefore CAN — which is exactly why it is off by default.
 *
 * `platform.*` keys are excluded either way: they are super-admin-only and
 * meaningless on a tenant role.
 */
async function grantToSystemRoles(m: EntityManager, perms: Permission[]): Promise<number> {
  const grantable = perms.filter((p) => !p.permissionKey.startsWith('platform.'));
  if (!grantable.length) return 0;

  const roles = await m.find(Role, { where: { roleKey: In(SYSTEM_ROLE_KEYS) } });
  if (!roles.length) return 0;

  const permIds = grantable.map((p) => p.id);
  const rows: RolePermission[] = [];
  for (const role of roles) {
    const already = new Set(
      (await m.find(RolePermission, { where: { roleId: role.id, permissionId: In(permIds) } })).map(
        (rp) => rp.permissionId,
      ),
    );
    for (const id of permIds) {
      if (already.has(id)) continue;
      rows.push(m.create(RolePermission, { tenantId: role.tenantId, roleId: role.id, permissionId: id }));
    }
  }
  if (rows.length) await m.save(rows);
  return rows.length;
}

/**
 * Ensure every tenant has its full set of roles — Company Owner, Company Admin,
 * and the ten operational roles staff are actually assigned to.
 *
 * Without these a tenant has only Owner and Admin, so onboarding a batching
 * operator means either hand-building a role and ticking permissions one by one,
 * or making them a Company Admin — which hands a plant operator the billing,
 * users and settings screens.
 *
 * The rules live in `provisionTenantRoles`, which the tenant-creation API calls
 * too, so a tenant is set up the same way whichever path created it. Re-running
 * never touches a role an owner has since edited.
 */
async function seedTenantRoles(m: EntityManager): Promise<string> {
  const tenants = await m.find(Tenant);
  if (!tenants.length) return 'no tenants yet';

  let rolesAdded = 0;
  let grantsAdded = 0;
  let companiesAdded = 0;
  for (const tenant of tenants) {
    const r = await provisionTenantRoles(m, tenant.id);
    rolesAdded += r.rolesAdded;
    grantsAdded += r.grantsAdded;
    // A company-profile row for any tenant that predates it being provisioned
    // at creation — so the Company screen saves and invoices have a plant state.
    if (await provisionTenantCompany(m, tenant.id, tenant.tenantName)) companiesAdded += 1;
  }
  const companyNote = companiesAdded ? `, +${companiesAdded} company profile(s)` : '';
  return rolesAdded
    ? `+${rolesAdded} role(s), +${grantsAdded} grant(s) across ${tenants.length} tenant(s)${companyNote}`
    : `none needed (${tenants.length} tenant(s) already have them)${companyNote}`;
}

/**
 * Make sure every tenant actually has module rows.
 *
 * The API now refuses a request whose module is not enabled for the tenant. A
 * tenant created before that existed — or created without a plan — has no rows
 * in `tenant_modules` at all, which is not the same as "nothing is allowed"; it
 * means nobody ever decided. The guard treats that state as unenforced so a live
 * plant is never taken off the air by a provisioning gap, and this step closes
 * the gap so enforcement is real rather than skipped.
 *
 * A tenant that already has rows is left completely alone: whatever the super
 * admin ticked on the Modules screen stands.
 */
async function provisionTenantModules(m: EntityManager): Promise<string> {
  const tenants = await m.find(Tenant);
  if (!tenants.length) return 'no tenants yet';

  const phase1 = MODULE_CATALOG.filter((mod) => mod.phase === 1).map((mod) => mod.key);
  let provisioned = 0;
  let rowsAdded = 0;

  for (const tenant of tenants) {
    if (await m.findOne(TenantModule, { where: { tenantId: tenant.id } })) continue;

    // Follow the tenant's plan when it has one; otherwise fall back to the
    // shipped Phase-1 set, which is what the product does today.
    let keys = phase1;
    if (tenant.currentPlanId) {
      const planMods = await m.find(PlanModule, {
        where: { planId: tenant.currentPlanId, isEnabled: true },
      });
      if (planMods.length) keys = planMods.map((pm) => pm.moduleKey);
    }
    await m.save(
      keys.map((moduleKey) => m.create(TenantModule, { tenantId: tenant.id, moduleKey, isEnabled: true })),
    );
    provisioned += 1;
    rowsAdded += keys.length;
  }
  return provisioned
    ? `+${provisioned} tenant(s) provisioned, +${rowsAdded} module row(s)`
    : `none needed (all ${tenants.length} tenant(s) already provisioned)`;
}

async function main() {
  await AppDataSource.initialize();
  const m = AppDataSource.manager;
  const summary: string[] = [];

  // 1. Module catalog — insert only missing keys.
  const existingModuleKeys = new Set((await m.find(ModuleEntity)).map((x) => x.moduleKey));
  const newModules = MODULE_CATALOG.filter((mod) => !existingModuleKeys.has(mod.key)).map((mod) =>
    m.create(ModuleEntity, { moduleKey: mod.key, name: mod.name, phase: mod.phase }),
  );
  if (newModules.length) await m.save(newModules);
  summary.push(`modules: +${newModules.length} new (${existingModuleKeys.size} already present)`);

  // 2. Permission catalog — insert only missing keys.
  const existingPermKeys = new Set((await m.find(Permission)).map((x) => x.permissionKey));
  const newPerms = Object.values(PERMISSIONS)
    .filter((key) => !existingPermKeys.has(key))
    .map((key) => m.create(Permission, { permissionKey: key, moduleKey: key.split('.')[0] ?? 'core' }));
  if (newPerms.length) await m.save(newPerms);
  summary.push(`permissions: +${newPerms.length} new (${existingPermKeys.size} already present)`);

  // 2b. Give those new keys to every tenant's system roles. Without this an
  //     added key is enforced by the API but granted to nobody, so it silently
  //     removes access for anyone who isn't the company owner.
  const grantedNew = await grantToSystemRoles(m, newPerms);
  summary.push(`system-role grants: +${grantedNew} for newly added permission key(s)`);

  // 2c. Opt-in repair for keys added BEFORE this logic existed (they are no
  //     longer "new", so 2b will not pick them up). Off by default because it
  //     re-grants anything an administrator has deliberately unticked on a
  //     system role. Run once with BACKFILL_SYSTEM_ROLE_PERMISSIONS=true.
  if (process.env.BACKFILL_SYSTEM_ROLE_PERMISSIONS === 'true') {
    const allPerms = await m.find(Permission);
    const repaired = await grantToSystemRoles(m, allPerms);
    summary.push(`system-role backfill: +${repaired} grant(s) [BACKFILL_SYSTEM_ROLE_PERMISSIONS=true]`);
  }

  // 2d. Tenant roles, so staff can be given a login scoped to their job.
  summary.push(`tenant roles: ${await seedTenantRoles(m)}`);

  // 2e. Repair: take platform.* off any tenant role that was handed the whole
  //     catalogue before provisioning had this rule. Nothing enforces those keys
  //     today, so this is not a live hole — it is closing one before something
  //     starts checking them. Always runs; there is no legitimate reason for a
  //     customer's role to hold them, so nothing deliberate can be undone.
  const revoked = await revokePlatformPermissions(m);
  summary.push(
    revoked
      ? `platform.* on tenant roles: revoked ${revoked} grant(s)`
      : 'platform.* on tenant roles: none found',
  );

  // 3. Default subscription plans (+ their module grants) — create if missing, then
  //    ensure each plan grants all its modules.
  let plansCreated = 0;
  let planModulesAdded = 0;
  for (const def of DEFAULT_PLANS) {
    let plan = await m.findOne(SubscriptionPlan, { where: { planCode: def.planCode } });
    if (!plan) {
      plan = await m.save(
        m.create(SubscriptionPlan, {
          planCode: def.planCode,
          planName: def.planName,
          monthlyPrice: def.monthlyPrice,
          yearlyPrice: def.yearlyPrice,
          maxPlants: def.maxPlants,
          maxUsers: def.maxUsers,
        }),
      );
      plansCreated += 1;
    }
    const have = new Set((await m.find(PlanModule, { where: { planId: plan.id } })).map((pm) => pm.moduleKey));
    const missing = def.modules.filter((k) => !have.has(k));
    if (missing.length) {
      await m.save(missing.map((k) => m.create(PlanModule, { planId: plan!.id, moduleKey: k })));
      planModulesAdded += missing.length;
    }
  }
  summary.push(`plans: +${plansCreated} new plan(s), +${planModulesAdded} module grant(s)`);

  // 3b. Every tenant needs module rows now that the API enforces them. Runs
  //     after the plans step so a tenant on a plan is provisioned from it.
  summary.push(`tenant modules: ${await provisionTenantModules(m)}`);

  // 4. One platform Super Admin — only if configured and not already present.
  const email = process.env.SUPERADMIN_EMAIL?.trim();
  if (!email) {
    summary.push('super admin: skipped (SUPERADMIN_EMAIL not set)');
  } else {
    const existing = await m.findOne(User, { where: { email } });
    if (existing) {
      summary.push(`super admin: '${email}' already exists — unchanged`);
    } else {
      const password = process.env.SUPERADMIN_PASSWORD;
      if (!password) {
        throw new Error(`SUPERADMIN_PASSWORD is required to create super admin '${email}'.`);
      }
      assertStrongPassword(password);
      await m.save(
        m.create(User, {
          tenantId: null,
          name: process.env.SUPERADMIN_NAME?.trim() || 'Platform Super Admin',
          email,
          passwordHash: bcrypt.hashSync(password, 10),
          userType: 'super_admin',
        }),
      );
      summary.push(`super admin: created '${email}'`);
    }
  }

  console.log('Production bootstrap complete (idempotent, non-destructive):');
  for (const line of summary) console.log(`  - ${line}`);
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
