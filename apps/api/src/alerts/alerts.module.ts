import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { AlertsController, TemplatesController } from './alerts.controllers';
import { AlertsService } from './alerts.service';
import { AlertDigestWorker } from './alert-digest.worker';
import { TemplatesService } from './templates.service';

/**
 * Operational assistance that needs no external service: rule-based alerts and
 * standard message templates. Always available — unlike the AI module, these
 * features have no API key, no per-use cost, and no network dependency.
 */
@Module({
  controllers: [AlertsController, TemplatesController],
  providers: [AlertsService, TemplatesService, AlertDigestWorker, TenantGuard],
})
export class AlertsModule {}
