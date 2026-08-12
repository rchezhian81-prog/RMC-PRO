import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { PurchaseOrderService } from './purchase-order.service';
import { GrnService } from './goods-receipt.service';
import { VendorBillService } from './vendor-bill.service';
import { VendorPaymentService } from './vendor-payment.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('purchase-orders')
@RequireModule('purchase')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get() @RequirePermissions('purchase.view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }

  @Get(':id') @RequirePermissions('purchase.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('purchase_orders.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/issue') @RequirePermissions('purchase_orders.create')
  issue(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.issue(tid(u), id); }

  @Post(':id/cancel') @RequirePermissions('purchase_orders.create')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id); }
}

@Controller('goods-receipts')
@RequireModule('purchase')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class GoodsReceiptController {
  constructor(private readonly service: GrnService) {}

  @Get() @RequirePermissions('purchase.view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }

  @Get(':id') @RequirePermissions('purchase.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('grn.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/post') @RequirePermissions('grn.create')
  post(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.post(tid(u), id, u.userId); }
}

@Controller('vendor-bills')
@RequireModule('purchase')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class VendorBillController {
  constructor(private readonly service: VendorBillService) {}

  @Get() @RequirePermissions('purchase.view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }

  @Get(':id') @RequirePermissions('purchase.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('vendor_bills.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/approve') @RequirePermissions('vendor_bills.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.approve(tid(u), id, u.userId); }

  @Post(':id/cancel') @RequirePermissions('vendor_bills.approve')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id); }
}

@Controller('vendor-payments')
@RequireModule('purchase')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class VendorPaymentController {
  constructor(private readonly service: VendorPaymentService) {}

  @Get() @RequirePermissions('purchase.view')
  list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }

  @Get(':id') @RequirePermissions('purchase.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('vendor_payments.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto, u.userId); }
}
