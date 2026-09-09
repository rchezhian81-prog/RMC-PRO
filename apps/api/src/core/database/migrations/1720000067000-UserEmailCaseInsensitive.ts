import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One user per email address, judged the way login judges it.
 *
 * `users.email` carries a plain UNIQUE, which Postgres applies case-SENSITIVELY,
 * while every lookup that matters compares `LOWER(email)`: AuthService.login,
 * AuthService.refresh's identity read, and the duplicate check in
 * SetupService.createUser. So `owner@x.com` and `Owner@X.com` could both exist,
 * and both would answer the login query — leaving `getOne()` to pick one
 * arbitrarily. Since email is global (a user belongs to exactly one tenant and
 * login names no tenant), the row it picks can belong to a DIFFERENT COMPANY
 * than the one whose password was typed.
 *
 * The API could not reach that state — createUser and createTenantUser both
 * lower-case on write and email is not updatable — but seed-prod only trimmed
 * SUPERADMIN_EMAIL, so a casing change between deploys created a second super
 * admin. That is fixed alongside this; the index makes the invariant the
 * schema's rather than three call sites' to remember.
 *
 * Safe failure mode: up() counts case-insensitive duplicates first and throws
 * one message naming them, altering nothing; the deploy preflight reports the
 * same rows read-only beforehand. The original case-sensitive UNIQUE stays —
 * this is strictly stronger, and keeping it means down() restores exactly the
 * previous constraint set.
 */
export class UserEmailCaseInsensitive1720000067000 implements MigrationInterface {
  name = 'UserEmailCaseInsensitive1720000067000';

  public async up(q: QueryRunner): Promise<void> {
    const dups: Array<{ email: string; copies: number }> = await q.query(
      `SELECT lower(email) AS email, count(*)::int AS copies FROM users
        GROUP BY lower(email) HAVING count(*) > 1`,
    );
    if (dups.length) {
      throw new Error(
        'UserEmailCaseInsensitive1720000067000: the same email exists more than once ignoring case — ' +
          'decide which account is real and remove or rename the other first:\n  - ' +
          dups.map((d) => `"${d.email}" on ${d.copies} users`).join('\n  - '),
      );
    }
    await q.query(`CREATE UNIQUE INDEX "uq_users_email_lower" ON users (lower(email))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_users_email_lower"`);
  }
}
