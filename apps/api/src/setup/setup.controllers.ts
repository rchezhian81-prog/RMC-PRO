import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { BaseCrudController } from '../common/base-crud.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { PlanLimitsService } from '../rbac/plan-limits.service';
import { NumberSeries } from '../core/database/entities';
import {
  CompanyService,
  NumberSeriesService,
  RolesService,
  SettingsService,
  UsersService,
} from './setup.services';

@Controller('company')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CompanyController {
  constructor(private readonly svc: CompanyService) {}
  @Get() get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u.tenantId as string);
  }
  @Patch()
  @RequirePermissions('settings.manage')
  update(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.update(u.tenantId as string, dto);
  }
}

@Controller('settings')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId as string);
  }
  @Put(':key')
  @RequirePermissions('settings.manage')
  set(
    @CurrentUser() u: AuthUser,
    @Param('key') key: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.set(
      u.tenantId as string,
      key,
      String(dto.value ?? ''),
      dto.dataType ? String(dto.dataType) : 'string',
    );
  }
}

/**
 * What the tenant's plan allows and what it is using. Ungated beyond being a
 * tenant user: it is two counts and two caps, and both the Users and Plants
 * screens need it to say "3 of 5" before someone fills in a form that would be
 * refused on submit.
 */
@Controller('plan-usage')
@UseGuards(JwtAuthGuard, TenantGuard)
export class PlanUsageController {
  constructor(private readonly planLimits: PlanLimitsService) {}
  @Get() get(@CurrentUser() u: AuthUser) {
    return this.planLimits.usage(u.tenantId as string);
  }
}

@Controller('number-series')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('number_series.manage')
export class NumberSeriesController extends BaseCrudController<NumberSeries> {
  constructor(protected readonly service: NumberSeriesService) {
    super();
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('users.manage')
export class UsersController {
  constructor(private readonly svc: UsersService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId as string);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.create(u.tenantId as string, dto, u.userId);
  }
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    // The caller is passed through so the service can refuse an admin acting
    // on the owner, or on themselves in a way that locks them out.
    return this.svc.update(u.tenantId as string, id, dto, u.userId);
  }
}

@Controller('roles')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('roles.manage')
export class RolesController {
  constructor(private readonly svc: RolesService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId as string);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.create(u.tenantId as string, dto);
  }
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.update(u.tenantId as string, id, dto);
  }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.remove(u.tenantId as string, id);
  }
  @Get('permissions-catalog') catalog() {
    return this.svc.permissionCatalog();
  }
  @Get(':id/permissions') getPerms(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.getPermissions(u.tenantId as string, id);
  }
  @Put(':id/permissions') setPerms(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const ids = Array.isArray(dto.permissionIds) ? (dto.permissionIds as string[]) : [];
    return this.svc.setPermissions(u.tenantId as string, id, ids);
  }
}
