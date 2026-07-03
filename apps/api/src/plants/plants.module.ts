import { Module } from '@nestjs/common';
import { PlantsController } from './plants.controller';
import { PlantsService } from './plants.service';
import { PermissionsGuard } from '../rbac/permissions.guard';

@Module({
  controllers: [PlantsController],
  providers: [PlantsService, PermissionsGuard],
})
export class PlantsModule {}
