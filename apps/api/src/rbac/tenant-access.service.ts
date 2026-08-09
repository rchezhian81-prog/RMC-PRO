import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { isTenantUsable, tenantBlockedMessage } from '@rmc/shared';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Tenant, TenantModule } from '../core/database/entities';

/**
 * What a tenant is currently entitled to: may it trade at all, and which
 * modules did the platform switch on for it.
 *
 * Both answers are needed on *every* request, so they are read together and
 * cached for a few seconds. Without the cache, turning subscription enforcement
 * on would add two queries to every API call the plant makes.
 *
 * `provisioned` is the important one. It means "this tenant has module rows at
 * all" — see `isModuleEnabled` for why that distinction decides whether a plant
 * keeps working.
 */
interface Entitlements {
  status: string;
  /** Module keys switched on. Empty when the tenant is unprovisioned. */
  modules: Set<string>;
  /** False when the tenant has no `tenant_modules` rows whatsoever. */
  provisioned: boolean;
  /** False when there is no such tenant. */
  exists: boolean;
}

/**
 * How long a suspension or a module change takes to bite. Short enough that a
 * super admin sees their change take effect while they are still looking at the
 * screen, long enough that a busy plant is not re-querying per request.
 */
const TTL_MS = 30_000;

/** Tenants are few; this bound only exists so a bug can never grow the map forever. */
const MAX_ENTRIES = 500;

/**
 * When set, an unprovisioned tenant (no `tenant_modules` rows) is treated as
 * having NOTHING enabled instead of everything — i.e. module checks fail closed.
 * Off by default so a provisioning gap never silently takes a live plant off the
 * air; recommended ON in production once every tenant is confirmed provisioned
 * (the production seed back-fills modules). Set `PROVISIONING_STRICT=1`.
 */
const PROVISIONING_STRICT =
  process.env.PROVISIONING_STRICT === '1' || process.env.PROVISIONING_STRICT === 'true';

@Injectable()
export class TenantAccessService {
  private readonly log = new Logger(TenantAccessService.name);
  private readonly cache = new Map<string, { at: number; value: Entitlements }>();
  /** Tenants already reported as unprovisioned, so the warning is logged once each. */
  private readonly warned = new Set<string>();

  constructor(private readonly db: TenantDbService) {}

  /** Drop the cached answer for one tenant (or all) after a platform change. */
  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  async entitlements(tenantId: string): Promise<Entitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    // Both tables are platform-managed (no RLS), so they are read on the plain
    // connection and scoped by the id from the verified JWT.
    const [tenant, rows] = await Promise.all([
      this.db.ds.getRepository(Tenant).findOne({ where: { id: tenantId } }),
      this.db.ds.getRepository(TenantModule).find({ where: { tenantId } }),
    ]);

    const value: Entitlements = {
      status: tenant?.status ?? '',
      modules: new Set(rows.filter((r) => r.isEnabled).map((r) => r.moduleKey)),
      provisioned: rows.length > 0,
      exists: Boolean(tenant),
    };

    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /**
   * Refuse the request when the company may no longer trade.
   *
   * A missing tenant row is treated as blocked: the only way to hold a token for
   * a tenant that no longer exists is for it to have been deleted underneath the
   * session.
   */
  async assertUsable(tenantId: string): Promise<void> {
    const { status, exists } = await this.entitlements(tenantId);
    if (!exists) {
      throw new ForbiddenException({
        code: 'TENANT_SUSPENDED',
        message: 'Your company account is no longer available. Contact Mix Nova support.',
      });
    }
    if (!isTenantUsable(status)) {
      throw new ForbiddenException({
        code: 'TENANT_SUSPENDED',
        message: tenantBlockedMessage(status),
      });
    }
  }

  /**
   * Is `moduleKey` part of this tenant's subscription?
   *
   * A tenant with **no module rows at all** is answered `true` for everything.
   * That is deliberate. Module rows are written when a plan is assigned, and a
   * tenant created before that step — or before this enforcement existed — has
   * none. Reading "no rows" as "nothing is allowed" would take a live plant off
   * the air over a provisioning gap rather than a business decision. Every path
   * that creates a tenant now provisions modules, and `seed-prod` back-fills the
   * ones that predate it, so this branch is a safety net and not the normal case
   * — it logs once per tenant so the gap is visible rather than silent.
   *
   * Once a tenant has even one row, gating is exact: a module that is absent or
   * switched off is refused.
   */
  async isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    const { modules, provisioned } = await this.entitlements(tenantId);
    if (!provisioned) {
      if (!this.warned.has(tenantId)) {
        this.warned.add(tenantId);
        this.log.warn(
          `Tenant ${tenantId} has no tenant_modules rows — module checks are ` +
            (PROVISIONING_STRICT ? 'DENIED (PROVISIONING_STRICT).' : 'passing unenforced.') +
            ' Assign a plan, or run the production seed to provision the default modules.',
        );
      }
      // Fail closed only when explicitly asked to; otherwise keep a live plant
      // working through a provisioning gap (a business decision, not a bug).
      return !PROVISIONING_STRICT;
    }
    return modules.has(moduleKey);
  }
}
