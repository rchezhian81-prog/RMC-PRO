import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { CorrectionController } from './correction.controller';
import { CorrectionService } from './correction.service';

/**
 * Document corrections (Plan F2). A generic amendment trail for posted documents;
 * `AuditService` is injected from the global AuditModule so each correction also
 * lands in the system audit log.
 */
@Module({
  controllers: [CorrectionController],
  providers: [CorrectionService, TenantGuard, PermissionsGuard],
})
export class CorrectionModule {}
