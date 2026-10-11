import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Res, UseGuards, Query } from '@nestjs/common';
import type { Response } from 'express';
import { BaseCrudController } from '../common/base-crud.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions, RequireAnyPermission } from '../rbac/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { PlanLimitsService } from '../rbac/plan-limits.service';
import { UserAccessService } from '../rbac/user-access.service';
import { isTenantOwner } from '../rbac/access';
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
    return this.svc.get(u.tenantId as string, u.userId);
  }
  @Patch()
  @RequirePermissions('settings.manage')
  update(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.update(u.tenantId as string, dto, u.userId);
  }

  /** Upload / replace the invoice logo. Body: { mime, data } (base64). */
  @Put('logo')
  @RequirePermissions('settings.manage')
  setLogo(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.setLogo(u.tenantId as string, dto.mime, dto.data);
  }

  @Delete('logo')
  @RequirePermissions('settings.manage')
  removeLogo(@CurrentUser() u: AuthUser) {
    return this.svc.removeLogo(u.tenantId as string);
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
    // The catalogue owns each setting's type; the client only sends the value.
    return this.svc.set(u.tenantId as string, key, String(dto.value ?? ''), u.userId);
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

  /** Upload / replace a user's photo. Body: { mime, data } (base64). */
  @Put(':id/photo') setPhoto(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.svc.setPhoto(u.tenantId as string, id, dto.mime, dto.data, u.userId);
  }
  @Delete(':id/photo') removePhoto(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.removePhoto(u.tenantId as string, id, u.userId);
  }
  /** Upload / replace a user's ID proof. Body: { mime, data (base64), name? }. */
  @Put(':id/id-proof') setIdProof(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.svc.setIdProof(u.tenantId as string, id, dto.mime, dto.data, dto.name, u.userId);
  }
  @Delete(':id/id-proof') removeIdProof(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.removeIdProof(u.tenantId as string, id, u.userId);
  }
}

/**
 * The stored files of a user, served as bytes (outside the JSON envelope).
 * Its own controller, with no class-level permission: a person may fetch
 * THEIR OWN photo or ID proof; anyone else's needs users.manage (or the
 * company owner), which is checked here by hand.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard)
export class UserFilesController {
  constructor(
    private readonly svc: UsersService,
    private readonly userAccess: UserAccessService,
  ) {}

  private async assertMayRead(u: AuthUser, id: string): Promise<void> {
    if (u.userId === id) return;
    const access = await this.userAccess.get(u.tenantId as string, u.userId);
    if (isTenantOwner(access) || access.permissions.includes('users.manage')) return;
    throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Missing required permission: users.manage' });
  }

  @Get(':id/photo')
  async photo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    await this.assertMayRead(u, id);
    const { mime, buffer } = await this.svc.getPhoto(u.tenantId as string, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  }

  @Get(':id/id-proof')
  async idProof(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    await this.assertMayRead(u, id);
    const { mime, name, buffer } = await this.svc.getIdProof(u.tenantId as string, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/["\r\n]/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  }
}

@Controller('roles')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('roles.manage')
export class RolesController {
  constructor(private readonly svc: RolesService) {}
  // Reads take roles.view OR roles.manage: an auditor (and the read-only
  // verification account ops runs verify-app.sh with) can see who holds what
  // without gaining the power to change it. Anyone who already had
  // roles.manage is unaffected — every mutation below still requires it.
  @Get() @RequireAnyPermission('roles.view', 'roles.manage') list(@CurrentUser() u: AuthUser, @Query('includeArchived') includeArchived?: string) {
    return this.svc.list(u.tenantId as string, includeArchived === '1' || includeArchived === 'true');
  }
  @Post(':id/restore') restore(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.restore(u.tenantId as string, id, u.userId);
  }

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.svc.create(u.tenantId as string, dto, u.userId);
  }
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.update(u.tenantId as string, id, dto, u.userId);
  }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.remove(u.tenantId as string, id, u.userId);
  }
  @Get('permissions-catalog') @RequireAnyPermission('roles.view', 'roles.manage') catalog() {
    return this.svc.permissionCatalog();
  }
  @Get(':id/permissions') @RequireAnyPermission('roles.view', 'roles.manage') getPerms(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.getPermissions(u.tenantId as string, id);
  }
  @Put(':id/permissions') setPerms(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const ids = Array.isArray(dto.permissionIds) ? (dto.permissionIds as string[]) : [];
    return this.svc.setPermissions(u.tenantId as string, id, ids, u.userId);
  }
}
