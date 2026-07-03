import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { PlantsService } from './plants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { CurrentUser, type AuthUser } from '../auth/auth-user';

/**
 * Demo protected resource proving end-to-end tenant isolation: a tenant user
 * only ever sees their own plants (RLS), and cross-tenant ids resolve to 404.
 */
@Controller('plants')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlantsController {
  constructor(private readonly plants: PlantsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.plants.list(user.tenantId);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const plant = await this.plants.getById(user.tenantId, id);
    if (!plant) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plant not found' });
    return plant;
  }
}
