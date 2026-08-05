import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantDbService } from '../core/database/tenant-db.service';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { isTenantOwner, loadUserAccess } from './access';
import type { AuthUser } from '../auth/auth-user';

/**
 * Enforces route permission requirements (Design Doc 11 §5.2). Permissions are
 * loaded within the caller's tenant context (RLS applies). Super admins bypass.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    if (user.userType === 'super_admin') return true;
    if (!user.tenantId) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });

    const access = await loadUserAccess(this.db, user.tenantId, user.userId);
    if (isTenantOwner(access)) return true;

    if (!required.every((r) => access.permissions.includes(r))) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Missing required permission',
      });
    }
    return true;
  }
}
