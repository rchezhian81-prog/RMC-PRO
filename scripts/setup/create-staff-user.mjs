#!/usr/bin/env node
// Mix Nova — create a staff login with the right role, from the command line.
//
// Does what Setup → Users does, without the clicking: resolves the role by name
// or key, creates the user, assigns the role, and tells you how to verify it.
//
// Neither password is ever printed, logged, or written to disk — both are read
// from the environment only. Nothing about them leaves the server.
//
// Usage (on the VPS):
//   read -rs RMC_PASSWORD;  export RMC_PASSWORD      # YOUR owner password
//   read -rs NEW_PASSWORD;  export NEW_PASSWORD      # the staff member's password
//   LOGIN='owner@example.com' \
//   NEW_NAME='Ravi Kumar' NEW_EMAIL='ravi@plant.com' NEW_ROLE='batching_operator' \
//     node scripts/setup/create-staff-user.mjs
//   unset RMC_PASSWORD NEW_PASSWORD
//
// Run each `read -rs` line ON ITS OWN — pasting it with other lines makes the
// shell swallow the next line as the password.
//
// Flags:
//   --list-roles   Show the roles available in this tenant, then exit.
//   --dry-run      Validate everything and show what would happen; create nothing.
//
// Safe to re-run: if the email already exists the user is not duplicated — the
// role is corrected if it differs, otherwise nothing changes.

const API_URL = (process.env.API_URL || 'https://api.mixnovas.com').replace(/\/+$/, '');
const BASE = `${API_URL}/api/v1`;
const LOGIN = process.env.LOGIN || process.env.RMC_LOGIN || '';
const PASSWORD = process.env.RMC_PASSWORD || '';

const NEW_NAME = (process.env.NEW_NAME || '').trim();
const NEW_EMAIL = (process.env.NEW_EMAIL || '').trim().toLowerCase();
const NEW_MOBILE = (process.env.NEW_MOBILE || '').trim();
const NEW_ROLE = (process.env.NEW_ROLE || '').trim();
const NEW_PASSWORD = process.env.NEW_PASSWORD || '';

const args = process.argv.slice(2);
const LIST_ROLES = args.includes('--list-roles');
const DRY = args.includes('--dry-run');

let TOKEN = '';
const log = (...a) => console.log(...a);
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok || (json && typeof json === 'object' && json.success === false)) {
    const err = json && typeof json === 'object' ? (json.error ?? json) : { message: String(json || res.statusText) };
    const detail = err.message ?? err.code ?? JSON.stringify(err);
    throw new Error(`${method} ${path} → HTTP ${res.status} ${Array.isArray(detail) ? detail.join('; ') : detail}`);
  }
  if (json && typeof json === 'object' && json.success === true && 'data' in json) return json.data;
  return json;
}

async function login() {
  if (!LOGIN) die('Set LOGIN=<your owner email>.');
  if (!PASSWORD) die('Set RMC_PASSWORD in the environment (your own password; never printed).');
  let out;
  try { out = await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD }); }
  catch (e) { die(`Login failed for "${LOGIN}". (${e.message})`); }
  TOKEN = out.access_token;
  if (!TOKEN || !out.tenant) die('Login did not return a tenant token — use the company owner login.');
  log(`✓ Signed in as ${out.user?.name || LOGIN} · tenant: ${out.tenant.name} (${out.tenant.code})`);
}

/** A staff password protects live commercial data — refuse the obviously weak. */
function checkPassword(pw) {
  const problems = [];
  if (pw.length < 10) problems.push('at least 10 characters');
  if (!/[a-zA-Z]/.test(pw)) problems.push('a letter');
  if (!/[0-9]/.test(pw)) problems.push('a digit');
  if (/^(password|welcome|admin|demo|test|changeme|123456)/i.test(pw)) {
    problems.push('something less guessable (it starts with a very common word)');
  }
  if (problems.length) {
    die(`The staff password needs ${problems.join(', ')}.\n  Set a stronger one and re-run — nothing was created.`);
  }
}

async function main() {
  log('\nMix Nova — create a staff login');
  log(`API: ${BASE}${DRY ? '   (DRY RUN — nothing will be created)' : ''}\n`);
  await login();

  const roles = await api('GET', '/roles');
  const rows = Array.isArray(roles) ? roles : (roles?.data ?? []);

  if (LIST_ROLES) {
    log('\nRoles available in this tenant:\n');
    for (const r of rows) log(`  ${String(r.roleKey).padEnd(20)} ${r.roleName}`);
    log('\nPass one of the keys (or the name) as NEW_ROLE.');
    return;
  }

  if (!NEW_NAME) die('Set NEW_NAME to the person’s name.');
  if (!NEW_EMAIL) die('Set NEW_EMAIL to the address they will sign in with.');
  if (!NEW_ROLE) die('Set NEW_ROLE. Run with --list-roles to see the options.');
  if (!NEW_PASSWORD) die('Set NEW_PASSWORD in the environment (never printed).');
  checkPassword(NEW_PASSWORD);

  // Accept either the role key or the human-readable name, case-insensitively.
  const want = NEW_ROLE.toLowerCase();
  const role = rows.find(
    (r) => String(r.roleKey).toLowerCase() === want || String(r.roleName).toLowerCase() === want,
  );
  if (!role) {
    die(`No role matches "${NEW_ROLE}".\n  Available: ${rows.map((r) => r.roleKey).join(', ')}`);
  }
  log(`✓ Role resolved: ${role.roleName} (${role.roleKey})`);

  // Idempotent: never create the same person twice.
  const users = await api('GET', '/users');
  const existing = (Array.isArray(users) ? users : []).find(
    (u) => String(u.email ?? '').toLowerCase() === NEW_EMAIL,
  );

  if (existing) {
    if (String(existing.roleId ?? '') === String(role.id)) {
      log(`\n· ${NEW_EMAIL} already exists with the ${role.roleName} role — nothing to do.`);
      return;
    }
    log(`\n· ${NEW_EMAIL} already exists (role: ${existing.roleName ?? 'none'}).`);
    if (DRY) { log(`  ~ would change the role to ${role.roleName}`); return; }
    await api('PATCH', `/users/${existing.id}`, { roleId: role.id });
    log(`  ✓ role changed to ${role.roleName}`);
    log(`\nThey must sign out and back in for the new menu to apply.`);
    return;
  }

  if (DRY) {
    log(`\n~ would create ${NEW_NAME} <${NEW_EMAIL}> as ${role.roleName}`);
    log('Re-run without --dry-run to create.');
    return;
  }

  await api('POST', '/users', {
    name: NEW_NAME,
    email: NEW_EMAIL,
    password: NEW_PASSWORD,
    ...(NEW_MOBILE ? { mobile: NEW_MOBILE } : {}),
    roleId: role.id,
  });

  log(`\n────────────────────────────────────────`);
  log(`✓ Created ${NEW_NAME} <${NEW_EMAIL}> as ${role.roleName}.`);
  log(`\nGive them the password you just set — it was never displayed here.`);
  log(`\nVerify what the server actually allows them:`);
  log(`  read -rs RMC_PASSWORD; export RMC_PASSWORD      # THEIR password`);
  log(`  LOGIN='${NEW_EMAIL}' EXPECT_ROLE=${role.roleKey} bash scripts/ops/verify-role.sh`);
  log(`  unset RMC_PASSWORD`);
}

main().catch((e) => die(e.message));
