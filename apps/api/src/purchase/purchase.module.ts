import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from '../production/stock.service';
import {
  PurchaseOrderController,
  GoodsReceiptController,
  VendorBillController,
  VendorPaymentController,
  PurchaseReportsController,
} from './purchase.controllers';
import { PurchaseOrderService } from './purchase-order.service';
import { GrnService } from './goods-receipt.service';
import { VendorBillService } from './vendor-bill.service';
import { VendorPaymentService } from './vendor-payment.service';
import { PurchaseReportsService } from './purchase-reports.service';

/**
 * Purchase / AP-lite (Plan D2). Procurement chain — purchase order → goods
 * receipt (multi-line GRN, posts to the shared stock ledger) → vendor bill
 * (3-way matched) → vendor payment. Reuses the `suppliers` master; gated behind
 * the `purchase` subscription module. `AuditService` is injected from the global
 * AuditModule; `StockService` (the ledger) is provided here so the GRN can post.
 */
@Module({
  controllers: [PurchaseOrderController, GoodsReceiptController, VendorBillController, VendorPaymentController, PurchaseReportsController],
  providers: [
    PurchaseOrderService,
    GrnService,
    VendorBillService,
    VendorPaymentService,
    PurchaseReportsService,
    NumberingService,
    StockService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class PurchaseModule {}
