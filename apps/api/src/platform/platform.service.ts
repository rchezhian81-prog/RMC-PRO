import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MODULE_CATALOG, MODULE_KEYS, ROLE_KEYS } from '@rmc/shared';
import { TenantDbService } from '../core/database/tenant-db.service';
import { provisionTenantRoles } from '../core/database/provision-tenant-roles';
import { TenantAccessService } from '../rbac/tenant-access.service';
import {
  ModuleEntity,
  PlanModule,
  Role,
  SubscriptionPlan,
  Tenant,
  TenantModule,
  User,
  UserRole,
} from '../core/database/entities';
import type {
  CreatePlanDto,
  CreateTenantDto,
  CreateTenantUserDto,
  UpdatePlanDto,
  UpdateTenantDto,
} from './dto/platform.dto';

/**
 * What a tenant gets when it is created without a plan. Enforcement reads
 * `tenant_modules`, so a tenant with no rows would either be locked out of
 * everything or (as the guard actually decides) unenforced — neither is a state
 * to leave a paying plant in. Phase 1 is the shipped product, so that is the
 * honest default until the platform assigns a real plan.
 */
const DEFAULT_TENANT_MODULES = MODULE_CATALOG.filter((m) => m.phase === 1).map((m) => m.key);

@Injectable()
export class PlatformService {
  constructor(
    private readonly db: TenantDbService,
    private readonly access: TenantAccessService,
  ) {}
  private get ds() {
    return this.db.ds;
  }

  // ---- Tenants ----
  async listTenants() {
    const [tenants, plans, tms] = await Promise.all([
      this.ds.getRepository(Tenant).find({ order: { tenantCode: 'ASC' } }),
      this.ds.getRepository(SubscriptionPlan).find(),
      this.ds.getRepository(TenantModule).find({ where: { isEnabled: true } }),
    ]);
    const planCode = new Map(plans.map((p) => [p.id, p.planCode]));
    const counts = new Map<string, number>();
    for (const tm of tms) counts.set(tm.tenantId, (counts.get(tm.tenantId) ?? 0) + 1);
    return tenants.map((t) => ({
      id: t.id,
      code: t.tenantCode,
      name: t.tenantName,
      status: t.status,
      planCode: t.currentPlanId ? (planCode.get(t.currentPlanId) ?? null) : null,
      enabledModules: counts.get(t.id) ?? 0,
    }));
  }

  async createTenant(dto: CreateTenantDto) {
    const repo = this.ds.getRepository(Tenant);
    if (await repo.findOne({ where: { tenantCode: dto.tenantCode } })) {
      throw new BadRequestException({ code: 'DUPLICATE_RECORD', message: 'Tenant code exists' });
    }
    const tenant = await repo.save(
      repo.create({
        tenantCode: dto.tenantCode,
        tenantName: dto.tenantName,
        legalName: dto.legalName ?? null,
        status: 'active',
      }),
    );
    if (dto.planId) await this.assignPlan(tenant.id, dto.planId);
    else await this.provisionDefaultModules(tenant.id);
    // Roles at creation, not at the next deploy. Waiting for the seed meant a
    // plant onboarded between deploys had only Owner and Admin, so its first
    // staff logins had to be made Company Admins — handing a batching operator
    // the billing, users and settings screens.
    await this.db.runInTenant(tenant.id, (m) => provisionTenantRoles(m, tenant.id));
    return this.getTenant(tenant.id);
  }

  /**
   * Give a tenant the Phase-1 module set. Used when a tenant is created without
   * a plan, so it never starts life with an empty `tenant_modules` table. Only
   * ever writes when there is nothing there — it must not undo a super admin's
   * deliberate choices.
   */
  private async provisionDefaultModules(tenantId: string): Promise<void> {
    const repo = this.ds.getRepository(TenantModule);
    if (await repo.findOne({ where: { tenantId } })) return;
    await repo.save(
      DEFAULT_TENANT_MODULES.map((moduleKey) => repo.create({ tenantId, moduleKey, isEnabled: true })),
    );
    this.access.invalidate(tenantId);
  }

  // ---- Tenant users (bootstrap the first login for a plant) ----
  async listTenantUsers(tenantId: string) {
    await this.getTenant(tenantId); // 404 if the tenant does not exist
    const users = await this.ds.getRepository(User).find({
      where: { tenantId },
      order: { email: 'ASC' },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      userType: u.userType,
      status: u.status,
      lastLoginAt: u.lastLoginAt ?? null,
    }));
  }

  /**
   * Create a login user for a tenant. Used to bootstrap the FIRST user of a new
   * plant (the tenant portal's own user screen needs an existing tenant user to
   * open). The first user is given the Company Owner role (full access); after
   * that, the tenant manages its own users from inside the portal. Tenant-scoped
   * rows are written through `runInTenant` so PostgreSQL RLS accepts them.
   */
  async createTenantUser(tenantId: string, dto: CreateTenantUserDto) {
    await this.getTenant(tenantId);
    const email = dto.email.trim().toLowerCase();
    if (await this.ds.getRepository(User).findOne({ where: { email } })) {
      throw new BadRequestException({
        code: 'DUPLICATE_RECORD',
        message: 'A user with this email already exists',
      });
    }
    const passwordHash = bcrypt.hashSync(dto.password, 10);

    return this.db.runInTenant(tenantId, async (m) => {
      // Covers tenants created before roles were provisioned at creation. It
      // only fills gaps, so for a tenant created today this finds nothing to do.
      // Crucially it grants the tenant permission set, not the whole catalogue:
      // the previous code here handed Owner and Admin every `platform.*` key
      // too, which is a customer holding the platform's own controls.
      await provisionTenantRoles(m, tenantId);
      const ownerRole = await m.findOne(Role, {
        where: { tenantId, roleKey: ROLE_KEYS.COMPANY_OWNER },
      });
      if (!ownerRole) {
        throw new BadRequestException({
          code: 'RECORD_NOT_FOUND',
          message: 'This tenant has no Company Owner role. Re-run the production seed.',
        });
      }

      const user = await m.save(
        m.create(User, {
          tenantId,
          name: dto.name.trim(),
          email,
          passwordHash,
          userType: 'tenant_user',
          status: 'active',
        }),
      );
      await m.save(m.create(UserRole, { tenantId, userId: user.id, roleId: ownerRole.id }));
      return { id: user.id, name: user.name, email: user.email, userType: user.userType };
    });
  }

  async getTenant(id: string) {
    const t = await this.ds.getRepository(Tenant).findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Tenant not found' });
    let planCode: string | null = null;
    if (t.currentPlanId) {
      const p = await this.ds.getRepository(SubscriptionPlan).findOne({
        where: { id: t.currentPlanId },
      });
      planCode = p?.planCode ?? null;
    }
    return {
      id: t.id,
      code: t.tenantCode,
      name: t.tenantName,
      legalName: t.legalName,
      status: t.status,
      currentPlanId: t.currentPlanId,
      planCode,
    };
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    const repo = this.ds.getRepository(Tenant);
    const t = await repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Tenant not found' });
    await repo.update(id, {
      ...(dto.tenantName !== undefined ? { tenantName: dto.tenantName } : {}),
      ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
      ...(dto.status !== undefined ? { status: dto.status as Tenant['status'] } : {}),
    });
    // Guards read a short-lived cache; drop it so a suspension takes hold now
    // rather than when the entry happens to expire.
    this.access.invalidate(id);
    return this.getTenant(id);
  }

  async assignPlan(tenantId: string, planId: string) {
    const tenantRepo = this.ds.getRepository(Tenant);
    const t = await tenantRepo.findOne({ where: { id: tenantId } });
    if (!t) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Tenant not found' });
    const plan = await this.ds.getRepository(SubscriptionPlan).findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plan not found' });

    await tenantRepo.update(tenantId, { currentPlanId: planId });
    // Reset the tenant's modules to the plan's enabled modules.
    const tmRepo = this.ds.getRepository(TenantModule);
    await tmRepo.delete({ tenantId });
    const planMods = await this.ds
      .getRepository(PlanModule)
      .find({ where: { planId, isEnabled: true } });
    if (planMods.length) {
      await tmRepo.save(
        planMods.map((pm) =>
          tmRepo.create({ tenantId, moduleKey: pm.moduleKey, isEnabled: true }),
        ),
      );
    }
    this.access.invalidate(tenantId);
    return this.getTenantModules(tenantId);
  }

  async getTenantModules(tenantId: string) {
    const [catalog, tms] = await Promise.all([
      this.ds.getRepository(ModuleEntity).find({ order: { phase: 'ASC', name: 'ASC' } }),
      this.ds.getRepository(TenantModule).find({ where: { tenantId } }),
    ]);
    const enabled = new Map(tms.map((tm) => [tm.moduleKey, tm.isEnabled]));
    return catalog.map((mod) => ({
      moduleKey: mod.moduleKey,
      name: mod.name,
      phase: mod.phase,
      isEnabled: enabled.get(mod.moduleKey) ?? false,
    }));
  }

  async setTenantModule(tenantId: string, moduleKey: string, isEnabled: boolean) {
    if (!MODULE_KEYS.includes(moduleKey)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown module' });
    }
    const repo = this.ds.getRepository(TenantModule);
    const existing = await repo.findOne({ where: { tenantId, moduleKey } });
    if (existing) await repo.update(existing.id, { isEnabled });
    else await repo.save(repo.create({ tenantId, moduleKey, isEnabled }));
    this.access.invalidate(tenantId);
    return this.getTenantModules(tenantId);
  }

  // ---- Plans ----
  async listPlans() {
    const [plans, pms] = await Promise.all([
      this.ds.getRepository(SubscriptionPlan).find({ order: { planCode: 'ASC' } }),
      this.ds.getRepository(PlanModule).find({ where: { isEnabled: true } }),
    ]);
    const counts = new Map<string, number>();
    for (const pm of pms) counts.set(pm.planId, (counts.get(pm.planId) ?? 0) + 1);
    return plans.map((p) => ({
      id: p.id,
      code: p.planCode,
      name: p.planName,
      monthlyPrice: p.monthlyPrice,
      yearlyPrice: p.yearlyPrice,
      maxPlants: p.maxPlants,
      maxUsers: p.maxUsers,
      isActive: p.isActive,
      moduleCount: counts.get(p.id) ?? 0,
    }));
  }

  async createPlan(dto: CreatePlanDto) {
    const repo = this.ds.getRepository(SubscriptionPlan);
    if (await repo.findOne({ where: { planCode: dto.planCode } })) {
      throw new BadRequestException({ code: 'DUPLICATE_RECORD', message: 'Plan code exists' });
    }
    const plan = await repo.save(
      repo.create({
        planCode: dto.planCode,
        planName: dto.planName,
        monthlyPrice: dto.monthlyPrice ?? 0,
        yearlyPrice: dto.yearlyPrice ?? 0,
        maxPlants: dto.maxPlants ?? 1,
        maxUsers: dto.maxUsers ?? 5,
      }),
    );
    return this.getPlan(plan.id);
  }

  async getPlan(id: string) {
    const p = await this.ds.getRepository(SubscriptionPlan).findOne({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plan not found' });
    const mods = await this.ds.getRepository(PlanModule).find({ where: { planId: id } });
    return {
      id: p.id,
      code: p.planCode,
      name: p.planName,
      monthlyPrice: p.monthlyPrice,
      yearlyPrice: p.yearlyPrice,
      maxPlants: p.maxPlants,
      maxUsers: p.maxUsers,
      isActive: p.isActive,
      modules: mods.filter((mm) => mm.isEnabled).map((mm) => mm.moduleKey),
    };
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const repo = this.ds.getRepository(SubscriptionPlan);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plan not found' });
    await repo.update(id, {
      ...(dto.planName !== undefined ? { planName: dto.planName } : {}),
      ...(dto.monthlyPrice !== undefined ? { monthlyPrice: dto.monthlyPrice } : {}),
      ...(dto.yearlyPrice !== undefined ? { yearlyPrice: dto.yearlyPrice } : {}),
      ...(dto.maxPlants !== undefined ? { maxPlants: dto.maxPlants } : {}),
      ...(dto.maxUsers !== undefined ? { maxUsers: dto.maxUsers } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    return this.getPlan(id);
  }

  async setPlanModules(planId: string, moduleKeys: string[]) {
    const plan = await this.ds.getRepository(SubscriptionPlan).findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plan not found' });
    const invalid = moduleKeys.filter((k) => !MODULE_KEYS.includes(k));
    if (invalid.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Unknown modules: ${invalid.join(', ')}`,
      });
    }
    const repo = this.ds.getRepository(PlanModule);
    await repo.delete({ planId });
    if (moduleKeys.length) {
      await repo.save(
        moduleKeys.map((k) => repo.create({ planId, moduleKey: k, isEnabled: true })),
      );
    }
    return this.getPlan(planId);
  }

  // ---- Module catalog ----
  listModules() {
    return this.ds.getRepository(ModuleEntity).find({ order: { phase: 'ASC', name: 'ASC' } });
  }
}
