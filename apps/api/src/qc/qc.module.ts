import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';

/**
 * QC / Lab (Plan A3) — slump tests and cube-strength sets with IS 456
 * acceptance. Module-gated on `qc`; reads need `qc.view`, writes `qc.record`.
 */
@Module({
  controllers: [QcController],
  providers: [QcService, NumberingService, TenantGuard, PermissionsGuard],
})
export class QcModule {}
