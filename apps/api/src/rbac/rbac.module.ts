import { Global, Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { TenantAccessService } from './tenant-access.service';
import { UserAccessService } from './user-access.service';

/**
 * Access-control services shared by guards.
 *
 * Global because `TenantGuard` is declared with `@UseGuards(...)` inside every
 * feature module, and Nest resolves a guard's dependencies from the module it is
 * used in — a non-global provider would have to be imported into all of them.
 * `UserAccessService` is here for the same reason: the permission guards, which
 * are wired per feature module, depend on it.
 */
@Global()
@Module({
  providers: [TenantAccessService, PlanLimitsService, UserAccessService],
  exports: [TenantAccessService, PlanLimitsService, UserAccessService],
})
export class RbacModule {}
