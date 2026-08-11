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
import { Inventory1720000007000 } from './migrations/1720000007000-Inventory';
import { Billing1720000008000 } from './migrations/1720000008000-Billing';
import { Sync1720000009000 } from './migrations/1720000009000-Sync';
import { Indexes1720000010000 } from './migrations/1720000010000-Indexes';
import { Audit1720000011000 } from './migrations/1720000011000-Audit';
import { CompanyProfile1720000012000 } from './migrations/1720000012000-CompanyProfile';
import { CompanyLogo1720000013000 } from './migrations/1720000013000-CompanyLogo';
import { StockBalancePlantNotNull1720000014000 } from './migrations/1720000014000-StockBalancePlantNotNull';
import { UserTokenVersion1720000015000 } from './migrations/1720000015000-UserTokenVersion';
import { DataIntegrityChecks1720000016000 } from './migrations/1720000016000-DataIntegrityChecks';
import { StockTransactionPlantNotNull1720000017000 } from './migrations/1720000017000-StockTransactionPlantNotNull';
import { UsersTenantModulesRls1720000018000 } from './migrations/1720000018000-UsersTenantModulesRls';
import { AgentSubstrate1720000019000 } from './migrations/1720000019000-AgentSubstrate';
import { AgentRunParent1720000020000 } from './migrations/1720000020000-AgentRunParent';
import { AgentApprovals1720000021000 } from './migrations/1720000021000-AgentApprovals';
import { ApprovalEntityRef1720000022000 } from './migrations/1720000022000-ApprovalEntityRef';
import { GstCredentials1720000023000 } from './migrations/1720000023000-GstCredentials';
import { GstExecutionJobs1720000024000 } from './migrations/1720000024000-GstExecutionJobs';

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
    Inventory1720000007000,
    Billing1720000008000,
    Sync1720000009000,
    Indexes1720000010000,
    Audit1720000011000,
    CompanyProfile1720000012000,
    CompanyLogo1720000013000,
    StockBalancePlantNotNull1720000014000,
    UserTokenVersion1720000015000,
    DataIntegrityChecks1720000016000,
    StockTransactionPlantNotNull1720000017000,
    UsersTenantModulesRls1720000018000,
    AgentSubstrate1720000019000,
    AgentRunParent1720000020000,
    AgentApprovals1720000021000,
    ApprovalEntityRef1720000022000,
    GstCredentials1720000023000,
    GstExecutionJobs1720000024000,
  ],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});
