import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The L2 approval substrate (M4). `agent_approval_requests` holds a high-risk
 * action an agent PREPARED for a human to approve — the "prepare-and-block"
 * mechanism that makes autonomy safe: the agent never executes a
 * financial/legal/irreversible action, it records one here as `pending`, and a
 * human with `agents.approve` decides.
 *
 * Tenant-scoped under FORCE RLS with the same NULLIF-guarded clause as the other
 * agent tables. Mutable (SELECT/INSERT/UPDATE) — an agent inserts a pending row,
 * a human updates its status once. Reversible: `down()` drops the table.
 */
export class AgentApprovals1720000021000 implements MigrationInterface {
  name = 'AgentApprovals1720000021000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    await q.query(`
      CREATE TABLE agent_approval_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        run_id uuid REFERENCES agent_runs(id),
        agent_name varchar NOT NULL,
        action_kind varchar NOT NULL,
        title varchar NOT NULL,
        payload jsonb,
        reversibility varchar,
        status varchar NOT NULL DEFAULT 'pending',
        requested_by uuid,
        decided_by uuid,
        decided_at timestamptz,
        decision_reason varchar
      );
    `);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON agent_approval_requests TO ${appUser};`);
    await q.query(`ALTER TABLE agent_approval_requests ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE agent_approval_requests FORCE ROW LEVEL SECURITY;`);
    const clause = `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`;
    await q.query(`
      CREATE POLICY tenant_isolation ON agent_approval_requests
        USING (${clause}) WITH CHECK (${clause});
    `);
    await q.query(
      `CREATE INDEX idx_agent_approvals_tenant_status ON agent_approval_requests (tenant_id, status, created_at DESC);`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS agent_approval_requests CASCADE;`);
  }
}
