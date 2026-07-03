import { Controller, UseGuards } from '@nestjs/common';
import { BaseCrudController } from '../common/base-crud.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { Plant } from '../core/database/entities';
import { PlantsService } from './plants.service';

/**
 * Plant setup master. Also the earliest proof of tenant isolation (Sprint 1):
 * every read/write runs in the caller's RLS context, so a tenant only ever
 * sees its own plants and cross-tenant ids resolve to 404.
 */
@Controller('plants')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PlantsController extends BaseCrudController<Plant> {
  constructor(protected readonly service: PlantsService) {
    super();
  }
}
