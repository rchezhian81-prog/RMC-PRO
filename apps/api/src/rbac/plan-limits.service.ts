import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Plant, SubscriptionPlan, Tenant, User } from '../core/database/entities';

/**
 * When set, a tenant with no plan is capped at zero (limits fail closed) rather
 * than treated as unlimited. Off by default; recommended ON in production once
 * every tenant has a plan assigned. Set `PROVISIONING_STRICT=1`.
 */
const PROVISIONING_STRICT =
  process.env.PROVISIONING_STRICT === '1' || process.env.PROVISIONING_STRICT === 'true';

/** What a plan permits, and what the tenant is currently using. */
export interface LimitUsage {
  used: number;
  /** null when no plan is assigned — see `limitsOf` for why that means unlimited. */
  limit: number | null;
}

export interface PlanUsage {
  planName: string | null;
  users: LimitUsage;
  plants: LimitUsage;
}

@Injectable()
export class PlanLimitsService {
  private readonly log = new Logger(PlanLimitsService.name);
  /** Tenants already reported as having no plan, so the warning is logged once each. */
  private readonly warned = new Set<string>();

  constructor(private readonly db: TenantDbService) {}

  /**
   * The seat and plant caps for a tenant.
   *
   * A tenant with no plan assigned gets `null` for both, meaning unenforced.
   * Reading "no plan" as "zero users" would stop a plant adding staff over a
   * provisioning gap rather than a commercial decision — the same reasoning that
   * governs module entitlements. It logs once per tenant so the gap is visible
   * rather than silent.
   */
  private async limitsOf(tenantId: string): Promise<{ planName: string | null; maxUsers: number | null; maxPlants: number | null }> {
    const tenant = await this.db.ds.getRepository(Tenant).findOne({ where: { id: tenantId } });
    const planId = tenant?.currentPlanId ?? null;
    if (!planId) {
      if (!this.warned.has(tenantId)) {
        this.warned.add(tenantId);
        this.log.warn(
          `Tenant ${tenantId} has no subscription plan — user and plant limits are ` +
            (PROVISIONING_STRICT ? 'capped at zero (PROVISIONING_STRICT).' : 'not enforced.') +
            ' Assign a plan from the admin portal to apply them.',
        );
      }
      // Fail closed (cap at zero) only under strict provisioning; otherwise leave
      // limits unenforced so a provisioning gap does not block adding staff.
      return PROVISIONING_STRICT
        ? { planName: null, maxUsers: 0, maxPlants: 0 }
        : { planName: null, maxUsers: null, maxPlants: null };
    }
    const plan = await this.db.ds.getRepository(SubscriptionPlan).findOne({ where: { id: planId } });
    if (!plan) return { planName: null, maxUsers: null, maxPlants: null };
    return { planName: plan.planName, maxUsers: plan.maxUsers, maxPlants: plan.maxPlants };
  }

  /**
   * Seats in use. Counts **active** users only, so deactivating someone frees
   * their seat — otherwise a plant that loses a driver would have to buy a
   * bigger plan to replace them. Read on the plain connection because `users`
   * is not RLS-scoped; the tenant id comes from the verified JWT.
   */
  private countUsers(tenantId: string): Promise<number> {
    return this.db.ds.getRepository(User).count({ where: { tenantId, status: 'active' } });
  }

  /** Plants in use. Also active-only: a decommissioned plant does not occupy a slot. */
  private countPlants(tenantId: string): Promise<number> {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Plant).count({ where: { tenantId, status: 'active' } }),
    );
  }

  /** Both counts and both caps — what the UI needs to show "3 of 5" before anyone clicks. */
  async usage(tenantId: string): Promise<PlanUsage> {
    const [limits, users, plants] = await Promise.all([
      this.limitsOf(tenantId),
      this.countUsers(tenantId),
      this.countPlants(tenantId),
    ]);
    return {
      planName: limits.planName,
      users: { used: users, limit: limits.maxUsers },
      plants: { used: plants, limit: limits.maxPlants },
    };
  }

  /**
   * Refuse a new (or newly reactivated) login when the plan's seats are full.
   * The message names the plan and says what can be done about it, because the
   * person who hits this is an office administrator who cannot change the
   * subscription themselves.
   */
  async assertCanAddUser(tenantId: string): Promise<void> {
    const { maxUsers, planName } = await this.limitsOf(tenantId);
    if (maxUsers === null) return;
    const used = await this.countUsers(tenantId);
    if (used < maxUsers) return;
    throw new BadRequestException({
      code: 'PLAN_LIMIT_EXCEEDED',
      message:
        `Your ${planName ?? 'current'} plan includes ${maxUsers} user${maxUsers === 1 ? '' : 's'} ` +
        `and all ${maxUsers} are in use. Deactivate someone who has left, or contact Mix Nova to add seats.`,
    });
  }

  /** The same rule for plants. */
  async assertCanAddPlant(tenantId: string): Promise<void> {
    const { maxPlants, planName } = await this.limitsOf(tenantId);
    if (maxPlants === null) return;
    const used = await this.countPlants(tenantId);
    if (used < maxPlants) return;
    throw new BadRequestException({
      code: 'PLAN_LIMIT_EXCEEDED',
      message:
        `Your ${planName ?? 'current'} plan covers ${maxPlants} plant${maxPlants === 1 ? '' : 's'} ` +
        `and all ${maxPlants} are in use. Contact Mix Nova to add another plant.`,
    });
  }
}
