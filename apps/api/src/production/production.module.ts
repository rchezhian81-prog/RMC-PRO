import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import {
  BatchQueueController,
  BatchTicketsController,
  MixDesignsController,
  ProductionPlansController,
  ProductionReportsController,
  StockController,
} from './production.controllers';
import { MixDesignsService } from './mix-designs.service';
import { ProductionPlansService } from './production-plans.service';
import { BatchQueueService } from './batch-queue.service';
import { BatchTicketsService } from './batch-tickets.service';
import { StockService } from './stock.service';
import { ProductionReportsService } from './production-reports.service';

/**
 * Sprint 6 — Production & batching (DEV-PLAN B9). Mix designs, production plans,
 * batch queue, manual batch tickets (variance vs tolerance), inventory reduction
 * from batch consumption, and basic production reports. Dispatch, delivery
 * challan, QC, weighbridge and offline sync are later sprints.
 */
@Module({
  controllers: [
    MixDesignsController,
    ProductionPlansController,
    BatchQueueController,
    BatchTicketsController,
    StockController,
    ProductionReportsController,
  ],
  providers: [
    MixDesignsService,
    ProductionPlansService,
    BatchQueueService,
    BatchTicketsService,
    StockService,
    ProductionReportsService,
    NumberingService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class ProductionModule {}
