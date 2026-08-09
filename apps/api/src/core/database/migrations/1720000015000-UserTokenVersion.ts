import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `users.token_version` — a monotonic counter embedded in issued JWTs so a
 * session can be revoked. Bumping it (the auth service does this on a password
 * change) invalidates every previously-issued refresh token for that user,
 * closing the gap where a leaked refresh token stayed valid for its full 14-day
 * lifetime with no way to revoke it.
 *
 * Backward-compatible: the default of 0 matches tokens minted before this column
 * existed (they carry no `tv` claim, read as 0), so live sessions keep working
 * after deploy until the next password change or their natural expiry — no
 * forced mass logout on rollout.
 *
 * The `users` table already grants SELECT/INSERT/UPDATE to the app role, so the
 * runtime can read and bump the counter without a new grant.
 */
export class UserTokenVersion1720000015000 implements MigrationInterface {
  name = 'UserTokenVersion1720000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS token_version`);
  }
}
