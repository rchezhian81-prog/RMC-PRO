import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { MixDesignsService } from './mix-designs.service';
import { ProductionPlansService } from './production-plans.service';
import { BatchQueueService } from './batch-queue.service';
import { BatchTicketsService } from './batch-tickets.service';
import { StockService } from './stock.service';
import { ProductionReportsService } from './production-reports.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('mix-designs')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class MixDesignsController {
  constructor(private readonly service: MixDesignsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }
  @Post(':id/materials') addMaterial(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.addMaterial(tid(u), id, dto); }
  @Delete(':id/materials/:rowId') deleteMaterial(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('rowId') rowId: string) { return this.service.deleteMaterial(tid(u), id, rowId); }

  @Post(':id/approve')
  @RequirePermissions('mix_design.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.approve(tid(u), id, u.userId); }

  @Post(':id/reject')
  @RequirePermissions('mix_design.approve')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.reject(tid(u), id, u.userId); }
}

@Controller('production-plans')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ProductionPlansController {
  constructor(private readonly service: ProductionPlansService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto, u.userId); }
  @Post(':id/items') addItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.addItem(tid(u), id, dto); }
  @Delete(':id/items/:itemId') deleteItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) { return this.service.deleteItem(tid(u), id, itemId); }
  @Post(':id/status') setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.setStatus(tid(u), id, String(dto.status)); }
  @Post(':id/enqueue') enqueue(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.enqueue(tid(u), id); }
}

@Controller('batch-queue')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BatchQueueController {
  constructor(private readonly service: BatchQueueService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post('from-order/:orderId')
  @RequirePermissions('batch_tickets.create')
  enqueueFromOrder(@CurrentUser() u: AuthUser, @Param('orderId') orderId: string) { return this.service.enqueueFromOrder(tid(u), orderId); }

  @Post(':id/status')
  @RequirePermissions('batch_tickets.create')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.setStatus(tid(u), id, String(dto.status)); }
}

@Controller('batch-tickets')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BatchTicketsController {
  constructor(private readonly service: BatchTicketsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post('from-queue/:queueId')
  @RequirePermissions('batch_tickets.create')
  create(@CurrentUser() u: AuthUser, @Param('queueId') queueId: string, @Body() dto: Record<string, unknown>) { return this.service.createFromQueue(tid(u), queueId, dto, u.userId); }

  @Post(':id/actuals')
  @RequirePermissions('batch_tickets.create')
  actuals(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.updateActuals(tid(u), id, dto); }

  @Post(':id/confirm')
  @RequirePermissions('batch_tickets.create')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.confirm(tid(u), id, dto, u.userId); }

  @Post(':id/cancel')
  @RequirePermissions('batch_tickets.create')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id); }
}

@Controller('stock')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly service: StockService) {}

  @Get('balances') balances(@CurrentUser() u: AuthUser) { return this.service.listBalances(tid(u)); }
  @Get('ledger') ledger(@CurrentUser() u: AuthUser, @Query('materialId') materialId?: string) { return this.service.ledger(tid(u), materialId); }

  @Post('opening')
  @RequirePermissions('stock.adjust')
  setOpening(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.setOpening(tid(u), dto, u.userId); }
}

@Controller('production-reports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ProductionReportsController {
  constructor(private readonly service: ProductionReportsService) {}

  @Get('summary') summary(@CurrentUser() u: AuthUser) { return this.service.productionSummary(tid(u)); }
  @Get('variance') variance(@CurrentUser() u: AuthUser) { return this.service.varianceReport(tid(u)); }
  @Get('material-consumption') consumption(@CurrentUser() u: AuthUser) { return this.service.materialConsumption(tid(u)); }
}
