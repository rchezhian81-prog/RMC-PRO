import { Module } from '@nestjs/common';
import { PlantsController } from './plants.controller';
import { PlantsService } from './plants.service';
import { TenantGuard } from '../rbac/tenant.guard';
import { CrudPermissionsGuard } from '../rbac/crud-permissions.guard';

@Module({
  controllers: [PlantsController],
  providers: [PlantsService, TenantGuard, CrudPermissionsGuard],
})
export class PlantsModule {}
