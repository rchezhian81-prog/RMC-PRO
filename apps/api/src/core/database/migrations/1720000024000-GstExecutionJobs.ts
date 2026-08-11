import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable, on-approval GST execution queue (GW-1). When a human approves a GST
 * action, a job is enqueued here rather than the request thread calling the slow,
 * rate-limited government portal inline; a background worker (or an operator
 * drain) processes queued jobs by running the idempotent execution service, with
 * backoff retries and dead-lettering after `max_attempts`. One job per approval
 * (`uq_gst_execution_jobs_approval`).
 *
 * Tenant-scoped under FORCE RLS with the NULLIF-guarded tenant clause PLUS an
 * `app.platform` clause, so the cross-tenant worker (runAsPlatform) can scan for
 * due jobs while every invoice mutation still happens tenant-scoped inside
 * execute(). Reversible: `down()` drops it.
 */
export class GstExecutionJobs1720000024000 implements MigrationInterface {
  name = 'GstExecutionJobs1720000024000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    await q.query(`
      CREATE TABLE gst_execution_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        approval_id uuid NOT NULL REFERENCES agent_approval_requests(id),
        invoice_id uuid NOT NULL,
        action_kind varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'queued',
        attempts int NOT NULL DEFAULT 0,
        max_attempts int NOT NULL DEFAULT 5,
        last_outcome varchar,
        last_error varchar,
        next_run_at timestamptz NOT NULL DEFAULT now(),
        requested_by uuid,
        CONSTRAINT uq_gst_execution_jobs_approval UNIQUE (approval_id),
        CONSTRAINT chk_gst_execution_jobs_status CHECK (status IN ('queued','running','done','failed','dead'))
      );
    `);
    await q.query(`CREATE INDEX idx_gst_execution_jobs_tenant ON gst_execution_jobs (tenant_id);`);
    // The worker's due-scan: queued jobs whose next_run_at has arrived, oldest first.
    await q.query(`CREATE INDEX idx_gst_execution_jobs_due ON gst_execution_jobs (status, next_run_at);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON gst_execution_jobs TO ${appUser};`);
    await q.query(`ALTER TABLE gst_execution_jobs ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE gst_execution_jobs FORCE ROW LEVEL SECURITY;`);
    await q.query(`
      CREATE POLICY tenant_isolation ON gst_execution_jobs
        USING (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        )
        WITH CHECK (
              tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
           OR current_setting('app.platform', true) = 'on'
        );
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON gst_execution_jobs;`);
    await q.query(`ALTER TABLE gst_execution_jobs NO FORCE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE gst_execution_jobs DISABLE ROW LEVEL SECURITY;`);
    await q.query(`DROP TABLE IF EXISTS gst_execution_jobs;`);
  }
}
