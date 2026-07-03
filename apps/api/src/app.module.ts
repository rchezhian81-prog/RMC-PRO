import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './core/database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PlantsModule } from './plants/plants.module';
import { PlatformModule } from './platform/platform.module';
import { SetupModule } from './setup/setup.module';
import { MastersModule } from './masters/masters.module';
import { SalesModule } from './sales/sales.module';
import { OrdersModule } from './orders/orders.module';
import { ProductionModule } from './production/production.module';
import { DemoModule } from './demo/demo.module';

/**
 * Root module. Phase-1 foundation (DEV-PLAN §5): config → throttler → database
 * (RLS) → auth → domain modules. Business modules are added here as they land.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    HealthModule,
    AuthModule,
    PlatformModule,
    SetupModule,
    MastersModule,
    SalesModule,
    OrdersModule,
    ProductionModule,
    PlantsModule,
    DemoModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
