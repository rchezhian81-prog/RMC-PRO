import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './entity-list';
import { TenantDbService } from './tenant-db.service';

/**
 * Runtime DB wiring. The API connects as APP_DB_USER (non-superuser) so it is
 * subject to Row-Level Security — the enforcement layer for tenant isolation.
 * Schema changes run via the CLI DataSource (owner role); this module never
 * synchronizes or runs migrations at boot.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'rmc',
        username: process.env.APP_DB_USER ?? 'rmc_app',
        password: process.env.APP_DB_PASSWORD ?? 'rmc_app',
        entities: ENTITIES,
        synchronize: false,
        migrationsRun: false,
        logging: process.env.DB_LOGGING === 'true',
      }),
    }),
  ],
  providers: [TenantDbService],
  exports: [TenantDbService, TypeOrmModule],
})
export class DatabaseModule {}
