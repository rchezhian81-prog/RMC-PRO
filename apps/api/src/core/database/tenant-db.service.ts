import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Enforces tenant isolation at the DB layer. `runInTenant` opens a transaction,
 * sets app.current_tenant_id (transaction-local) so PostgreSQL RLS returns only
 * that tenant's rows, then runs the work on that same connection.
 */
@Injectable()
export class TenantDbService {
  constructor(private readonly dataSource: DataSource) {}

  runInTenant<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      return work(manager);
    });
  }

  /** Direct data source for non-tenant (platform) access such as auth user lookup. */
  get ds(): DataSource {
    return this.dataSource;
  }
}
