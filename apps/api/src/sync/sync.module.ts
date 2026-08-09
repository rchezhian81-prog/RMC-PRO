import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { SyncController, DashboardController, ReportsCatalogController } from './sync.controllers';
import { SyncService } from './sync.service';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';

/**
 * Sprint 10 — Offline sync (B14) + dashboards/reports center (B15-B16).
 * Device registration, bootstrap, number reservations, push/pull, conflict
 * resolution, cross-module KPIs and the reports catalog.
 */
@Module({
  controllers: [SyncController, DashboardController, ReportsCatalogController],
  providers: [SyncService, DashboardService, ReportsService, TenantGuard, PermissionsGuard],
})
export class SyncModule {}
