import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles can be archived.
 *
 * Every tenant is provisioned with twelve standard roles, all flagged as
 * system roles, which the screen would neither rename nor delete — the owner
 * asked for both. Deleting a standard role for real would not stick: the
 * production seed re-provisions any standard role a tenant lacks on every
 * deploy. So a standard role is ARCHIVED instead: the row stays (the seed sees
 * it and leaves it alone), it disappears from the lists people choose from,
 * nobody can be assigned to it, and Restore brings it back. Custom roles are
 * still deleted outright.
 */
export class RoleArchive1720000071000 implements MigrationInterface {
  name = 'RoleArchive1720000071000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE roles DROP COLUMN IF EXISTS archived_at`);
  }
}
