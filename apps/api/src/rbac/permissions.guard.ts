import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PERMISSIONS_ANY_KEY } from './permissions.decorator';
import { isTenantOwner } from './access';
import { UserAccessService } from './user-access.service';
import type { AuthUser } from '../auth/auth-user';

/**
 * Enforces route permission requirements (Design Doc 11 §5.2). Permissions are
 * loaded within the caller's tenant context (RLS applies). Super admins bypass.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userAccess: UserAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    // A method-level permission of EITHER kind fully specifies the route and
    // overrides the class-level defaults — so a write route that names its own
    // permission is not additionally constrained by a class-level any-of gate.
    // With neither key on the handler this reads exactly what getAllAndOverride
    // did for the (sole) PERMISSIONS_KEY, so existing routes are unchanged.
    let required = this.reflector.get<string[]>(PERMISSIONS_KEY, handler) ?? [];
    let requiredAny = this.reflector.get<string[]>(PERMISSIONS_ANY_KEY, handler) ?? [];
    if (required.length === 0 && requiredAny.length === 0) {
      required = this.reflector.get<string[]>(PERMISSIONS_KEY, cls) ?? [];
      requiredAny = this.reflector.get<string[]>(PERMISSIONS_ANY_KEY, cls) ?? [];
    }
    if (required.length === 0 && requiredAny.length === 0) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    if (user.userType === 'super_admin') return true;
    if (!user.tenantId) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });

    const access = await this.userAccess.get(user.tenantId, user.userId);
    if (isTenantOwner(access)) return true;

    const hasAll = required.every((r) => access.permissions.includes(r));
    const hasAny = requiredAny.length === 0 || requiredAny.some((r) => access.permissions.includes(r));
    if (!hasAll || !hasAny) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Missing required permission',
      });
    }
    return true;
  }
}
