import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';

/**
 * GPS tracking (activates the `gps` module). Location pings for in-transit
 * dispatches over the existing dispatch/vehicle masters; gated behind the `gps`
 * subscription module and permission-gated (`gps.view` / `gps.record`).
 */
@Module({
  controllers: [GpsController],
  providers: [GpsService, TenantGuard, PermissionsGuard],
})
export class GpsModule {}
