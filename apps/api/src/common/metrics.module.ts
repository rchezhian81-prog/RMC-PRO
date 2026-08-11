import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { ErrorAlertService } from './error-alert.service';

/**
 * Global observability primitives, shared as single instances across the app:
 *   - {@link MetricsService} — the hand-rolled Prometheus registry, shared
 *     between the recorder (RequestContextMiddleware) and the `/metrics` route;
 *   - {@link ErrorAlertService} — the ops alerter (5xx + operational conditions),
 *     one instance so its dedup window / circuit breaker span the HTTP filter
 *     (main.ts) and domain callers (e.g. GST auth failures / dead-lettered jobs).
 *
 * ErrorAlertService is env-configured with no DI dependencies, so it is provided
 * via a factory (`new ErrorAlertService()`) rather than class reflection.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, { provide: ErrorAlertService, useFactory: () => new ErrorAlertService() }],
  exports: [MetricsService, ErrorAlertService],
})
export class MetricsModule {}
