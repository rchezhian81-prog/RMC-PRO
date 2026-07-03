import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { BaseCrudController } from '../common/base-crud.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { NumberSeries } from '../core/database/entities';
import {
  CompanyService,
  NumberSeriesService,
  RolesService,
  SettingsService,
  UsersService,
} from './setup.services';

@Controller('company')
@UseGuards(JwtAuthGuard, TenantGuard)
export class CompanyController {
  constructor(private readonly svc: CompanyService) {}
  @Get() get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u.tenantId as string);
  }
  @Patch() update(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.update(u.tenantId as string, dto);
  }
}

@Controller('settings')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId as string);
  }
  @Put(':key') set(
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

@Controller('number-series')
@UseGuards(JwtAuthGuard, TenantGuard)
export class NumberSeriesController extends BaseCrudController<NumberSeries> {
  constructor(protected readonly service: NumberSeriesService) {
    super();
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard)
export class UsersController {
  constructor(private readonly svc: UsersService) {}
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
}

@Controller('roles')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RolesController {
  constructor(private readonly svc: RolesService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId as string);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.create(u.tenantId as string, dto);
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
