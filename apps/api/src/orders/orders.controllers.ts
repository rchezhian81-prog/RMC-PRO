import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { OrdersService } from './orders.service';
import { CreditHoldService } from './credit-hold.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('orders')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  @RequirePermissions('orders.view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.service.list(tid(u), status);
  }

  @Get(':id')
  @RequirePermissions('orders.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(tid(u), id);
  }

  @Get(':id/credit-check')
  @RequirePermissions('orders.view')
  creditCheck(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.creditCheck(tid(u), id);
  }

  @Post(':id/confirm')
  @RequirePermissions('orders.confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.confirm(tid(u), id, u.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('orders.confirm')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.cancel(tid(u), id, u.userId, dto.reason as string);
  }
}

@Controller('credit-holds')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CreditHoldsController {
  constructor(private readonly service: CreditHoldService) {}

  @Get()
  @RequirePermissions('orders.view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.service.list(tid(u), status);
  }

  @Post(':id/approve')
  @RequirePermissions('credit_hold.approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.approve(tid(u), id, u.userId, dto.note as string);
  }

  @Post(':id/reject')
  @RequirePermissions('credit_hold.approve')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.reject(tid(u), id, u.userId, dto.note as string);
  }
}
