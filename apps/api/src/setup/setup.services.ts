import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In, type DeepPartial } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  ROLE_KEYS, passwordProblemMessage, validateCompanyProfile,
  SETTINGS_CATALOG, SETTINGS_BY_KEY, validateSettingValue, isPlatformPermission,
} from '@rmc/shared';
import { TenantCrudService } from '../common/tenant-crud.service';
import { TenantDbService } from '../core/database/tenant-db.service';
import { PlanLimitsService } from '../rbac/plan-limits.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { validateLogo } from './logo';
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
  constructor(private readonly db: TenantDbService, private readonly audit: AuditService) {}

  get(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(Company).find({ take: 1 });
      return rows[0] ?? null;
    });
  }

  async update(tenantId: string, dto: Record<string, unknown>, userId: string) {
    // Validate the identity fields before saving — the company GSTIN prints on
    // every tax invoice, so a malformed one must never be persisted (PAN / PIN /
    // email / phone are checked for the same reason).
    const bad = validateCompanyProfile(dto);
    if (Object.keys(bad).length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: Object.values(bad).join(' '),
        fields: bad,
      });
    }
    // Whitelist the columns the profile actually has. Anything else the client
    // sends is ignored rather than crashing the update — TypeORM throws on an
    // unknown property, which would otherwise surface as an opaque 500.
    const patch: Record<string, unknown> = {};
    const fields = [
      'companyName', 'legalName', 'gstin', 'pan', 'addressLine1', 'addressLine2',
      'city', 'state', 'pincode', 'phone', 'email', 'website',
      'bankName', 'bankAccountNo', 'bankIfsc', 'bankBranch',
    ] as const;
    for (const k of fields) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const result = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Company);
      const existing = (await repo.find({ take: 1 }))[0];
      if (!existing) {
        // Every tenant is provisioned a company row now, so this is a safety
        // net. company_name is NOT NULL, so refuse cleanly rather than 500.
        if (!String(patch.companyName ?? '').trim()) {
          throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Company name is required.' });
        }
        return repo.save(repo.create({ ...patch, tenantId } as DeepPartial<Company>));
      }
      await repo.update(existing.id, patch as DeepPartial<Company>);
      return repo.findOne({ where: { id: existing.id } });
    });
    // The company profile carries the GSTIN that prints on every tax invoice and
    // the bank details — a change belongs in the trail. Field NAMES only (values
    // may be sensitive; audit.record redacts, but we keep it to keys regardless).
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.COMPANY_UPDATE,
      entityType: 'company', entityId: result?.id ?? null, entityLabel: result?.companyName ?? null,
      summary: 'Updated the company profile',
      details: { fields: Object.keys(patch) },
    });
    return result;
  }

  /**
   * Store (or replace) the company logo. Validation is authoritative here — the
   * bytes are sniffed and size-capped — so the browser cannot smuggle in a bad
   * file. Kept off the text-profile `update()` path so a routine profile save
   * never carries the logo payload.
   */
  setLogo(tenantId: string, rawMime: unknown, rawData: unknown) {
    const { mime, data } = validateLogo(rawMime, rawData);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Company);
      const existing = (await repo.find({ take: 1 }))[0];
      if (!existing) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Save the company name first, then upload a logo.',
        });
      }
      await repo.update(existing.id, { logoMime: mime, logoData: data } as DeepPartial<Company>);
      return { hasLogo: true, logoMime: mime };
    });
  }

  /** Remove the logo — invoices fall back to the text header. */
  removeLogo(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Company);
      const existing = (await repo.find({ take: 1 }))[0];
      if (existing) {
        await repo.update(existing.id, { logoMime: null, logoData: null } as DeepPartial<Company>);
      }
      return { hasLogo: false };
    });
  }
}

/** Tenant settings key/value (Design Doc 6 §5.5). */
@Injectable()
export class SettingsService {
  constructor(private readonly db: TenantDbService, private readonly audit: AuditService) {}

  /**
   * The catalogue, in order, each enriched with the tenant's stored value (or
   * its default when unset). Drives the typed Settings screen — every known
   * setting appears whether or not it has a row yet.
   */
  list(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const stored = await m.getRepository(TenantSetting).find();
      const byKey = new Map(stored.map((s) => [s.settingKey, s.settingValue]));
      return SETTINGS_CATALOG.map((def) => ({
        key: def.key,
        label: def.label,
        description: def.description,
        type: def.type,
        options: def.options ?? null,
        value: byKey.has(def.key) ? byKey.get(def.key) ?? '' : def.default,
      }));
    });
  }

  /**
   * Write a catalogue setting. The key must be known and the value must match
   * the catalogue type (number/boolean/enum), so a typo or a wrong-typed value
   * is rejected with a 400 instead of persisting an orphan/garbage row. The
   * stored data_type always comes from the catalogue, never the client.
   */
  async set(tenantId: string, key: string, value: string, userId: string) {
    const def = SETTINGS_BY_KEY[key];
    const err = validateSettingValue(key, value);
    if (!def || err) {
      const message = err ?? `Unknown setting "${key}".`;
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message, fields: { value: message } });
    }
    const result = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(TenantSetting);
      const existing = await repo.findOne({ where: { settingKey: key } });
      if (existing) await repo.update(existing.id, { settingValue: value, dataType: def.type });
      else await repo.save(repo.create({ tenantId, settingKey: key, settingValue: value, dataType: def.type }));
      return repo.findOne({ where: { settingKey: key } });
    });
    // Tenant settings drive policy (credit gate stage, default credit days …) —
    // a change is worth a trail entry with the key and its new value.
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.SETTING_CHANGE,
      entityType: 'tenant_setting', entityId: null, entityLabel: key,
      summary: `Changed setting "${def.label}" to ${value}`,
      details: { key, value },
    });
    return result;
  }
}

/** Number series (base CRUD). */
@Injectable()
export class NumberSeriesService extends TenantCrudService<NumberSeries> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, NumberSeries, {
      orderBy: 'documentType',
      required: ['documentType'],
      // NumberSeries has no `status` column — deactivate via isActive.
      softDelete: { field: 'isActive', value: false },
      resource: 'number_series',
      labelField: 'documentType',
    }, audit);
  }
}

/** Tenant-side user management (Design Doc 6 §6.1). `users` is RLS-scoped, so
 *  reads and writes run inside the tenant's context; the one cross-tenant check
 *  (email is globally unique) runs in the platform context. */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantDbService,
    private readonly planLimits: PlanLimitsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    const users = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(User).find({ where: { tenantId }, order: { name: 'ASC' } }),
    );

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
    // Login is by email alone, so normalise to lowercase on write — otherwise
    // Foo@bar.com and foo@bar.com become two accounts and the case a user typed
    // at signup becomes the only case they can log in with.
    const email = String(dto.email ?? '').trim().toLowerCase();
    const password = String(dto.password ?? '');
    if (!name || !email || !password) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'name, email, password required',
      });
    }
    const problem = passwordProblemMessage(password);
    if (problem) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: problem });
    // Email is globally unique (login is by email alone), so the duplicate check
    // is a cross-tenant question — run it in the platform context, or RLS would
    // hide a clash in another tenant and the DB unique index would surface it as
    // an opaque 500 instead of this clean message.
    const emailTaken = await this.db.runAsPlatform((m) =>
      m.getRepository(User).createQueryBuilder('u').where('LOWER(u.email) = :email', { email }).getOne(),
    );
    if (emailTaken) {
      throw new BadRequestException({ code: 'DUPLICATE_RECORD', message: 'Email already exists' });
    }
    // A users.manage holder must not be able to mint a new Company Owner.
    await this.assertMayGrantOwnerRole(tenantId, String(dto.roleId ?? ''), actingUserId);
    // Checked after the duplicate test, so retrying an email that already exists
    // does not report a seat problem the administrator cannot act on.
    await this.planLimits.assertCanAddUser(tenantId);
    const user = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId,
          name,
          email,
          mobile: dto.mobile ? String(dto.mobile) : null,
          passwordHash: bcrypt.hashSync(password, 10),
          userType: 'tenant_user',
        }),
      ),
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

  /**
   * Only the company owner may grant the company-owner role. Without this, any
   * holder of users.manage (e.g. a Company Admin) could assign themselves — or
   * anyone — the owner role and take over the tenant: the owner-protection rule
   * only fires when the TARGET is already an owner, not when the owner role is
   * being GRANTED. The initial owner is provisioned via the platform path (a
   * direct role grant), not here, so onboarding is unaffected.
   */
  private async assertMayGrantOwnerRole(tenantId: string, roleId: string, actingUserId?: string): Promise<void> {
    if (!roleId) return;
    const rows: Array<{ role_key: string | null }> = await this.db.runInTenant(tenantId, (m) =>
      m.query(`SELECT role_key FROM roles WHERE id = $1`, [roleId]),
    );
    if (rows[0]?.role_key !== ROLE_KEYS.COMPANY_OWNER) return;
    const actorIsOwner = actingUserId ? await this.isOwner(tenantId, actingUserId) : false;
    if (!actorIsOwner) {
      throw new BadRequestException({
        code: 'PERMISSION_DENIED',
        message: 'Only the company owner can grant the company-owner role.',
      });
    }
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
    const user = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(User).findOne({ where: { id, tenantId } }),
    );
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

    // Promoting anyone (including oneself) to Company Owner is owner-only.
    if (dto.roleId !== undefined) {
      await this.assertMayGrantOwnerRole(tenantId, String(dto.roleId ?? ''), actingUserId);
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

    await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(User).update(id, {
        ...(dto.name !== undefined ? { name: String(dto.name) } : {}),
        ...(dto.status !== undefined ? { status: String(dto.status) } : {}),
        ...(dto.mobile !== undefined ? { mobile: dto.mobile ? String(dto.mobile) : null } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      }),
    );

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
  constructor(private readonly db: TenantDbService, private readonly audit: AuditService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Role).find({ order: { roleName: 'ASC' } }),
    );
  }

  permissionCatalog() {
    return this.db.ds.getRepository(Permission).find({ order: { moduleKey: 'ASC' } });
  }

  async create(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const roleKey = String(dto.roleKey ?? '').trim();
    const roleName = String(dto.roleName ?? '').trim();
    if (!roleKey || !roleName) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'roleKey, roleName required' });
    }
    const role = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Role).save(m.getRepository(Role).create({ tenantId, roleKey, roleName })),
    );
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.ROLE_CREATE,
      entityType: 'role', entityId: role.id, entityLabel: roleName,
      summary: `Created role ${roleName}`,
    });
    return role;
  }

  /** Rename a role. System roles (owner/admin/etc.) are protected. */
  async update(tenantId: string, id: string, dto: Record<string, unknown>, userId: string) {
    const result = await this.db.runInTenant(tenantId, async (m) => {
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
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.ROLE_UPDATE,
      entityType: 'role', entityId: id, entityLabel: result?.roleName ?? null,
      summary: `Renamed role to ${result?.roleName ?? ''}`.trim(),
    });
    return result;
  }

  /** Delete a role. Blocked for system roles and roles still assigned to users. */
  async remove(tenantId: string, id: string, userId: string) {
    const label = await this.db.runInTenant(tenantId, async (m) => {
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
      return role.roleName;
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.ROLE_DELETE,
      entityType: 'role', entityId: id, entityLabel: label,
      summary: `Deleted role ${label}`,
    });
    return { deleted: true };
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

  async setPermissions(tenantId: string, roleId: string, permissionIds: string[], userId: string) {
    const result = await this.db.runInTenant(tenantId, async (m) => {
      // Privilege-escalation guard: a tenant admin must never grant a platform.*
      // permission to a tenant role. The provisioning path already filters these
      // out; the live editor did not, so it was the one place a tenant could hand
      // itself cross-tenant/platform authority. Reject any platform key here.
      if (permissionIds.length) {
        const perms = await this.db.ds.getRepository(Permission).find({ where: { id: In(permissionIds) } });
        const platform = perms.filter((p) => isPlatformPermission(p.permissionKey));
        if (platform.length) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `Platform permissions cannot be assigned to a tenant role: ${platform.map((p) => p.permissionKey).join(', ')}`,
          });
        }
      }
      const repo = m.getRepository(RolePermission);
      await repo.delete({ roleId });
      if (permissionIds.length) {
        await repo.save(
          permissionIds.map((permissionId) => repo.create({ tenantId, roleId, permissionId })),
        );
      }
      return this.getPermissions(tenantId, roleId);
    });
    // A permission grant is the single most privilege-relevant tenant action —
    // it belongs in the trail (the count of permissions on the role after the set).
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.ROLE_PERMISSION_CHANGE,
      entityType: 'role', entityId: roleId, entityLabel: null,
      summary: `Set ${permissionIds.length} permission(s) on a role`,
      details: { count: permissionIds.length },
    });
    return result;
  }
}
