import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { DispatchService } from './dispatch.service';
import { DeliveryChallanService } from './delivery-challan.service';
import { PdfService } from '../sales/pdf.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('dispatches')
@RequireModule('dispatch')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class DispatchController {
  constructor(private readonly service: DispatchService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post('from-batch-ticket/:batchTicketId')
  @RequirePermissions('dispatch.update_status')
  create(@CurrentUser() u: AuthUser, @Param('batchTicketId') batchTicketId: string, @Body() dto: Record<string, unknown>) {
    return this.service.createFromBatchTicket(tid(u), batchTicketId, dto, u.userId);
  }

  @Post(':id/status')
  @RequirePermissions('dispatch.update_status')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.setStatus(tid(u), id, String(dto.status), u.userId, dto);
  }
}

@Controller('delivery-challans')
@RequireModule('dispatch')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class DeliveryChallanController {
  constructor(
    private readonly service: DeliveryChallanService,
    private readonly pdf: PdfService,
  ) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post('from-dispatch/:dispatchId')
  @RequirePermissions('delivery_challans.create')
  create(@CurrentUser() u: AuthUser, @Param('dispatchId') dispatchId: string, @Body() dto: Record<string, unknown>) {
    return this.service.createFromDispatch(tid(u), dispatchId, dto, u.userId);
  }

  @Post(':id/issue')
  @RequirePermissions('delivery_challans.create')
  issue(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.issue(tid(u), id, u.userId); }

  @Post(':id/deliver')
  @RequirePermissions('delivery_challans.create')
  deliver(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.markDelivered(tid(u), id, dto, u.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('delivery_challans.create')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.cancel(tid(u), id, u.userId, dto.reason as string);
  }

  @Post(':id/share')
  @RequirePermissions('delivery_challans.create')
  share(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.share(tid(u), id, dto);
  }

  @Get(':id/pdf')
  async pdfDoc(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { data } = await this.service.pdfData(tid(u), id);
    const buffer = await this.pdf.challanPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.challanNo}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
