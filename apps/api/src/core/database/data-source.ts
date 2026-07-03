import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entity-list';
import { Init1720000000000 } from './migrations/1720000000000-Init';
import { Platform1720000001000 } from './migrations/1720000001000-Platform';
import { Masters1720000002000 } from './migrations/1720000002000-Masters';
import { Sales1720000003000 } from './migrations/1720000003000-Sales';
import { Orders1720000004000 } from './migrations/1720000004000-Orders';
import { Production1720000005000 } from './migrations/1720000005000-Production';
import { Dispatch1720000006000 } from './migrations/1720000006000-Dispatch';

/**
 * CLI DataSource for migrations & seed.
 * Connects as the OWNER/superuser role (POSTGRES_USER) which BYPASSES RLS —
 * correct for schema changes and cross-tenant seeding. The API runtime connects
 * as the non-superuser APP_DB_USER instead (see database.module.ts).
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc',
  password: process.env.POSTGRES_PASSWORD ?? 'rmc',
  entities: ENTITIES,
  migrations: [
    Init1720000000000,
    Platform1720000001000,
    Masters1720000002000,
    Sales1720000003000,
    Orders1720000004000,
    Production1720000005000,
    Dispatch1720000006000,
  ],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});
