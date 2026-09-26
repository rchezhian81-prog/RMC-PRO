import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { GpsService } from './gps.service';
import { GpsIngestService } from './gps-ingest.service';

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
  constructor(private readonly service: GpsService, private readonly ingest: GpsIngestService) {}

  @Get('live') @RequirePermissions('gps.view')
  live(@CurrentUser() u: AuthUser) { return this.service.live(tid(u)); }

  /** Every vehicle's last known position, on a trip or idle. */
  @Get('fleet') @RequirePermissions('gps.view')
  fleet(@CurrentUser() u: AuthUser) { return this.ingest.fleet(tid(u)); }

  // ---- the vendor feed key (Settings → GPS vendor feed) ----
  @Get('ingest-key') @RequirePermissions('integrations.manage')
  keyStatus(@CurrentUser() u: AuthUser) { return this.ingest.keyStatus(tid(u)); }

  /** Issue a new key (shown once) and retire the old one. */
  @Post('ingest-key') @RequirePermissions('integrations.manage')
  createKey(@CurrentUser() u: AuthUser, @Body() dto: { label?: string }) {
    const label = String(dto?.label ?? '').trim().slice(0, 80) || null;
    return this.ingest.createKey(tid(u), label, u.userId);
  }

  @Delete('ingest-key') @RequirePermissions('integrations.manage')
  revokeKey(@CurrentUser() u: AuthUser) { return this.ingest.revokeKey(tid(u), u.userId); }

  @Get('dispatches/:dispatchId/track') @RequirePermissions('gps.view')
  track(@CurrentUser() u: AuthUser, @Param('dispatchId') dispatchId: string) { return this.service.track(tid(u), dispatchId); }

  @Post('dispatches/:dispatchId/ping') @RequirePermissions('gps.record')
  ping(@CurrentUser() u: AuthUser, @Param('dispatchId') dispatchId: string, @Body() dto: Record<string, unknown>) {
    return this.service.recordPing(tid(u), dispatchId, dto);
  }
}
