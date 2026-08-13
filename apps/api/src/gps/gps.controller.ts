import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { GpsService } from './gps.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * GPS tracking (the `gps` subscription module). Record a location fix for a
 * dispatch, read the live board of in-transit loads, and replay a dispatch's
 * track. Recording is a separate permission from viewing.
 */
@Controller('gps')
@RequireModule('gps')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class GpsController {
  constructor(private readonly service: GpsService) {}

  @Get('live') @RequirePermissions('gps.view')
  live(@CurrentUser() u: AuthUser) { return this.service.live(tid(u)); }

  @Get('dispatches/:dispatchId/track') @RequirePermissions('gps.view')
  track(@CurrentUser() u: AuthUser, @Param('dispatchId') dispatchId: string) { return this.service.track(tid(u), dispatchId); }

  @Post('dispatches/:dispatchId/ping') @RequirePermissions('gps.record')
  ping(@CurrentUser() u: AuthUser, @Param('dispatchId') dispatchId: string, @Body() dto: Record<string, unknown>) {
    return this.service.recordPing(tid(u), dispatchId, dto);
  }
}
