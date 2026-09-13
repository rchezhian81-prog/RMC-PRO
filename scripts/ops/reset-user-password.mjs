#!/usr/bin/env node
/**
 * RMC Plant SaaS — break-glass password reset, run ON the VPS.
 *
 * WHY THIS EXISTS: a Company Admin may reset any staff member's password from
 * Setup → Users, but NOT the Company Owner's. That rule is deliberate and
 * correct — without it, an admin could take the owner's login and with it the
 * whole company's data. It does mean that if the owner forgets their own
 * password and there is no second owner, no one inside the application can let
 * them back in: not another admin, and not the platform super admin, which has
 * no reset route either.
 *
 * This is the way back. It needs SSH access to the server and the database
 * password, which is the second factor: someone who can already run commands on
 * the box could reach the data regardless, so this grants nothing new — it only
 * saves a rebuild.
 *
 * Prefer Setup → Users whenever the account is NOT the owner; that path is
 * audited in the application and needs no shell.
 *
 * WHAT IT DOES
 *   - refuses a password the application itself would refuse (same shared rules)
 *   - writes a bcrypt hash at the same cost the API uses
 *   - bumps token_version, so every existing session and refresh token for that
 *     user is revoked — a reset must not leave an old login working
 *   - prints the email and tenant it changed, never the password
 *
 * USAGE (on the VPS, from the repo root):
 *   read -rs NEW_PASSWORD; export NEW_PASSWORD
 *   EMAIL='owner@example.com' node scripts/ops/reset-user-password.mjs
 *   unset NEW_PASSWORD
 *
 * The password is read from the environment ONLY — never pass it as an
 * argument, because command-line arguments are visible to every user on the box
 * through `ps`.
 *
 * Env: EMAIL (required), NEW_PASSWORD (required), plus the usual POSTGRES_*
 *      (defaults match .env.production). DRY_RUN=1 reports what it would do.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// bcryptjs and pg are the API's dependencies, not this script's — resolve them
// from there so this runs from the repo root on the VPS without its own install.
const fromApi = createRequire(resolve(HERE, '../../apps/api/package.json'));
const load = (name) => {
  for (const r of [fromApi, require]) {
    try { return r(name); } catch { /* try the next resolver */ }
  }
  console.error(`Cannot load "${name}". Run this from the repo root on the VPS, where apps/api has its dependencies installed.`);
  process.exit(2);
};
const bcrypt = load('bcryptjs');
const { Client } = load('pg');

const EMAIL = (process.env.EMAIL ?? '').trim().toLowerCase();
const NEW_PASSWORD = process.env.NEW_PASSWORD ?? '';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!EMAIL || !NEW_PASSWORD) {
  console.error('Set EMAIL and NEW_PASSWORD in the environment.');
  console.error('  read -rs NEW_PASSWORD; export NEW_PASSWORD');
  console.error("  EMAIL='owner@example.com' node scripts/ops/reset-user-password.mjs");
  process.exit(2);
}

// The application's own password rules, so this cannot set something the login
// screen would later refuse to let anyone choose.
let problems = [];
try {
  ({ passwordProblems: problems } = require(resolve(HERE, '../../packages/shared/dist/index.js')));
  problems = problems(NEW_PASSWORD);
} catch {
  // Shared package not built on this box — fall back to the same minimum.
  problems = [];
  if (NEW_PASSWORD.length < 12) problems.push('at least 12 characters');
  if (!/[a-z]/.test(NEW_PASSWORD)) problems.push('a lower-case letter');
  if (!/[A-Z]/.test(NEW_PASSWORD)) problems.push('an upper-case letter');
  if (!/\d/.test(NEW_PASSWORD)) problems.push('a digit');
}
if (problems.length) {
  console.error('That password will not be accepted. It needs: ' + problems.join(', ') + '.');
  process.exit(2);
}

const client = new Client({
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? '',
  database: process.env.POSTGRES_DB ?? 'rmc',
});

await client.connect().catch((e) => {
  console.error(`Could not reach the database: ${e.message}`);
  console.error('Run this from the repo root on the VPS, with the POSTGRES_* values from .env.production.');
  process.exit(2);
});

const { rows } = await client.query(
  `SELECT u.id, u.email, u.name, u.status, u.token_version, t.tenant_name, t.tenant_code
     FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE lower(u.email) = $1`,
  [EMAIL],
);

if (!rows.length) {
  console.error(`No user with the email ${EMAIL}.`);
  await client.end();
  process.exit(1);
}
if (rows.length > 1) {
  console.error(`${rows.length} users share that email — refusing to guess which one you meant.`);
  await client.end();
  process.exit(1);
}

const u = rows[0];
console.log(`User    : ${u.name ?? '(no name)'} <${u.email}>`);
console.log(`Company : ${u.tenant_name ?? '(platform user)'}${u.tenant_code ? ` (${u.tenant_code})` : ''}`);
console.log(`Status  : ${u.status}`);
if (u.status !== 'active') {
  console.log('\nNote: this account is not active, so a new password alone will not let them in.');
  console.log('Re-activate it from Setup → Users once you can sign in.');
}

if (DRY_RUN) {
  console.log('\nDRY_RUN=1 — nothing was changed.');
  await client.end();
  process.exit(0);
}

const hash = await bcrypt.hash(NEW_PASSWORD, 10);
await client.query(
  `UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1, updated_at = now() WHERE id = $2`,
  [hash, u.id],
);
await client.end();

console.log('\nPassword reset. Every existing session for this account has been signed out.');
console.log('Sign in with the new password, then change it from Account → Password.');
