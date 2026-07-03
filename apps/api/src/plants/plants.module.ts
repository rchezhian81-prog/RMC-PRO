import { Module } from '@nestjs/common';
import { PlantsController } from './plants.controller';
import { PlantsService } from './plants.service';
import { TenantGuard } from '../rbac/tenant.guard';

@Module({
  controllers: [PlantsController],
  providers: [PlantsService, TenantGuard],
})
export class PlantsModule {}
