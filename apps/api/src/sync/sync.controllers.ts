import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { SyncService } from './sync.service';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('sync')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('devices/register') @RequirePermissions('sync.manage')
  register(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.registerDevice(tid(u), dto, u.userId); }

  @Get('devices') devices(@CurrentUser() u: AuthUser) { return this.service.listDevices(tid(u)); }

  @Get('bootstrap') bootstrap(@CurrentUser() u: AuthUser, @Query('deviceId') deviceId: string) { return this.service.bootstrap(tid(u), deviceId); }

  @Post('number-reservations') @RequirePermissions('sync.manage')
  reserve(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.reserveNumbers(tid(u), dto); }

  @Get('number-reservations') reservations(@CurrentUser() u: AuthUser, @Query('deviceId') deviceId?: string) { return this.service.listReservations(tid(u), deviceId); }

  @Post('push') @RequirePermissions('sync.manage')
  push(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.push(tid(u), String(dto.deviceId ?? ''), (dto.records as never[]) ?? []);
  }

  @Get('pull') pull(@CurrentUser() u: AuthUser, @Query('deviceId') deviceId: string, @Query('since') since?: string) { return this.service.pull(tid(u), deviceId, since); }

  @Get('conflicts') conflicts(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.listConflicts(tid(u), status); }

  @Post('conflicts/:id/resolve') @RequirePermissions('sync.manage')
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.resolveConflict(tid(u), id, String(dto.resolution ?? ''), u.userId);
  }
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.service.summary(tid(u)); }
  @Get('operations-funnel') funnel(@CurrentUser() u: AuthUser) { return this.service.operationsFunnel(tid(u)); }
}

@Controller('reports')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ReportsCatalogController {
  constructor(private readonly service: ReportsService) {}

  @Get('catalog') catalog() { return this.service.catalog(); }
}
