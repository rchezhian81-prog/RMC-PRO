import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { MaterialInwardService } from './material-inward.service';
import { WeighbridgeService } from './weighbridge.service';
import { StockAdjustmentService, NegativeStockService } from './stock-adjustment.service';
import { InventoryReportsService } from './inventory-reports.service';
import { PdfService } from '../sales/pdf.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('material-inwards')
@RequireModule('inventory')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class MaterialInwardController {
  constructor(private readonly service: MaterialInwardService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('stock.adjust')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/post') @RequirePermissions('stock.adjust')
  post(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.post(tid(u), id, u.userId); }

  @Post(':id/cancel') @RequirePermissions('stock.adjust')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id); }
}

@Controller('weighbridge')
@RequireModule('weighbridge')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class WeighbridgeController {
  constructor(
    private readonly service: WeighbridgeService,
    private readonly pdf: PdfService,
  ) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('stock.adjust')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto, u.userId); }

  @Post(':id/status') @RequirePermissions('stock.adjust')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.setStatus(tid(u), id, String(dto.status)); }

  @Post(':id/to-inward') @RequirePermissions('stock.adjust')
  toInward(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.toInward(tid(u), id, dto, u.userId); }

  @Get(':id/slip')
  async slip(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { data } = await this.service.pdfData(tid(u), id);
    const buffer = await this.pdf.weighbridgePdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.slipNo}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}

@Controller('stock-adjustments')
@RequireModule('inventory')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class StockAdjustmentController {
  constructor(private readonly service: StockAdjustmentService) {}

  @Post() @RequirePermissions('stock.adjust')
  adjust(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.adjust(tid(u), dto, u.userId); }
}

@Controller('negative-stock-requests')
@RequireModule('inventory')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class NegativeStockController {
  constructor(private readonly service: NegativeStockService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }

  @Post(':id/approve') @RequirePermissions('negative_stock.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.approve(tid(u), id, u.userId, dto.remarks as string); }

  @Post(':id/reject') @RequirePermissions('negative_stock.approve')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.reject(tid(u), id, u.userId, dto.remarks as string); }
}

@Controller('inventory-reports')
@RequireModule('inventory')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class InventoryReportsController {
  constructor(private readonly service: InventoryReportsService) {}

  @Get('low-stock') low(@CurrentUser() u: AuthUser) { return this.service.lowStock(tid(u)); }
  @Get('negative-stock') negative(@CurrentUser() u: AuthUser) { return this.service.negativeStock(tid(u)); }
  @Get('valuation') valuation(@CurrentUser() u: AuthUser) { return this.service.valuation(tid(u)); }
  @Get('movement') movement(@CurrentUser() u: AuthUser) { return this.service.movement(tid(u)); }
}
