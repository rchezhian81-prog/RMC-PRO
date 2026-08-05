import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantDbService } from '../core/database/tenant-db.service';
import { CRUD_RESOURCE_KEY } from './crud-resource.decorator';
import { isTenantOwner, loadUserAccess } from './access';
import type { AuthUser } from '../auth/auth-user';

const ACTION_BY_METHOD: Record<string, string> = {
  GET: 'view',
  POST: 'create',
  PATCH: 'edit',
  PUT: 'edit',
  DELETE: 'delete',
};

/**
 * Permission enforcement for BaseCrudController masters. The required key is
 * `<resource>.<action>` where resource comes from @CrudResource and action from
 * the HTTP method (GET=view, POST=create, PATCH=edit, DELETE=delete). super_admin
 * and the company owner bypass; every other role needs the explicit key, so a
 * role can be limited to view-only or barred from delete.
 */
@Injectable()
export class CrudPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.getAllAndOverride<string>(CRUD_RESOURCE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!resource) return true; // not a CRUD-guarded controller

    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser; method: string }>();
    const user = req.user;
    if (!user) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    if (user.userType === 'super_admin') return true;
    if (!user.tenantId) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });

    const action = ACTION_BY_METHOD[req.method] ?? 'edit';
    const required = `${resource}.${action}`;

    const access = await loadUserAccess(this.db, user.tenantId, user.userId);
    if (isTenantOwner(access)) return true;
    if (!access.permissions.includes(required)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `Missing required permission: ${required}`,
      });
    }
    return true;
  }
}
