import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ROLE_KEYS, passwordProblemMessage } from '@rmc/shared';
import { TenantCrudService } from '../common/tenant-crud.service';
import { TenantDbService } from '../core/database/tenant-db.service';
import { PlanLimitsService } from '../rbac/plan-limits.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import {
  Company,
  NumberSeries,
  Permission,
  Role,
  RolePermission,
  TenantSetting,
  User,
  UserRole,
} from '../core/database/entities';

/** Company profile — one row per tenant (Design Doc 6 §5.1). */
@Injectable()
export class CompanyService {
  constructor(private readonly db: TenantDbService) {}

  get(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(Company).find({ take: 1 });
      return rows[0] ?? null;
    });
  }

  update(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Company);
      const existing = (await repo.find({ take: 1 }))[0];
      const rest = { ...dto };
      delete rest.tenantId;
      delete rest.id;
      if (!existing) return repo.save(repo.create({ ...rest, tenantId } as DeepPartial<Company>));
      await repo.update(existing.id, rest as any);
      return repo.findOne({ where: { id: existing.id } });
    });
  }
}

/** Tenant settings key/value (Design Doc 6 §5.5). */
@Injectable()
export class SettingsService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(TenantSetting).find({ order: { settingKey: 'ASC' } }),
    );
  }

  set(tenantId: string, key: string, value: string, dataType = 'string') {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(TenantSetting);
      const existing = await repo.findOne({ where: { settingKey: key } });
      if (existing) await repo.update(existing.id, { settingValue: value, dataType });
      else await repo.save(repo.create({ tenantId, settingKey: key, settingValue: value, dataType }));
      return repo.findOne({ where: { settingKey: key } });
    });
  }
}

/** Number series (base CRUD). */
@Injectable()
export class NumberSeriesService extends TenantCrudService<NumberSeries> {
  constructor(db: TenantDbService) {
    super(db, NumberSeries, {
      orderBy: 'documentType',
      required: ['documentType'],
      // NumberSeries has no `status` column — deactivate via isActive.
      softDelete: { field: 'isActive', value: false },
    });
  }
}

/** Tenant-side user management (Design Doc 6 §6.1). users has no RLS — scope by tenant_id. */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantDbService,
    private readonly planLimits: PlanLimitsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    const users = await this.db.ds
      .getRepository(User)
      .find({ where: { tenantId }, order: { name: 'ASC' } });

    // Carry each user's role, so the list shows who can do what. A user with no
    // role has no permissions at all, which the UI needs to be able to flag.
    const assignments: Array<{ user_id: string; role_id: string; role_key: string; role_name: string }> =
      await this.db.runInTenant(tenantId, (m) =>
        m.query(
          `SELECT ur.user_id, r.id AS role_id, r.role_key, r.role_name
             FROM user_roles ur JOIN roles r ON r.id = ur.role_id`,
        ),
      );
    const roleOf = new Map(assignments.map((a) => [a.user_id, a]));

    return users.map((u) => {
      const r = roleOf.get(u.id);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        status: u.status,
        userType: u.userType,
        roleId: r?.role_id ?? null,
        roleKey: r?.role_key ?? null,
        roleName: r?.role_name ?? null,
      };
    });
  }

  async create(tenantId: string, dto: Record<string, unknown>, actingUserId?: string) {
    const name = String(dto.name ?? '').trim();
    const email = String(dto.email ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !email || !password) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'name, email, password required',
      });
    }
    const problem = passwordProblemMessage(password);
    if (problem) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: problem });
    const repo = this.db.ds.getRepository(User);
    if (await repo.findOne({ where: { email } })) {
      throw new BadRequestException({ code: 'DUPLICATE_RECORD', message: 'Email already exists' });
    }
    // Checked after the duplicate test, so retrying an email that already exists
    // does not report a seat problem the administrator cannot act on.
    await this.planLimits.assertCanAddUser(tenantId);
    const user = await repo.save(
      repo.create({
        tenantId,
        name,
        email,
        mobile: dto.mobile ? String(dto.mobile) : null,
        passwordHash: bcrypt.hashSync(password, 10),
        userType: 'tenant_user',
      }),
    );
    if (dto.roleId) {
      await this.db.runInTenant(tenantId, (m) =>
        m
          .getRepository(UserRole)
          .save(m.getRepository(UserRole).create({ tenantId, userId: user.id, roleId: String(dto.roleId) })),
      );
    }
    await this.audit.record({
      tenantId,
      actorUserId: actingUserId ?? null,
      action: AUDIT_ACTIONS.USER_CREATE,
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.email,
      summary: `Created user ${user.email}`,
    });
    return { id: user.id, name: user.name, email: user.email, status: user.status };
  }

  /** Does this user hold the company-owner role? */
  private async isOwner(tenantId: string, userId: string): Promise<boolean> {
    const rows: Array<{ n: string }> = await this.db.runInTenant(tenantId, (m) =>
      m.query(
        `SELECT count(*) AS n
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND r.role_key = $2`,
        [userId, ROLE_KEYS.COMPANY_OWNER],
      ),
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /**
   * Update a user. `actingUserId` is the person making the change, which is
   * what the safety rules below are judged against.
   */
  async update(tenantId: string, id: string, dto: Record<string, unknown>, actingUserId?: string) {
    const repo = this.db.ds.getRepository(User);
    const user = await repo.findOne({ where: { id, tenantId } });
    if (!user) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'User not found' });

    const isSelf = actingUserId === id;
    const touchesPrivileged =
      dto.password !== undefined || dto.status !== undefined || dto.roleId !== undefined;

    // A Company Admin also holds users.manage. Without this, they could reset
    // the owner's password, deactivate them, or strip their role — taking over
    // the tenant. Only the owner may act on the owner.
    if (touchesPrivileged && !isSelf && (await this.isOwner(tenantId, id))) {
      const actorIsOwner = actingUserId ? await this.isOwner(tenantId, actingUserId) : false;
      if (!actorIsOwner) {
        throw new BadRequestException({
          code: 'PERMISSION_DENIED',
          message: 'Only the company owner can change the owner’s password, role, or status.',
        });
      }
    }

    // Deactivating yourself locks you out of the screen you are standing on.
    if (isSelf && dto.status !== undefined && String(dto.status) !== 'active') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'You cannot deactivate your own account. Ask another administrator.',
      });
    }
    // Likewise, removing your own role would leave you with no access at all.
    if (isSelf && dto.roleId !== undefined && !String(dto.roleId ?? '').trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'You cannot remove your own role — you would lose access immediately.',
      });
    }

    // Reactivating someone takes a seat back, so it is bounded by the plan the
    // same way creating one is. Only checked on the inactive → active edge; a
    // no-op update on an already-active user must not fail when seats are full.
    if (dto.status !== undefined && String(dto.status) === 'active' && user.status !== 'active') {
      await this.planLimits.assertCanAddUser(tenantId);
    }

    let passwordHash: string | undefined;
    if (dto.password !== undefined) {
      const problem = passwordProblemMessage(String(dto.password ?? ''));
      if (problem) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: problem });
      passwordHash = bcrypt.hashSync(String(dto.password), 10);
    }

    await repo.update(id, {
      ...(dto.name !== undefined ? { name: String(dto.name) } : {}),
      ...(dto.status !== undefined ? { status: String(dto.status) } : {}),
      ...(dto.mobile !== undefined ? { mobile: dto.mobile ? String(dto.mobile) : null } : {}),
      ...(passwordHash ? { passwordHash } : {}),
    });

    // Role change: a user holds one role here, so replace rather than append.
    // An empty roleId clears the role, which leaves the user with no access —
    // the honest way to suspend someone without deleting their history.
    let newRoleName: string | null = null;
    if (dto.roleId !== undefined) {
      const roleId = String(dto.roleId ?? '').trim();
      await this.db.runInTenant(tenantId, async (m) => {
        if (roleId) {
          const role = await m.getRepository(Role).findOne({ where: { id: roleId } });
          if (!role) {
            throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown role' });
          }
          newRoleName = role.roleName;
        }
        await m.getRepository(UserRole).delete({ userId: id });
        if (roleId) {
          await m.getRepository(UserRole).save(
            m.getRepository(UserRole).create({ tenantId, userId: id, roleId }),
          );
        }
      });
    }

    // One record per kind of change, so the trail reads as distinct events —
    // "reset the password", "deactivated", "changed the role" — rather than a
    // single opaque "updated user".
    await this.recordUserChanges(tenantId, actingUserId ?? null, user, dto, newRoleName);
    return this.list(tenantId).then((rows) => rows.find((r) => r.id === id));
  }

  /** Emit an audit event for each consequential field the update touched. */
  private async recordUserChanges(
    tenantId: string,
    actorUserId: string | null,
    before: User,
    dto: Record<string, unknown>,
    newRoleName: string | null,
  ): Promise<void> {
    const target = before.email;
    const base = { tenantId, actorUserId, entityType: 'user', entityId: before.id, entityLabel: target };

    if (dto.password !== undefined) {
      // The action is recorded; the password itself is never part of the trail.
      await this.audit.record({ ...base, action: AUDIT_ACTIONS.USER_PASSWORD_RESET, summary: `Reset the password for ${target}` });
    }
    if (dto.status !== undefined && String(dto.status) !== before.status) {
      const activating = String(dto.status) === 'active';
      await this.audit.record({
        ...base,
        action: activating ? AUDIT_ACTIONS.USER_REACTIVATE : AUDIT_ACTIONS.USER_DEACTIVATE,
        summary: `${activating ? 'Reactivated' : 'Deactivated'} ${target}`,
      });
    }
    if (dto.roleId !== undefined) {
      await this.audit.record({
        ...base,
        action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
        summary: newRoleName ? `Changed ${target}'s role to ${newRoleName}` : `Removed ${target}'s role`,
        details: { role: newRoleName },
      });
    }
  }
}

/** Tenant-side role + permission management (Design Doc 6 §6.2–6.4). */
@Injectable()
export class RolesService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Role).find({ order: { roleName: 'ASC' } }),
    );
  }

  permissionCatalog() {
    return this.db.ds.getRepository(Permission).find({ order: { moduleKey: 'ASC' } });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const roleKey = String(dto.roleKey ?? '').trim();
    const roleName = String(dto.roleName ?? '').trim();
    if (!roleKey || !roleName) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'roleKey, roleName required' });
    }
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Role).save(m.getRepository(Role).create({ tenantId, roleKey, roleName })),
    );
  }

  /** Rename a role. System roles (owner/admin/etc.) are protected. */
  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Role);
      const role = await repo.findOne({ where: { id } });
      if (!role) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Role not found' });
      if (role.isSystemRole) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'System roles cannot be modified' });
      }
      const roleName = String(dto.roleName ?? '').trim();
      if (!roleName) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'roleName required' });
      await repo.update(id, { roleName });
      return repo.findOne({ where: { id } });
    });
  }

  /** Delete a role. Blocked for system roles and roles still assigned to users. */
  remove(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const role = await m.getRepository(Role).findOne({ where: { id } });
      if (!role) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Role not found' });
      if (role.isSystemRole) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'System roles cannot be deleted' });
      }
      const assigned = await m.getRepository(UserRole).count({ where: { roleId: id } });
      if (assigned > 0) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Role is assigned to ${assigned} user(s); remove those assignments first`,
        });
      }
      await m.getRepository(RolePermission).delete({ roleId: id });
      await m.getRepository(Role).delete(id);
      return { deleted: true };
    });
  }

  getPermissions(tenantId: string, roleId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows: Array<{ id: string }> = await m.query(
        `SELECT permission_id AS id FROM role_permissions WHERE role_id = $1`,
        [roleId],
      );
      return rows.map((r) => r.id);
    });
  }

  setPermissions(tenantId: string, roleId: string, permissionIds: string[]) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RolePermission);
      await repo.delete({ roleId });
      if (permissionIds.length) {
        await repo.save(
          permissionIds.map((permissionId) => repo.create({ tenantId, roleId, permissionId })),
        );
      }
      return this.getPermissions(tenantId, roleId);
    });
  }
}
