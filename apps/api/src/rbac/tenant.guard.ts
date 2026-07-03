import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';

/** Requires an authenticated tenant user (tenant_id present). */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !user.tenantId) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Tenant user required' });
    }
    return true;
  }
}
