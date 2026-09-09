import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { isYmdDate } from '@rmc/shared';
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
import { PurchaseReportsService } from './purchase-reports.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * Validate and normalise a report's date bounds — the purchase twin of the
 * guard on the billing reports. `from` / `to` went straight from the query
 * string into `$1::date`, so `?from=garbage` reached Postgres as an invalid
 * cast and surfaced as a 500 rather than a 400 naming the bad value; an empty
 * `?from=` did the same.
 */
function dateRange(from?: string, to?: string): [string | undefined, string | undefined] {
  const clean = (label: string, v?: string): string | undefined => {
    const t = (v ?? '').trim();
    if (!t) return undefined;
    if (!isYmdDate(t)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `${label} must be a date in YYYY-MM-DD form (received "${t.slice(0, 40)}").`,
      });
    }
    return t;
  };
  const f = clean('from', from);
  const t = clean('to', to);
  if (f && t && f > t) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `from (${f}) is after to (${t}).` });
  }
  return [f, t];
}

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

  @Post(':id/cancel') @RequirePermissions('grn.create')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id, u.userId); }

  // Taking booked stock back out and rewinding the PO is an approver action —
  // the same tier that approves the vendor bill built on this receipt.
  @Post(':id/reverse') @RequirePermissions('vendor_bills.approve')
  reverse(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.reverse(tid(u), id, u.userId, dto.reason as string); }
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
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown> = {}) { return this.service.approve(tid(u), id, u.userId, dto?.overrideMatch === true); }

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

  @Post(':id/reverse') @RequirePermissions('vendor_payments.create')
  reverse(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.reverse(tid(u), id, u.userId, dto.reason as string | undefined);
  }

  @Post(':id/apply-advance') @RequirePermissions('vendor_payments.create')
  applyAdvance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.applyAdvance(tid(u), id, dto.allocations, u.userId);
  }
}

@Controller('purchase-reports')
@RequireModule('purchase')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PurchaseReportsController {
  constructor(
    private readonly bills: VendorBillService,
    private readonly reports: PurchaseReportsService,
  ) {}

  @Get('itc-register') @RequirePermissions('purchase.view')
  itc(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.bills.itcRegister(tid(u), ...dateRange(from, to));
  }

  @Get('payables-aging') @RequirePermissions('purchase.view')
  payablesAging(@CurrentUser() u: AuthUser) {
    return this.reports.payablesAging(tid(u));
  }

  @Get('vendor-ledger') @RequirePermissions('purchase.view')
  vendorLedger(
    @CurrentUser() u: AuthUser,
    @Query('supplierId') supplierId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.vendorLedger(tid(u), supplierId ?? '', ...dateRange(from, to));
  }

  @Get('purchase-register') @RequirePermissions('purchase.view')
  purchaseRegister(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.purchaseRegister(tid(u), ...dateRange(from, to));
  }
}
