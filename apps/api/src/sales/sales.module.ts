import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  LeadsController,
  NotificationsController,
  OrdersDraftController,
  QuotationsController,
  RateContractsController,
} from './sales.controllers';
import { LeadsService } from './leads.service';
import { QuotationsService } from './quotations.service';
import { RateContractsService } from './rate-contracts.service';
import { OrdersDraftService } from './orders-draft.service';
import { NumberingService } from './numbering.service';
import { PdfService } from './pdf.service';
import { WhatsAppService } from './whatsapp.service';

/**
 * Sprint 4 — Sales module: leads, quotations (items, approval, revisions, PDF,
 * WhatsApp share), rate contracts, and the order-DRAFT handoff. Scope stops at
 * the draft order; confirmed orders and downstream operations are later sprints.
 */
@Module({
  controllers: [
    LeadsController,
    QuotationsController,
    RateContractsController,
    OrdersDraftController,
    NotificationsController,
  ],
  providers: [
    LeadsService,
    QuotationsService,
    RateContractsService,
    OrdersDraftService,
    NumberingService,
    PdfService,
    WhatsAppService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class SalesModule {}
