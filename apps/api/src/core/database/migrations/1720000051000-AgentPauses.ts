import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-agent pause overrides (Agent Governor v2). A tenant-scoped, RLS-enforced
 * table letting an operator stop ONE agent without flipping the tenant-wide kill
 * switch on `agent_controls` — pause the automation agent while the read-only
 * monitors keep running. One row per (tenant, agent); the `paused` flag is
 * authoritative for that agent, and no row means "follow the tenant default".
 *
 * Same fail-closed, NULLIF-guarded RLS clause as the rest of the agent substrate
 * (migration 19), and the app role gets SELECT/INSERT/UPDATE so the governor can
 * upsert. Reversible: down() drops the table.
 */
export class AgentPauses1720000051000 implements MigrationInterface {
  name = 'AgentPauses1720000051000';

  public async up(q: QueryRunner): Promise<void> {
    const appUser = (process.env.APP_DB_USER ?? 'rmc_app').replace(/[^a-zA-Z0-9_]/g, '');
    const clause = `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`;

    await q.query(`
      CREATE TABLE agent_pauses (
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        agent_name varchar NOT NULL,
        paused boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid,
        PRIMARY KEY (tenant_id, agent_name)
      );
    `);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON agent_pauses TO ${appUser};`);
    await q.query(`ALTER TABLE agent_pauses ENABLE ROW LEVEL SECURITY;`);
    await q.query(`ALTER TABLE agent_pauses FORCE ROW LEVEL SECURITY;`);
    await q.query(`CREATE POLICY tenant_isolation ON agent_pauses USING (${clause}) WITH CHECK (${clause});`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS agent_pauses CASCADE;`);
  }
}
