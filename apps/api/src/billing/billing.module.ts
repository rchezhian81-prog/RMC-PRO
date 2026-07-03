import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import { PdfService } from '../sales/pdf.service';
import { InvoiceController, ReceiptController, BillingReportsController } from './billing.controllers';
import { InvoiceService } from './invoice.service';
import { ReceiptService } from './receipt.service';
import { BillingReportsService } from './billing-reports.service';

/**
 * Sprint 9 — Billing & payments (DEV-PLAN B12-B13). Invoice-from-challans with
 * GST (CGST/SGST/IGST), generic-quantity lines, e-invoice / e-way-ready fields,
 * receipts + allocation, outstanding + aging, Tally CSV export, and invoice /
 * receipt WhatsApp share. No live GSTN / e-way / Tally / gateway integration.
 */
@Module({
  controllers: [InvoiceController, ReceiptController, BillingReportsController],
  providers: [
    InvoiceService,
    ReceiptService,
    BillingReportsService,
    NumberingService,
    WhatsAppService,
    PdfService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class BillingModule {}
