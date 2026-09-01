import 'reflect-metadata';
import { Client } from 'pg';

/**
 * Pre-deploy DB AUTH gate. Verifies that BOTH database roles the deploy relies on
 * can actually authenticate against the live Postgres — the OWNER role
 * (POSTGRES_USER, used by the one-shot `migrate` step) and the APP role
 * (APP_DB_USER, used by the running API under RLS).
 *
 * Why this exists: the Postgres image only applies POSTGRES_PASSWORD when it first
 * initialises an EMPTY data volume. A later change to a password in
 * .env.production therefore leaves the role's STORED password stale, and the two
 * silently diverge. The failure modes are nasty and asymmetric:
 *   • owner drift  -> the `migrate` one-shot fails with 28P01, and because `api`
 *     is gated on `migrate` completing, the API never starts -> a hard outage
 *     (ERR_CONNECTION_REFUSED), and migrations silently stop advancing.
 *   • app drift    -> the API boots but every query fails auth, so the UI shows
 *     "Cannot reach the server" even though nginx and the page shell are up.
 * Neither is caught by the data-integrity preflight (which connects as the owner
 * only). This check closes that gap by probing BOTH roles up front, so a password
 * mismatch fails LOUDLY before `up -d`, not as a post-cutover outage.
 *
 * Read-only: it opens a connection and runs `select 1`. It changes nothing.
 *
 * Exit codes:  0 = both roles authenticate (safe) · 1 = a role password does not
 *              match the database (fix first) · 2 = could not verify (fail closed).
 *
 * Usage on the box (via the migrate service's env, which carries both role creds):
 *   scripts/ops/db-auth-check.sh
 * or directly:
 *   node dist/core/database/db-auth-check.js
 */

export interface RoleConn {
  /** Human label for the role's job, e.g. 'owner (migrations)'. */
  label: string;
  user: string;
  password: string;
}

export type ConnKind = 'auth' | 'unreachable' | 'other';

export interface ProbeResult {
  ok: boolean;
  kind?: ConnKind;
  detail?: string;
}

const log = (msg: string): void => console.log(`[db-auth] ${msg}`);

/**
 * Pure: classify a connection error into a coarse kind + one-line detail.
 * `28P01`/`28000` are Postgres authentication failures (wrong password / not
 * permitted); the ECONN* / DNS / timeout codes mean the server was unreachable,
 * which is "could not verify" rather than "auth is wrong".
 */
export function classifyConnError(err: unknown): { kind: ConnKind; detail: string } {
  const e = (err ?? {}) as { code?: string; message?: string };
  const code = e.code;
  const detail = (e.message ?? String(err)).split('\n')[0] ?? '';
  if (code === '28P01' || code === '28000') {
    return { kind: 'auth', detail: 'password authentication failed' };
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET'
  ) {
    return { kind: 'unreachable', detail };
  }
  return { kind: 'other', detail };
}

/**
 * Pure: collapse per-role outcomes into one exit code.
 *   0 = every role authenticated.
 *   1 = at least one DEFINITE auth mismatch (actionable — fix the password).
 *   2 = no auth mismatch but something could not be verified (fail closed).
 */
export function overallExitCode(results: ProbeResult[]): 0 | 1 | 2 {
  if (results.every((r) => r.ok)) return 0;
  if (results.some((r) => !r.ok && r.kind === 'auth')) return 1;
  return 2;
}

/** Pure: operator remediation text for a role whose stored password drifted. */
export function remediation(label: string, user: string): string {
  return (
    `  The stored password for the ${label} role "${user}" does not match .env.production.\n` +
    `  (Postgres only applies a password when it first creates an empty volume, so a later\n` +
    `   change to .env.production leaves the role's stored password stale.)\n` +
    `  Fix ONE of:\n` +
    `    - realign the DB to .env:  ALTER ROLE "${user}" WITH PASSWORD '<value from .env.production>';\n` +
    `    - or correct that value in .env.production to match the database.\n` +
    `  Then re-run this check before deploying.`
  );
}

async function probe(
  host: string,
  port: number,
  database: string,
  role: RoleConn,
): Promise<ProbeResult> {
  const client = new Client({
    host,
    port,
    database,
    user: role.user,
    password: role.password,
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    await client.query('select 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, ...classifyConnError(err) };
  } finally {
    try {
      await client.end();
    } catch {
      /* a connection that never opened has nothing to close */
    }
  }
}

async function main(): Promise<number> {
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = Number(process.env.POSTGRES_PORT ?? 5432);
  const database = process.env.POSTGRES_DB ?? 'rmc';
  const roles: RoleConn[] = [
    {
      label: 'owner (migrations)',
      user: process.env.POSTGRES_USER ?? 'rmc',
      password: process.env.POSTGRES_PASSWORD ?? '',
    },
    {
      label: 'app (runtime/RLS)',
      user: process.env.APP_DB_USER ?? 'rmc_app',
      password: process.env.APP_DB_PASSWORD ?? '',
    },
  ];

  log(`verifying ${roles.length} DB roles can authenticate against ${host}:${port}/${database}`);
  const results: ProbeResult[] = [];
  for (const role of roles) {
    const res = await probe(host, port, database, role);
    if (res.ok) {
      log(`ok    ${role.label} — "${role.user}" authenticated`);
    } else if (res.kind === 'auth') {
      log(`FAIL  ${role.label} — "${role.user}": ${res.detail}`);
      console.log(remediation(role.label, role.user));
    } else {
      log(`ERROR ${role.label} — "${role.user}": ${res.detail} (could not verify)`);
    }
    results.push(res);
  }

  const code = overallExitCode(results);
  if (code === 0) log('PASS — every DB role can authenticate. Safe to proceed.');
  else if (code === 1) log('FAIL — a role password does not match the database (fix above), THEN deploy.');
  else log('could not complete — treat as NOT safe to deploy until resolved.');
  return code;
}

// Only run when invoked as the entry point (not when imported by the unit test).
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      // Fail closed: if the check itself could not run, do not green-light a deploy.
      console.error('[db-auth] ERROR — check could not run:', err instanceof Error ? err.message : err);
      process.exit(2);
    });
}
