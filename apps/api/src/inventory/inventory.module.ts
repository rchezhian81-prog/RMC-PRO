import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { PdfService } from '../sales/pdf.service';
import { StockService } from '../production/stock.service';
import {
  InventoryReportsController,
  MaterialInwardController,
  NegativeStockController,
  StockAdjustmentController,
  WeighbridgeController,
} from './inventory.controllers';
import { MaterialInwardService } from './material-inward.service';
import { WeighbridgeService } from './weighbridge.service';
import { StockAdjustmentService, NegativeStockService } from './stock-adjustment.service';
import { InventoryReportsService } from './inventory-reports.service';

/**
 * Sprint 8 — Inventory & weighbridge (DEV-PLAN B11). Material inward, stock
 * adjustment with negative-stock approval, weighbridge entries + slip +
 * convert-to-inward, and low/negative visibility + basic reports. Reuses the
 * Sprint-6 StockService ledger. Billing, QC, GPS, offline sync and weighbridge
 * hardware integration are out of scope.
 */
@Module({
  controllers: [
    MaterialInwardController,
    WeighbridgeController,
    StockAdjustmentController,
    NegativeStockController,
    InventoryReportsController,
  ],
  providers: [
    MaterialInwardService,
    WeighbridgeService,
    StockAdjustmentService,
    NegativeStockService,
    InventoryReportsService,
    StockService,
    NumberingService,
    PdfService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class InventoryModule {}
