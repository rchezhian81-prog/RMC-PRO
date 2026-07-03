import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

/**
 * Root application module.
 *
 * Phase-1 build sequence (Design Doc / DEV-PLAN §5): tenancy → auth → rbac →
 * platform → tenant-setup → masters → ... modules are added here as they land.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
