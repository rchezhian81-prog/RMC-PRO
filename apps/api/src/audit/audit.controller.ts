import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { AuditService } from './audit.service';

/**
 * Read-only view of the trail. Gated by `audit_logs.view`, which the Company
 * Owner, Company Admin and Auditor roles hold — the people entitled to review
 * who did what. There is intentionally no write endpoint: entries are made by
 * the actions themselves, never by hand.
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit_logs.view')
  list(
    @CurrentUser() u: AuthUser,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.list(u.tenantId as string, {
      entityType,
      entityId,
      action,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
