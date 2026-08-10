import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-agent substrate (M0 of `docs/audit/MULTI_AGENT_SYSTEM_ARCHITECTURE.md`).
 *
 * Three tenant-scoped tables under database-enforced Row-Level Security, so the
 * agentic layer inherits the exact isolation guarantee the rest of the product
 * rests on — an agent can never touch another tenant's runs (WR-AGT-2):
 *
 *   - `agent_controls`   the per-tenant kill switch + per-run budgets. Mutable
 *                        (SELECT/INSERT/UPDATE) — the switch flips and the
 *                        governor upserts a default row on first use.
 *   - `agent_runs`       one row per orchestrated task; status + usage counters
 *                        are updated as the run progresses (SELECT/INSERT/UPDATE).
 *   - `agent_run_steps`  the append-only trail of every tool call / block inside
 *                        a run. Like `audit_logs`, the app role gets SELECT +
 *                        INSERT only, so a step trail can never be rewritten.
 *
 * The RLS policy is the fail-CLOSED, NULLIF-guarded tenant clause used by the
 * newest tables (migration 18): with no tenant GUC set the query returns nothing,
 * and the `NULLIF(...,'')` guard stops the uuid cast raising on a pooled
 * connection whose transaction-local GUC has reverted to ''. There is no platform
 * clause — agent data is tenant-owned and is only ever accessed via `runInTenant`.
 *
 * Reversible: `down()` drops the three tables.
 */
export class AgentSubstrate1720000019000 implements MigrationInterface {
  name = 'AgentSubstrate1720000019000';

  private tenantPolicy(table: string): string {
    // Identical fail-closed clause on USING and WITH CHECK.
    const clause = `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`;
    return `
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ${table}
        USING (${clause})
        WITH CHECK (${clause});
    `;
  }

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');

    // --- agent_controls: kill switch + budgets (one row per tenant) ---
    await q.query(`
      CREATE TABLE agent_controls (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
        automation_paused boolean NOT NULL DEFAULT false,
        max_steps_per_run int NOT NULL DEFAULT 50,
        max_actions_per_run int NOT NULL DEFAULT 10,
        last_diagnostic_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid,
        CONSTRAINT chk_agent_controls_steps CHECK (max_steps_per_run >= 0),
        CONSTRAINT chk_agent_controls_actions CHECK (max_actions_per_run >= 0)
      );
    `);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON agent_controls TO ${appUser};`);
    await q.query(this.tenantPolicy('agent_controls'));

    // --- agent_runs: one row per orchestrated task ---
    await q.query(`
      CREATE TABLE agent_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        agent_name varchar NOT NULL,
        task_kind varchar,
        status varchar NOT NULL DEFAULT 'running',
        steps_used int NOT NULL DEFAULT 0,
        actions_used int NOT NULL DEFAULT 0,
        created_by uuid,
        summary varchar,
        outcome jsonb,
        ended_at timestamptz,
        CONSTRAINT chk_agent_runs_steps CHECK (steps_used >= 0),
        CONSTRAINT chk_agent_runs_actions CHECK (actions_used >= 0)
      );
    `);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON agent_runs TO ${appUser};`);
    await q.query(this.tenantPolicy('agent_runs'));
    await q.query(`CREATE INDEX idx_agent_runs_tenant_time ON agent_runs (tenant_id, created_at DESC);`);

    // --- agent_run_steps: append-only per-step trail ---
    await q.query(`
      CREATE TABLE agent_run_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        run_id uuid NOT NULL REFERENCES agent_runs(id),
        seq int NOT NULL,
        step_type varchar NOT NULL,
        tool_name varchar,
        tool_kind varchar,
        reversibility varchar,
        policy_verdict varchar,
        detail jsonb
      );
    `);
    // Append-only: read and write the trail, never change or erase a step.
    await q.query(`GRANT SELECT, INSERT ON agent_run_steps TO ${appUser};`);
    await q.query(this.tenantPolicy('agent_run_steps'));
    await q.query(`CREATE INDEX idx_agent_run_steps_run ON agent_run_steps (tenant_id, run_id, seq);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS agent_run_steps CASCADE;`);
    await q.query(`DROP TABLE IF EXISTS agent_runs CASCADE;`);
    await q.query(`DROP TABLE IF EXISTS agent_controls CASCADE;`);
  }
}
