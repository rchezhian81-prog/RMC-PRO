import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { PumpJobController } from './pump.controllers';
import { PumpJobService } from './pump-job.service';

/** Pump management (pump register, pump jobs, utilisation + charge reconciliation). */
@Module({
  controllers: [PumpJobController],
  providers: [PumpJobService, NumberingService, TenantGuard, PermissionsGuard],
})
export class PumpModule {}
