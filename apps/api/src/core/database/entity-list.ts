import {
  Tenant,
  Company,
  Plant,
  User,
  Permission,
  Role,
  RolePermission,
  UserRole,
  UserPlantAccess,
} from './entities';

/** Explicit entity list (avoids ts/js glob resolution differences). */
export const ENTITIES = [
  Tenant,
  Company,
  Plant,
  User,
  Permission,
  Role,
  RolePermission,
  UserRole,
  UserPlantAccess,
];
