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

  /**
   * Run work in an UNSCOPED, cross-tenant context — the deliberate exception to
   * tenant isolation. Sets `app.platform='on'` transaction-locally, which the
   * RLS policy on `users` / `tenant_modules` reads as "the platform clause is
   * satisfied", so these rows (including super-admins, whose `tenant_id` is
   * NULL) are visible without a tenant GUC.
   *
   * ONLY for the two genuinely cross-tenant patterns:
   *   1. Authentication — look a user up by email/id *before* the tenant is
   *      known, and resolve an actor's identity for the audit trail.
   *   2. Super-admin platform administration — cross-tenant aggregates and
   *      global-uniqueness checks (email is globally unique).
   *
   * Every call site is security-sensitive and forms a small, grep-able
   * allow-list. Prefer `runInTenant` for anything scoped to one known tenant.
   */
  runAsPlatform<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.platform', 'on', true)`);
      return work(manager);
    });
  }

  /** Direct data source. With RLS now on `users`/`tenant_modules`, reads of
   *  those tables on this plain connection are fail-closed (0 rows) unless a
   *  tenant/platform context is set — use `runInTenant`/`runAsPlatform`. */
  get ds(): DataSource {
    return this.dataSource;
  }
}
