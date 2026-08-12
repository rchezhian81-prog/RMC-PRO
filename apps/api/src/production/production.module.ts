import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import {
  BatchQueueController,
  BatchTicketsController,
  BatchingIntegrationController,
  MixDesignsController,
  ProductionPlansController,
  ProductionReportsController,
  StockController,
} from './production.controllers';
import { MixDesignsService } from './mix-designs.service';
import { ProductionPlansService } from './production-plans.service';
import { BatchQueueService } from './batch-queue.service';
import { BatchTicketsService } from './batch-tickets.service';
import { BatchingIngestService } from './batching-ingest.service';
import { StockService } from './stock.service';
import { ProductionReportsService } from './production-reports.service';

/**
 * Sprint 6 — Production & batching (DEV-PLAN B9). Mix designs, production plans,
 * batch queue, manual batch tickets (variance vs tolerance), inventory reduction
 * from batch consumption, and basic production reports. Plan A4 adds the
 * batching-controller integration — ingesting actual batched weights into a
 * ticket and reconciling them — alongside the manual actuals path.
 */
@Module({
  controllers: [
    MixDesignsController,
    ProductionPlansController,
    BatchQueueController,
    BatchTicketsController,
    BatchingIntegrationController,
    StockController,
    ProductionReportsController,
  ],
  providers: [
    MixDesignsService,
    ProductionPlansService,
    BatchQueueService,
    BatchTicketsService,
    BatchingIngestService,
    StockService,
    ProductionReportsService,
    NumberingService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class ProductionModule {}
