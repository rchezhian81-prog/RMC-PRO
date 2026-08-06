import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { AlertsService } from './alerts.service';
import { TemplatesService } from './templates.service';

const tid = (u: AuthUser) => u.tenantId as string;

/** Deterministic "what needs attention today" list for the dashboard. */
@Controller('alerts')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
}

/** Standard customer-message templates (merge fields rendered client-side). */
@Controller('message-templates')
@UseGuards(JwtAuthGuard, TenantGuard)
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.service.list(tid(u));
  }
}
