import { Global, Module } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';

/**
 * Access-control services shared by guards.
 *
 * Global because `TenantGuard` is declared with `@UseGuards(...)` inside every
 * feature module, and Nest resolves a guard's dependencies from the module it is
 * used in — a non-global provider would have to be imported into all of them.
 */
@Global()
@Module({
  providers: [TenantAccessService],
  exports: [TenantAccessService],
})
export class RbacModule {}
