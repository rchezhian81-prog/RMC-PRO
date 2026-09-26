import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Self-service password reset, and "change it on first sign-in".
 *
 * A person who has forgotten their password asks for a reset link by email;
 * the link carries a single-use token whose SHA-256 hash and expiry live on the
 * user row (the token itself is only ever in the email). A password an
 * administrator typed for someone — a new login, or a reset from Setup → Users
 * — is flagged so the app asks that person to choose their own the first time
 * they sign in with it.
 */
export class PasswordReset1720000072000 implements MigrationInterface {
  name = 'PasswordReset1720000072000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash varchar`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz`);
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS must_change_password`);
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS password_reset_expires_at`);
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS password_reset_token_hash`);
  }
}
