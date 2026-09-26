import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { DispatchModule } from '../dispatch/dispatch.module';
import { GpsModule } from '../gps/gps.module';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

/**
 * Driver phone screen (activates the `driver_app` module): a driver's own trips,
 * their status buttons and the phone's position feed — on top of the dispatch
 * board and GPS tracking, never beside them.
 */
@Module({
  imports: [DispatchModule, GpsModule],
  controllers: [DriverController],
  providers: [DriverService, TenantGuard, PermissionsGuard],
})
export class DriverModule {}
