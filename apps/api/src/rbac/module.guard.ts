import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantDbService } from '../core/database/tenant-db.service';
import { TenantModule } from '../core/database/entities';
import type { AuthUser } from '../auth/auth-user';

export const MODULE_KEY = 'required_module';

/** Require a subscription module to be enabled for the tenant (Design Doc 9 §8.3). */
export const RequireModule = (moduleKey: string) => SetMetadata(MODULE_KEY, moduleKey);

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDbService,
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

    // tenant_modules is platform-managed (no RLS) — scope by the JWT tenant_id.
    const row = await this.db.ds.getRepository(TenantModule).findOne({
      where: { tenantId: user.tenantId, moduleKey: required, isEnabled: true },
    });
    if (!row) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: `Module '${required}' is not enabled for this tenant`,
      });
    }
    return true;
  }
}
