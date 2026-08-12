import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { ServiceScheduleController, MaintenanceJobController, FuelLogController } from './fleet.controllers';
import { ServiceScheduleService } from './service-schedule.service';
import { MaintenanceJobService } from './maintenance-job.service';
import { FuelLogService } from './fuel-log.service';

/**
 * Fleet maintenance & fuel log (Plan D3). Preventive service schedules,
 * maintenance / breakdown jobs, and a diesel fuel log with computed km/litre —
 * all over D1's `vehicles` master. Gated behind the `fleet` subscription module.
 * `AuditService` is injected from the global AuditModule; `NumberingService`
 * provides maintenance-job numbers.
 */
@Module({
  controllers: [ServiceScheduleController, MaintenanceJobController, FuelLogController],
  providers: [
    ServiceScheduleService,
    MaintenanceJobService,
    FuelLogService,
    NumberingService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class FleetModule {}
