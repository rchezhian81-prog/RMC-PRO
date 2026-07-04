import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { MODULE_CATALOG, PERMISSIONS } from '@rmc/shared';
import { AppDataSource } from './data-source';
import {
  ModuleEntity,
  Permission,
  PlanModule,
  SubscriptionPlan,
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
    modules: ['masters', 'sales', 'orders', 'dispatch', 'inventory', 'billing', 'reports'],
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
