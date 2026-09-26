import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { GpsIngestService } from './gps-ingest.service';
import { GpsIngestController } from './gps-ingest.controller';

/**
 * GPS tracking (activates the `gps` module). Location pings for in-transit
 * dispatches over the existing dispatch/vehicle masters; gated behind the `gps`
 * subscription module and permission-gated (`gps.view` / `gps.record`).
 */
@Module({
  controllers: [GpsController, GpsIngestController],
  providers: [GpsService, GpsIngestService, TenantGuard, PermissionsGuard],
  exports: [GpsService, GpsIngestService],
})
export class GpsModule {}
