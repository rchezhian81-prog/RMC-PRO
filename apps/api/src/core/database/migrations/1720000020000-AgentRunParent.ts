import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Escalation linkage (M2). Adds `agent_runs.parent_run_id` so a run spawned by
 * one agent escalating to another (e.g. Monitor → Specialist) is a first-class,
 * queryable child of its parent run. Nullable self-reference; the RLS policy on
 * `agent_runs` is unchanged (both parent and child are the same tenant's rows).
 *
 * Reversible: `down()` drops the index and the column.
 */
export class AgentRunParent1720000020000 implements MigrationInterface {
  name = 'AgentRunParent1720000020000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agent_runs ADD COLUMN parent_run_id uuid REFERENCES agent_runs(id);`);
    await q.query(`CREATE INDEX idx_agent_runs_parent ON agent_runs (tenant_id, parent_run_id);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_agent_runs_parent;`);
    await q.query(`ALTER TABLE agent_runs DROP COLUMN IF EXISTS parent_run_id;`);
  }
}
