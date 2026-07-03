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
  SubscriptionPlan,
  PlanModule,
  ModuleEntity,
  TenantModule,
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
  SubscriptionPlan,
  PlanModule,
  ModuleEntity,
  TenantModule,
];
