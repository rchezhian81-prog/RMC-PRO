import { Column, Entity, Unique } from 'typeorm';
import { BaseUuidEntity } from './base.entity';

/** Subscription plan (Design Doc 6 §4.2). Global/platform table (no RLS). */
@Entity('subscription_plans')
export class SubscriptionPlan extends BaseUuidEntity {
  @Column({ name: 'plan_code', type: 'varchar', unique: true })
  planCode!: string;

  @Column({ name: 'plan_name', type: 'varchar' })
  planName!: string;

  @Column({ name: 'monthly_price', type: 'int', default: 0 })
  monthlyPrice!: number;

  @Column({ name: 'yearly_price', type: 'int', default: 0 })
  yearlyPrice!: number;

  @Column({ name: 'max_plants', type: 'int', default: 1 })
  maxPlants!: number;

  @Column({ name: 'max_users', type: 'int', default: 5 })
  maxUsers!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}

/** Modules included in a plan (Design Doc 6 §4.3). */
@Entity('plan_modules')
@Unique('uq_plan_modules', ['planId', 'moduleKey'])
export class PlanModule extends BaseUuidEntity {
  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'module_key', type: 'varchar' })
  moduleKey!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;
}

/** Module catalog (reference). */
@Entity('modules')
export class ModuleEntity extends BaseUuidEntity {
  @Column({ name: 'module_key', type: 'varchar', unique: true })
  moduleKey!: string;

  @Column({ name: 'name', type: 'varchar' })
  name!: string;

  @Column({ name: 'phase', type: 'int' })
  phase!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}

/**
 * Effective per-tenant module enablement (Design Doc 4 §4.7). Platform-managed
 * (Super Admin writes; the module guard reads scoped by the JWT tenant_id).
 * Not RLS-protected so Super Admin platform APIs can manage it cross-tenant.
 */
@Entity('tenant_modules')
@Unique('uq_tenant_modules', ['tenantId', 'moduleKey'])
export class TenantModule extends BaseUuidEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'module_key', type: 'varchar' })
  moduleKey!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;
}
