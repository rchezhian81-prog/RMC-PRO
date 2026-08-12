import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { CorrectionService } from './correction.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * Document corrections (Plan F2). Record and list amendments to posted documents.
 * Gated by `document_corrections.manage`; not tied to a subscription module.
 */
@Controller('document-corrections')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CorrectionController {
  constructor(private readonly service: CorrectionService) {}

  @Get() @RequirePermissions('document_corrections.manage')
  list(@CurrentUser() u: AuthUser, @Query('documentType') documentType?: string, @Query('documentId') documentId?: string) {
    return this.service.list(tid(u), { documentType, documentId });
  }

  @Post() @RequirePermissions('document_corrections.manage')
  record(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.record(tid(u), dto, u.userId);
  }
}
