import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { ExpenseGroupService, ExpenseHeadService } from './expense-master.service';
import { ExpenseVoucherService } from './expense-voucher.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('expense-groups')
@RequireModule('expenses')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ExpenseGroupController {
  constructor(private readonly service: ExpenseGroupService) {}

  @Get() @RequirePermissions('expenses.view')
  list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }

  @Get(':id') @RequirePermissions('expenses.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('expenses.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Put(':id') @RequirePermissions('expenses.manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
}

@Controller('expense-heads')
@RequireModule('expenses')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ExpenseHeadController {
  constructor(private readonly service: ExpenseHeadService) {}

  @Get() @RequirePermissions('expenses.view')
  list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }

  @Get(':id') @RequirePermissions('expenses.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('expenses.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Put(':id') @RequirePermissions('expenses.manage')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.update(tid(u), id, dto);
  }
}

@Controller('expense-vouchers')
@RequireModule('expenses')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ExpenseVoucherController {
  constructor(private readonly service: ExpenseVoucherService) {}

  @Get() @RequirePermissions('expenses.view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.service.list(tid(u), status); }

  @Get('report/allocation') @RequirePermissions('expenses.view')
  report(
    @CurrentUser() u: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('plantId') plantId?: string,
  ) {
    return this.service.allocationReport(tid(u), { from, to, plantId });
  }

  @Get(':id') @RequirePermissions('expenses.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post() @RequirePermissions('expenses.manage')
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) { return this.service.create(tid(u), dto); }

  @Post(':id/post') @RequirePermissions('expenses.post')
  post(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.post(tid(u), id, u.userId); }

  @Post(':id/cancel') @RequirePermissions('expenses.manage')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.cancel(tid(u), id); }
}
