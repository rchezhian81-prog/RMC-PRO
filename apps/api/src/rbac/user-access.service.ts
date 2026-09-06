import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { loadUserAccess, type UserAccess } from './access';

/**
 * A user's role keys and effective permissions, cached per (tenant, user).
 *
 * This is read on *every* guarded request — twice on many, since a permission
 * guard runs and then a service (e.g. GET /company, the dashboard, alerts) reads
 * it again in the same request. Each read is two `SELECT DISTINCT` joins over
 * user_roles/role_permissions inside a fresh tenant transaction, so uncached it
 * is the single biggest per-request database cost the plant pays.
 *
 * Correctness over the cache is kept two ways, mirroring TenantAccessService:
 *  - a short TTL, so any write path that forgets to invalidate still self-heals
 *    within a few seconds; and
 *  - explicit invalidation on the writes that actually change access — a user's
 *    role assignment (invalidateUser) and a role's permission set or deletion
 *    (invalidateTenant, since one role change moves every user who holds it).
 * With the explicit calls a permission change is visible on the very next
 * request; the TTL only backstops paths that bypass this service.
 */
const TTL_MS = 30_000;

/**
 * A safety bound so a bug can never grow the map without limit. Keyed per user,
 * not per tenant, so it is generous; on overflow the whole map is dropped (the
 * same coarse strategy TenantAccessService uses) and simply repopulates.
 */
const MAX_ENTRIES = 10_000;

@Injectable()
export class UserAccessService {
  private readonly cache = new Map<string, { at: number; value: UserAccess }>();

  constructor(private readonly db: TenantDbService) {}

  /** The cached access for a user, loading and caching it on a miss/expiry. */
  async get(tenantId: string, userId: string): Promise<UserAccess> {
    const key = `${tenantId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await loadUserAccess(this.db, tenantId, userId);
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Drop one user's cached access — after their role assignment changes. */
  invalidateUser(tenantId: string, userId: string): void {
    this.cache.delete(`${tenantId}:${userId}`);
  }

  /**
   * Drop every cached user in a tenant — after a role's permission set changes
   * (or a role is deleted). One role edit alters access for every user holding
   * it, and the cache does not index users by role, so clear the tenant. Tenants
   * have few concurrent users, so this is cheap and repopulates immediately.
   */
  invalidateTenant(tenantId: string): void {
    const prefix = `${tenantId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }
}
