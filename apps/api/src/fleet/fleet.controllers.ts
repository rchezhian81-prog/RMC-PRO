import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { ServiceScheduleService } from './service-schedule.service';
import { MaintenanceJobService } from './maintenance-job.service';
import { FuelLogService } from './fuel-log.service';
import { FleetReportsService } from './fleet-reports.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('vehicle-service-schedules')
@RequireModule('fleet')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ServiceScheduleController {
  constructor(private readonly service: ServiceScheduleService) {}

  @Get() @RequirePermissions('fleet.view')
  list(@CurrentUser() u: AuthUser, @Query('vehicleId') vehicleId?: string) { return this.service.list(tid(u), vehicleId); }

  @Get(':id') @RequirePermissions('fleet.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('fleet.maintenance.record')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Put(':id') @RequirePermissions('fleet.maintenance.record')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
}

@Controller('vehicle-maintenance-jobs')
@RequireModule('fleet')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class MaintenanceJobController {
  constructor(private readonly service: MaintenanceJobService) {}

  @Get() @RequirePermissions('fleet.view')
  list(@CurrentUser() u: AuthUser, @Query('vehicleId') vehicleId?: string, @Query('status') status?: string) {
    return this.service.list(tid(u), vehicleId, status);
  }

  @Get(':id') @RequirePermissions('fleet.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('fleet.maintenance.record')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/complete') @RequirePermissions('fleet.maintenance.record')
  complete(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.complete(tid(u), id, u.userId, dto ?? {});
  }

  @Post(':id/cancel') @RequirePermissions('fleet.maintenance.record')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id); }
}

@Controller('vehicle-fuel-logs')
@RequireModule('fleet')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class FuelLogController {
  constructor(private readonly service: FuelLogService) {}

  @Get() @RequirePermissions('fleet.view')
  list(@CurrentUser() u: AuthUser, @Query('vehicleId') vehicleId?: string) { return this.service.list(tid(u), vehicleId); }

  @Get('summary/:vehicleId') @RequirePermissions('fleet.view')
  summary(@CurrentUser() u: AuthUser, @Param('vehicleId') vehicleId: string) { return this.service.summary(tid(u), vehicleId); }

  @Post() @RequirePermissions('fleet.fuel.record')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }
}

@Controller('fleet-reports')
@RequireModule('fleet')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class FleetReportsController {
  constructor(private readonly service: FleetReportsService) {}

  @Get('running-cost') @RequirePermissions('fleet.view')
  runningCost(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.runningCost(tid(u), from, to);
  }
}
