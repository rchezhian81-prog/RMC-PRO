import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { InvoiceService } from './invoice.service';
import { ReceiptService } from './receipt.service';
import { BillingReportsService } from './billing-reports.service';
import { PdfService } from '../sales/pdf.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('invoices')
@RequireModule('billing')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class InvoiceController {
  constructor(
    private readonly service: InvoiceService,
    private readonly pdf: PdfService,
  ) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get('billable-challans') billable(@CurrentUser() u: AuthUser, @Query('customerId') customerId?: string) { return this.service.billableChallans(tid(u), customerId); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post('from-challans') @RequirePermissions('invoices.create')
  fromChallans(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.fromChallans(tid(u), dto); }

  @Post(':id/issue') @RequirePermissions('invoices.create')
  issue(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.issue(tid(u), id); }

  @Post(':id/cancel') @RequirePermissions('invoice_cancellation.approve')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.cancel(tid(u), id, u.userId, dto.reason as string); }

  @Post(':id/share') @RequirePermissions('whatsapp.send')
  share(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.share(tid(u), id, dto); }

  @Get(':id/pdf')
  async pdfDoc(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { data } = await this.service.pdfData(tid(u), id);
    const buffer = await this.pdf.invoicePdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.invoiceNo}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}

@Controller('receipts')
@RequireModule('billing')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ReceiptController {
  constructor(private readonly service: ReceiptService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('receipts.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/share') @RequirePermissions('whatsapp.send')
  share(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.share(tid(u), id, dto); }
}

@Controller('billing-reports')
@RequireModule('billing')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BillingReportsController {
  constructor(private readonly service: BillingReportsService) {}

  @Get('outstanding') outstanding(@CurrentUser() u: AuthUser) { return this.service.outstanding(tid(u)); }
  @Get('sales-register') sales(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.salesRegister(tid(u), from, to); }
  @Get('gst-summary') gst(@CurrentUser() u: AuthUser) { return this.service.gstSummary(tid(u)); }
  @Get('receipts-register') receipts(@CurrentUser() u: AuthUser) { return this.service.receiptsRegister(tid(u)); }

  @Get('tally-export') @RequirePermissions('tally_export.generate')
  async tally(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const { csv } = await this.service.tallyExportCsv(tid(u), from, to);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tally-sales-export.csv"');
    res.end(csv);
  }
}
