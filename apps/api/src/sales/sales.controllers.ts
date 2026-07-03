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
import { LeadsService } from './leads.service';
import { QuotationsService } from './quotations.service';
import { RateContractsService } from './rate-contracts.service';
import { OrdersDraftService } from './orders-draft.service';
import { PdfService } from './pdf.service';
import { WhatsAppService } from './whatsapp.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('leads')
@UseGuards(JwtAuthGuard, TenantGuard)
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(tid(u), dto);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
  @Get(':id/followups') followups(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.listFollowups(tid(u), id);
  }
  @Post(':id/followups') addFollowup(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.addFollowup(tid(u), id, dto);
  }
}

@Controller('quotations')
@UseGuards(JwtAuthGuard, TenantGuard)
export class QuotationsController {
  constructor(
    private readonly service: QuotationsService,
    private readonly pdf: PdfService,
  ) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(tid(u), dto);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }

  // Items
  @Post(':id/items') addItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.addItem(tid(u), id, dto);
  }
  @Patch(':id/items/:itemId') updateItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateItem(tid(u), id, itemId, dto);
  }
  @Delete(':id/items/:itemId') deleteItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.deleteItem(tid(u), id, itemId);
  }

  // Approval flow
  @Post(':id/submit') submit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.submit(tid(u), id);
  }
  @Post(':id/approve') approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.approve(tid(u), id);
  }
  @Post(':id/reject') reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.reject(tid(u), id, dto.reason as string);
  }

  // Revisions
  @Get(':id/revisions') revisions(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.listRevisions(tid(u), id);
  }
  @Post(':id/revisions') createRevision(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.createRevision(tid(u), id, dto, u.userId);
  }

  // WhatsApp share foundation
  @Post(':id/share') share(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.share(tid(u), id, dto);
  }

  // Quotation PDF — streamed as application/pdf (bypasses the JSON envelope).
  @Get(':id/pdf') async pdfDoc(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { data } = await this.service.pdfData(tid(u), id);
    const buffer = await this.pdf.quotationPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.quotationNo}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}

@Controller('rate-contracts')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RateContractsController {
  constructor(private readonly service: RateContractsService) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(tid(u), dto);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
  @Post(':id/items') addItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.addItem(tid(u), id, dto);
  }
  @Patch(':id/items/:itemId') updateItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateItem(tid(u), id, itemId, dto);
  }
  @Delete(':id/items/:itemId') deleteItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.service.deleteItem(tid(u), id, itemId);
  }
  @Post(':id/submit') submit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.submit(tid(u), id);
  }
  @Post(':id/approve') approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.approve(tid(u), id);
  }
  @Post(':id/reject') reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.reject(tid(u), id, dto.reason as string);
  }
}

@Controller('order-drafts')
@UseGuards(JwtAuthGuard, TenantGuard)
export class OrdersDraftController {
  constructor(private readonly service: OrdersDraftService) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }
  @Post('from-quotation/:quotationId') fromQuotation(@CurrentUser() u: AuthUser, @Param('quotationId') quotationId: string, @Body() dto: Record<string, unknown>) {
    return this.service.fromQuotation(tid(u), quotationId, dto);
  }
  @Post('from-rate-contract/:rateContractId') fromRateContract(@CurrentUser() u: AuthUser, @Param('rateContractId') rateContractId: string, @Body() dto: Record<string, unknown>) {
    return this.service.fromRateContract(tid(u), rateContractId, dto);
  }
}

@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard)
export class NotificationsController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get() history(@CurrentUser() u: AuthUser) {
    return this.whatsapp.history(tid(u));
  }
}
