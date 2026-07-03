import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TenantCrudService } from '../common/tenant-crud.service';
import { TenantDbService } from '../core/database/tenant-db.service';
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
    super(db, NumberSeries, { orderBy: 'documentType', required: ['documentType'] });
  }
}

/** Tenant-side user management (Design Doc 6 §6.1). users has no RLS — scope by tenant_id. */
@Injectable()
export class UsersService {
  constructor(private readonly db: TenantDbService) {}

  async list(tenantId: string) {
    const users = await this.db.ds
      .getRepository(User)
      .find({ where: { tenantId }, order: { name: 'ASC' } });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      status: u.status,
      userType: u.userType,
    }));
  }

  async create(tenantId: string, dto: Record<string, unknown>) {
    const name = String(dto.name ?? '').trim();
    const email = String(dto.email ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !email || !password) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'name, email, password required',
      });
    }
    const repo = this.db.ds.getRepository(User);
    if (await repo.findOne({ where: { email } })) {
      throw new BadRequestException({ code: 'DUPLICATE_RECORD', message: 'Email already exists' });
    }
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
    return { id: user.id, name: user.name, email: user.email, status: user.status };
  }

  async update(tenantId: string, id: string, dto: Record<string, unknown>) {
    const repo = this.db.ds.getRepository(User);
    const user = await repo.findOne({ where: { id, tenantId } });
    if (!user) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'User not found' });
    await repo.update(id, {
      ...(dto.name !== undefined ? { name: String(dto.name) } : {}),
      ...(dto.status !== undefined ? { status: String(dto.status) } : {}),
      ...(dto.mobile !== undefined ? { mobile: dto.mobile ? String(dto.mobile) : null } : {}),
    });
    return this.list(tenantId).then((rows) => rows.find((r) => r.id === id));
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
