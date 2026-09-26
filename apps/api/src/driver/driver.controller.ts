import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { DriverService } from './driver.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * The driver's phone screen (the `driver_app` subscription module). Everything
 * is "mine": the trips assigned to the driver record this login is linked to.
 * One permission (driver.trips) — a phone in a cab needs nothing else.
 */
@Controller('driver')
@RequireModule('driver_app')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('driver.trips')
export class DriverController {
  constructor(private readonly service: DriverService) {}

  @Get('me')
  me(@CurrentUser() u: AuthUser) { return this.service.me(tid(u), u.userId); }

  @Get('trips')
  trips(@CurrentUser() u: AuthUser) { return this.service.trips(tid(u), u.userId); }

  @Post('trips/:id/status')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.setStatus(tid(u), u.userId, id, dto ?? {});
  }

  @Post('trips/:id/location')
  location(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.location(tid(u), u.userId, id, dto ?? {});
  }
}
