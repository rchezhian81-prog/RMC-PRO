import { In, type EntityManager } from 'typeorm';
import {
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSION_DEFAULTS,
  SYSTEM_ROLE_KEYS,
  TENANT_PERMISSIONS,
  isPlatformPermission,
} from '@rmc/shared';
import { Permission, Role, RolePermission } from './entities';

/** Roles that belong to Mix Nova rather than to a customer. */
const PLATFORM_ROLE_KEYS: string[] = [ROLE_KEYS.SUPER_ADMIN, ROLE_KEYS.SUPPORT_STAFF];

export interface RoleProvisionResult {
  rolesAdded: number;
  grantsAdded: number;
}

/**
 * Give a tenant the full set of roles it needs to operate: Company Owner and
 * Company Admin, plus the ten operational roles staff are actually assigned to
 * (Plant Manager, Sales Executive, Batching Operator, …).
 *
 * This is the single definition of "a properly set-up tenant". Both the tenant
 * creation API and the production seed call it, so a plant onboarded on a
 * Tuesday is not missing roles that a plant onboarded after the next deploy
 * would have had.
 *
 * Two rules make it safe to call at any time:
 *
 *   - **Only fills gaps.** A role that already exists is skipped entirely, and
 *     its permissions are written only at the moment it is created. An owner
 *     who has retuned a role in Setup → Roles never has that undone.
 *   - **Never grants `platform.*`.** Those keys govern the SaaS platform, not
 *     one company's data. A Company Admin holding them is a customer holding
 *     the keys to every other customer's account.
 *
 * The caller supplies the EntityManager, so this works both inside
 * `runInTenant` (RLS-bound, from the API) and on the owner connection (the
 * seed, which bypasses RLS by design).
 */
export async function provisionTenantRoles(
  m: EntityManager,
  tenantId: string,
): Promise<RoleProvisionResult> {
  const permIdByKey = new Map((await m.find(Permission)).map((p) => [p.permissionKey, p.id]));
  const existing = new Set((await m.find(Role, { where: { tenantId } })).map((r) => r.roleKey));

  // Owner and Admin get everything a tenant may hold; the rest get the set
  // sized to their job. Both are "create with these grants, then leave alone".
  const wanted: { roleKey: string; permissions: readonly string[] }[] = [
    ...SYSTEM_ROLE_KEYS.map((roleKey) => ({ roleKey, permissions: TENANT_PERMISSIONS })),
    ...Object.entries(ROLE_PERMISSION_DEFAULTS).map(([roleKey, permissions]) => ({
      roleKey,
      permissions,
    })),
  ];

  let rolesAdded = 0;
  let grantsAdded = 0;

  for (const { roleKey, permissions } of wanted) {
    if (existing.has(roleKey)) continue;
    const role = await m.save(
      m.create(Role, {
        tenantId,
        roleKey,
        roleName: ROLE_LABELS[roleKey] ?? roleKey,
        // System roles: protected from rename/delete, permissions still editable.
        isSystemRole: true,
      }),
    );
    rolesAdded += 1;

    const rows = permissions
      .filter((k) => !isPlatformPermission(k))
      .map((k) => permIdByKey.get(k))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => m.create(RolePermission, { tenantId, roleId: role.id, permissionId }));
    if (rows.length) {
      await m.save(rows);
      grantsAdded += rows.length;
    }
  }

  return { rolesAdded, grantsAdded };
}

/**
 * Take `platform.*` away from every tenant role.
 *
 * Tenants created before `provisionTenantRoles` existed were given the entire
 * permission catalogue, platform keys included. Nothing enforces those keys
 * today — the platform APIs check `userType === 'super_admin'` instead — so this
 * changes no behaviour now. It matters for the day someone wires a permission
 * check to one of them and a customer's Company Admin turns out to already hold
 * it.
 *
 * Unlike the rest of the seed this deliberately *removes* grants. That is safe
 * because no tenant role should ever have held them: there is no legitimate
 * configuration this could be undoing.
 */
export async function revokePlatformPermissions(m: EntityManager): Promise<number> {
  const platformIds = (await m.find(Permission))
    .filter((p) => isPlatformPermission(p.permissionKey))
    .map((p) => p.id);
  if (!platformIds.length) return 0;

  const stray = await m.find(RolePermission, { where: { permissionId: In(platformIds) } });
  if (!stray.length) return 0;

  // Every row in role_permissions is tenant-scoped (tenant_id is NOT NULL), so
  // in practice all of these belong to a customer. The explicit check is here
  // so that adding a platform-side role later cannot silently strip it.
  const platformRoleIds = new Set(
    (await m.find(Role, { where: { roleKey: In(PLATFORM_ROLE_KEYS) } })).map((r) => r.id),
  );
  const removable = stray.filter((rp) => !platformRoleIds.has(rp.roleId));
  if (!removable.length) return 0;

  await m.delete(RolePermission, { id: In(removable.map((rp) => rp.id)) });
  return removable.length;
}
