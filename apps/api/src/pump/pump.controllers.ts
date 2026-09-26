import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { PumpJobService } from './pump-job.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * Pump management, part of the dispatch module: the pump register, pump jobs
 * and the utilisation / pump-charge reconciliation report. Viewing and
 * planning are separate keys (pump.view / pump.manage).
 */
@Controller('pump-jobs')
@RequireModule('dispatch')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PumpJobController {
  constructor(private readonly service: PumpJobService) {}

  @Get() @RequirePermissions('pump.view')
  list(
    @CurrentUser() u: AuthUser,
    @Query('status') status?: string, @Query('vehicleId') vehicleId?: string, @Query('orderId') orderId?: string,
    @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string,
  ) {
    return this.service.list(tid(u), { status, vehicleId, orderId, from, to, limit });
  }

  @Get('pumps') @RequirePermissions('pump.view')
  pumps(@CurrentUser() u: AuthUser) { return this.service.pumps(tid(u)); }

  @Get('report/utilisation') @RequirePermissions('pump.view')
  utilisation(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.utilisation(tid(u), from, to);
  }

  @Get(':id') @RequirePermissions('pump.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('pump.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto ?? {}, u.userId); }

  @Patch(':id') @RequirePermissions('pump.manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto ?? {});
  }

  @Post(':id/status') @RequirePermissions('pump.manage')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.setStatus(tid(u), id, dto ?? {});
  }
}
