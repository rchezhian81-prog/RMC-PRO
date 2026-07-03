import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';

/** Restricts a route to platform super admins (Design Doc 9 §9). */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.userType !== 'super_admin') {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Super admin only' });
    }
    return true;
  }
}
