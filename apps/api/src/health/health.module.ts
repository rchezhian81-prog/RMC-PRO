import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { OpsController } from './ops.controller';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';

@Module({
  controllers: [HealthController, OpsController],
  providers: [TenantGuard, PermissionsGuard],
})
export class HealthModule {}
