import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModuleGuard, RequireModule } from '../rbac/module.guard';

/**
 * Temporary module-enforcement demo (Sprint 2). Gated by the 'orders' module so
 * MODULE_NOT_ENABLED can be exercised without building any business module.
 * Remove when the real Orders module lands (Sprint 5).
 */
@Controller('demo')
@UseGuards(JwtAuthGuard, ModuleGuard)
export class FeatureDemoController {
  @Get('orders-feature')
  @RequireModule('orders')
  ordersFeature() {
    return { ok: true, module: 'orders', note: 'enforcement demo' };
  }
}
