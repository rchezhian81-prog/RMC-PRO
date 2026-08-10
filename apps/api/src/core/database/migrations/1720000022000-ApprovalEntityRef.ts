import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add an optional domain-object reference to `agent_approval_requests` so an
 * approved action can be executed against the right record (the GST execution
 * scaffold resolves the invoice from `entity_id`). Generic `entity_type` +
 * `entity_id`, mirroring the audit-log shape. Additive and nullable — existing
 * rows and the RLS policy are unaffected. Reversible: `down()` drops the columns.
 */
export class ApprovalEntityRef1720000022000 implements MigrationInterface {
  name = 'ApprovalEntityRef1720000022000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agent_approval_requests ADD COLUMN entity_type varchar;`);
    await q.query(`ALTER TABLE agent_approval_requests ADD COLUMN entity_id uuid;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agent_approval_requests DROP COLUMN IF EXISTS entity_id;`);
    await q.query(`ALTER TABLE agent_approval_requests DROP COLUMN IF EXISTS entity_type;`);
  }
}
