import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { DatabaseModule } from './core/database/database.module';
import { RbacModule } from './rbac/rbac.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PlantsModule } from './plants/plants.module';
import { PlatformModule } from './platform/platform.module';
import { SetupModule } from './setup/setup.module';
import { MastersModule } from './masters/masters.module';
import { SalesModule } from './sales/sales.module';
import { OrdersModule } from './orders/orders.module';
import { ProductionModule } from './production/production.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { InventoryModule } from './inventory/inventory.module';
import { BillingModule } from './billing/billing.module';
import { SyncModule } from './sync/sync.module';
import { AiModule } from './ai/ai.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';

/**
 * Root module. Phase-1 foundation (DEV-PLAN §5): config → throttler → database
 * (RLS) → auth → domain modules. Business modules are added here as they land.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    // Global rate limit (prod default 100 req/60s). Env-overridable so integration
    // and load tests, which drive far above a human request rate, can relax it.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    DatabaseModule,
    RbacModule,
    HealthModule,
    AuthModule,
    PlatformModule,
    SetupModule,
    MastersModule,
    SalesModule,
    OrdersModule,
    ProductionModule,
    DispatchModule,
    InventoryModule,
    BillingModule,
    SyncModule,
    PlantsModule,
    AiModule,
    AlertsModule,
    AuditModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation id + structured request log for every route (the id header is
    // set even for /health; the log line skips it — see the middleware).
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
