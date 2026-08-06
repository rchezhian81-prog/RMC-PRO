import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { LeadsService } from './leads.service';
import { QuotationsService } from './quotations.service';
import { RateContractsService } from './rate-contracts.service';
import { OrdersDraftService } from './orders-draft.service';
import { PdfService } from './pdf.service';
import { WhatsAppService } from './whatsapp.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('leads')
@RequireModule('sales')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get() @RequirePermissions('leads.view')
  list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') @RequirePermissions('leads.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post() @RequirePermissions('leads.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(tid(u), dto);
  }
  @Patch(':id') @RequirePermissions('leads.manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
  @Get(':id/followups') @RequirePermissions('leads.view')
  followups(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.listFollowups(tid(u), id);
  }
  @Post(':id/followups') @RequirePermissions('leads.manage')
  addFollowup(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.addFollowup(tid(u), id, dto);
  }
}

@Controller('quotations')
@RequireModule('sales')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class QuotationsController {
  constructor(
    private readonly service: QuotationsService,
    private readonly pdf: PdfService,
  ) {}

  @Get() @RequirePermissions('quotations.view')
  list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') @RequirePermissions('quotations.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post() @RequirePermissions('quotations.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(tid(u), dto);
  }
  @Patch(':id') @RequirePermissions('quotations.create')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }

  // Items
  @Post(':id/items') @RequirePermissions('quotations.create')
  addItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.addItem(tid(u), id, dto);
  }
  @Patch(':id/items/:itemId') @RequirePermissions('quotations.create')
  updateItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateItem(tid(u), id, itemId, dto);
  }
  @Delete(':id/items/:itemId') @RequirePermissions('quotations.create')
  deleteItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.deleteItem(tid(u), id, itemId);
  }

  // Approval flow. Approving/rejecting commits rates to the customer, so it is
  // gated separately from drafting.
  @Post(':id/submit') @RequirePermissions('quotations.create')
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.submit(tid(u), id);
  }
  @Post(':id/approve') @RequirePermissions('quotations.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.approve(tid(u), id);
  }
  @Post(':id/reject') @RequirePermissions('quotations.approve')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.reject(tid(u), id, dto.reason as string);
  }

  // Revisions
  @Get(':id/revisions') @RequirePermissions('quotations.view')
  revisions(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.listRevisions(tid(u), id);
  }
  @Post(':id/revisions') @RequirePermissions('quotations.create')
  createRevision(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.createRevision(tid(u), id, dto, u.userId);
  }

  // WhatsApp share foundation
  @Post(':id/share') @RequirePermissions('whatsapp.send')
  share(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.share(tid(u), id, dto);
  }

  // Quotation PDF — streamed as application/pdf (bypasses the JSON envelope).
  @Get(':id/pdf') @RequirePermissions('quotations.view')
  async pdfDoc(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { data } = await this.service.pdfData(tid(u), id);
    const buffer = await this.pdf.quotationPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.quotationNo}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}

@Controller('rate-contracts')
@RequireModule('sales')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class RateContractsController {
  constructor(private readonly service: RateContractsService) {}

  @Get() @RequirePermissions('rate_contracts.view')
  list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') @RequirePermissions('rate_contracts.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post() @RequirePermissions('rate_contracts.create')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(tid(u), dto);
  }
  @Patch(':id') @RequirePermissions('rate_contracts.create')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
  @Post(':id/items') @RequirePermissions('rate_contracts.create')
  addItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.addItem(tid(u), id, dto);
  }
  @Patch(':id/items/:itemId') @RequirePermissions('rate_contracts.create')
  updateItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateItem(tid(u), id, itemId, dto);
  }
  @Delete(':id/items/:itemId') @RequirePermissions('rate_contracts.create')
  deleteItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.deleteItem(tid(u), id, itemId);
  }
  @Post(':id/submit') @RequirePermissions('rate_contracts.create')
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.submit(tid(u), id);
  }
  // Approving a rate contract locks in customer pricing — manager-level only.
  @Post(':id/approve') @RequirePermissions('rate_contracts.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.approve(tid(u), id);
  }
  @Post(':id/reject') @RequirePermissions('rate_contracts.approve')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.reject(tid(u), id, dto.reason as string);
  }
}

@Controller('order-drafts')
@RequireModule('sales')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class OrdersDraftController {
  constructor(private readonly service: OrdersDraftService) {}

  @Get() @RequirePermissions('orders.view')
  list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') @RequirePermissions('orders.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post('from-quotation/:quotationId') @RequirePermissions('orders.create')
  fromQuotation(@CurrentUser() u: AuthUser, @Param('quotationId') quotationId: string, @Body() dto: Record<string, unknown>) {
    return this.service.fromQuotation(tid(u), quotationId, dto);
  }
  @Post('from-rate-contract/:rateContractId') @RequirePermissions('orders.create')
  fromRateContract(@CurrentUser() u: AuthUser, @Param('rateContractId') rateContractId: string, @Body() dto: Record<string, unknown>) {
    return this.service.fromRateContract(tid(u), rateContractId, dto);
  }
}

// Deliberately not module-gated: the send history spans every module, and the
// 'whatsapp.send' permission is already the real control on who can use it.
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get() @RequirePermissions('whatsapp.send')
  history(@CurrentUser() u: AuthUser) {
    return this.whatsapp.history(tid(u));
  }
}
