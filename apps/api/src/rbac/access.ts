import { ROLE_KEYS } from '@rmc/shared';
import type { TenantDbService } from '../core/database/tenant-db.service';

export interface UserAccess {
  roleKeys: string[];
  permissions: string[];
}

/**
 * Load a tenant user's role keys and effective permissions in one tenant-scoped
 * pass (RLS applies). Shared by PermissionsGuard and CrudPermissionsGuard.
 */
export async function loadUserAccess(
  db: TenantDbService,
  tenantId: string,
  userId: string,
): Promise<UserAccess> {
  return db.runInTenant(tenantId, async (m) => {
    const roleRows: Array<{ key: string }> = await m.query(
      `SELECT DISTINCT r.role_key AS key
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    const permRows: Array<{ key: string }> = await m.query(
      `SELECT DISTINCT p.permission_key AS key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return { roleKeys: roleRows.map((r) => r.key), permissions: permRows.map((r) => r.key) };
  });
}

/** The company owner is the tenant super-user — full access, no per-key checks. */
export function isTenantOwner(access: UserAccess): boolean {
  return access.roleKeys.includes(ROLE_KEYS.COMPANY_OWNER);
}
