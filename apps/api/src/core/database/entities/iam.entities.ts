import { Column, Entity, Unique } from 'typeorm';
import type { UserType } from '@rmc/shared';
import { BaseUuidEntity, TenantScopedEntity } from './base.entity';

/** User account (Design Doc 6 §6.1). tenant_id is null for platform super admins. */
@Entity('users')
export class User extends BaseUuidEntity {
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'name', type: 'varchar' })
  name!: string;

  @Column({ name: 'email', type: 'varchar', unique: true })
  email!: string;

  @Column({ name: 'mobile', type: 'varchar', nullable: true })
  mobile!: string | null;

  @Column({ name: 'password_hash', type: 'varchar' })
  passwordHash!: string;

  @Column({ name: 'user_type', type: 'varchar', default: 'tenant_user' })
  userType!: UserType;

  @Column({ name: 'status', type: 'varchar', default: 'active' })
  status!: string;

  @Column({ name: 'is_2fa_enabled', type: 'boolean', default: false })
  is2faEnabled!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;
}

/** Global permission catalog (Design Doc 6 §6.3). No tenant_id. */
@Entity('permissions')
export class Permission extends BaseUuidEntity {
  @Column({ name: 'permission_key', type: 'varchar', unique: true })
  permissionKey!: string;

  @Column({ name: 'module_key', type: 'varchar' })
  moduleKey!: string;

  @Column({ name: 'description', type: 'varchar', nullable: true })
  description!: string | null;
}

/** Tenant-scoped role (Design Doc 6 §6.2). */
@Entity('roles')
@Unique('uq_roles_tenant_key', ['tenantId', 'roleKey'])
export class Role extends TenantScopedEntity {
  @Column({ name: 'role_key', type: 'varchar' })
  roleKey!: string;

  @Column({ name: 'role_name', type: 'varchar' })
  roleName!: string;

  @Column({ name: 'is_system_role', type: 'boolean', default: false })
  isSystemRole!: boolean;
}

/** Role → permission mapping (Design Doc 6 §6.4). */
@Entity('role_permissions')
@Unique('uq_role_permissions', ['tenantId', 'roleId', 'permissionId'])
export class RolePermission extends TenantScopedEntity {
  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId!: string;
}

/** User → role mapping (Design Doc 6 §6.5). */
@Entity('user_roles')
@Unique('uq_user_roles', ['tenantId', 'userId', 'roleId'])
export class UserRole extends TenantScopedEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;
}

/** Plant-wise user access (Design Doc 6 §6.6). */
@Entity('user_plant_access')
@Unique('uq_user_plant_access', ['tenantId', 'userId', 'plantId'])
export class UserPlantAccess extends TenantScopedEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'plant_id', type: 'uuid' })
  plantId!: string;

  @Column({ name: 'access_level', type: 'varchar', default: 'operate' })
  accessLevel!: string;
}
