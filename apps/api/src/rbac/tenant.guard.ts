import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth-user';
import { MODULE_KEY, moduleBlockedMessage } from './module.decorator';
import { TenantAccessService } from './tenant-access.service';

/**
 * The gate every tenant request passes through. It settles three questions, in
 * the order they stop being worth asking:
 *
 *   1. Is this a tenant user at all?
 *   2. May the company still trade — or has the platform suspended it?
 *   3. Does the company's subscription include the module this route belongs to?
 *
 * Steps 2 and 3 share one cached lookup (see `TenantAccessService`), so adding
 * them costs no extra round-trip on a warm cache.
 *
 * Checking subscription status here, rather than only at sign-in, is what makes
 * a suspension actually take hold: a token issued before the suspension would
 * otherwise keep working for its full lifetime.
 *
 * Step 3 runs only on routes carrying `@RequireModule(...)`. It lives in this
 * guard because every tenant controller already declares `TenantGuard`, so the
 * check applies wherever the decorator is added without each controller having
 * to remember a second guard. `ModuleGuard` remains available for controllers
 * that are not tenant-scoped.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: TenantAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !user.tenantId) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Tenant user required' });
    }

    await this.access.assertUsable(user.tenantId);

    const required = this.reflector.getAllAndOverride<string | undefined>(MODULE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && !(await this.access.isModuleEnabled(user.tenantId, required))) {
      throw new ForbiddenException({ code: 'MODULE_NOT_ENABLED', message: moduleBlockedMessage(required) });
    }
    return true;
  }
}
