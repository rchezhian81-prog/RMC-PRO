import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import { PdfService } from '../sales/pdf.service';
import { DispatchController, DeliveryChallanController } from './dispatch.controllers';
import { DispatchService } from './dispatch.service';
import { DeliveryChallanService } from './delivery-challan.service';

/**
 * Sprint 7 — Dispatch & delivery challan (DEV-PLAN B10). Dispatch board status
 * flow, challan generate/print(PDF)/share, reserved numbering. Consumes
 * confirmed batch tickets. Billing, QC, weighbridge, GPS and offline sync are
 * later sprints.
 */
@Module({
  controllers: [DispatchController, DeliveryChallanController],
  providers: [
    DispatchService,
    DeliveryChallanService,
    NumberingService,
    WhatsAppService,
    PdfService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class DispatchModule {}
