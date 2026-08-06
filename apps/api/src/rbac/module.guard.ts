import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth-user';
import { MODULE_KEY, moduleBlockedMessage } from './module.decorator';
import { TenantAccessService } from './tenant-access.service';

export { MODULE_KEY, RequireModule, moduleBlockedMessage } from './module.decorator';

/**
 * Standalone module check for controllers that do not go through `TenantGuard`.
 * The rule itself lives in `TenantAccessService`, so both entry points agree —
 * including on the unprovisioned-tenant safety net documented there.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: TenantAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(MODULE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    if (user.userType === 'super_admin') return true;
    if (!user.tenantId) throw new ForbiddenException({ code: 'MODULE_NOT_ENABLED' });

    await this.access.assertUsable(user.tenantId);
    if (!(await this.access.isModuleEnabled(user.tenantId, required))) {
      throw new ForbiddenException({ code: 'MODULE_NOT_ENABLED', message: moduleBlockedMessage(required) });
    }
    return true;
  }
}
