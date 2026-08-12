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
  WeighbridgeIndicatorController,
} from './inventory.controllers';
import { MaterialInwardService } from './material-inward.service';
import { WeighbridgeService } from './weighbridge.service';
import { WeighbridgeIndicatorService } from './weighbridge-indicator.service';
import { StockAdjustmentService, NegativeStockService } from './stock-adjustment.service';
import { InventoryReportsService } from './inventory-reports.service';

/**
 * Sprint 8 — Inventory & weighbridge (DEV-PLAN B11). Material inward, stock
 * adjustment with negative-stock approval, weighbridge entries + slip +
 * convert-to-inward, and low/negative visibility + basic reports. Reuses the
 * Sprint-6 StockService ledger. Plan E1 adds the weighbridge hardware bridge —
 * indicator devices + a live "Get weight" read alongside the manual path.
 */
@Module({
  controllers: [
    MaterialInwardController,
    WeighbridgeController,
    WeighbridgeIndicatorController,
    StockAdjustmentController,
    NegativeStockController,
    InventoryReportsController,
  ],
  providers: [
    MaterialInwardService,
    WeighbridgeService,
    WeighbridgeIndicatorService,
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
