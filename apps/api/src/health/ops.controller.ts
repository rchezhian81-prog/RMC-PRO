import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { ErrorAlertService } from '../common/error-alert.service';

/**
 * Operator self-checks that need the running API's own configuration — things
 * an owner cannot see from a screen and should not have to read a server log
 * for. Guarded like Settings (settings.manage). Never returns the webhook URL
 * itself: it carries a secret.
 */
@Controller('ops')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('settings.manage')
export class OpsController {
  constructor(private readonly alerter: ErrorAlertService) {}

  /** Is error alerting wired on this server, and which setting wired it? */
  @Get('alerting')
  alerting() {
    const source = process.env.ALERT_WEBHOOK_URL?.trim()
      ? 'ALERT_WEBHOOK_URL'
      : process.env.RMC_ALERT_WEBHOOK?.trim()
        ? 'RMC_ALERT_WEBHOOK'
        : null;
    return {
      configured: this.alerter.webhookConfigured(),
      source,
      digestEnabled: (process.env.ALERT_DIGEST_ENABLED ?? '').toLowerCase() === 'true',
    };
  }

  /** Send one test message through the real alert path and say what happened. */
  @Post('alert-test')
  alertTest() {
    return this.alerter.sendTest('api');
  }
}
