import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
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

  @Post(':id/writeoff') @RequirePermissions('invoice_cancellation.approve')
  writeOff(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.writeOff(tid(u), id, u.userId, Number(dto.amount ?? 0), dto.reason as string); }

  @Post(':id/share') @RequirePermissions('whatsapp.send')
  share(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.share(tid(u), id, dto); }

  @Patch(':id/transport') @RequirePermissions('invoices.create')
  setTransport(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.setTransport(tid(u), id, u.userId, dto); }

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

  @Post(':id/realise') @RequirePermissions('receipts.create')
  realise(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.realise(tid(u), id); }

  @Post(':id/bounce') @RequirePermissions('receipts.create')
  bounce(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.service.bounce(tid(u), id, u.userId, dto.reason as string); }

  @Post(':id/apply') @RequirePermissions('receipts.create')
  apply(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.applyAdvance(tid(u), id); }

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
  @Get('gst-summary') gst(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.gstSummary(tid(u), from, to); }
  @Get('hsn-summary') hsn(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.hsnSummary(tid(u), from, to); }
  @Get('receipts-register') receipts(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.receiptsRegister(tid(u), from, to); }
  @Get('customer-statement') statement(@CurrentUser() u: AuthUser, @Query('customerId') customerId?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.service.customerStatement(tid(u), customerId ?? '', from, to); }
  @Get('gstr-3b') gstr3b(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.gstr3b(tid(u), from, to); }
  @Get('day-book') dayBook(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.cashBankDayBook(tid(u), from, to); }
  @Get('sales-mis') salesMis(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.salesMis(tid(u), from, to); }
  @Get('grade-margin') gradeMargin(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.service.gradeMargin(tid(u), from, to); }

  @Get('tally-export') @RequirePermissions('tally_export.generate')
  async tally(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const { csv } = await this.service.tallyExportCsv(tid(u), from, to);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tally-sales-export.csv"');
    res.end(csv);
  }
}
