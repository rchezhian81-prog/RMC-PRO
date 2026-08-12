import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { ImportService } from './import.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * Bulk import (Plan F1). Download a CSV template for a master, upload a filled
 * file, and get back a tracked job with success / error counts. Not tied to a
 * subscription module — an onboarding capability for every tenant — but gated by
 * permission: viewing jobs vs. running an import are separate keys.
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Get() @RequirePermissions('imports.view')
  list(@CurrentUser() u: AuthUser) { return this.service.list(tid(u)); }

  @Get('definitions') @RequirePermissions('imports.view')
  definitions() { return this.service.definitions(); }

  @Get(':entityType/template') @RequirePermissions('imports.view')
  template(@Param('entityType') entityType: string, @Res() res: Response) {
    const csv = this.service.template(entityType);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${entityType}-import-template.csv"`);
    res.send(csv);
  }

  @Get(':id') @RequirePermissions('imports.view')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.get(tid(u), id); }

  @Post(':entityType') @RequirePermissions('imports.run')
  run(@CurrentUser() u: AuthUser, @Param('entityType') entityType: string, @Body() dto: Record<string, unknown>) {
    return this.service.run(tid(u), entityType, String(dto.content ?? ''), (dto.fileName as string) ?? null, u.userId);
  }
}
