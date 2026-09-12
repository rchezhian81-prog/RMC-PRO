#!/usr/bin/env node
// Mix Nova — provision a new tenant from the command line.
//
// Does what Platform → Tenants does, without the clicking: creates the tenant,
// assigns a plan, creates its first owner user, and enables the modules that
// plan does not turn on by default. `offboard-tenant.sh` already existed; this
// is the other half.
//
// No password is ever printed, logged, or written to disk — both are read from
// the environment only.
//
// Usage (on the VPS):
//   read -rs RMC_PASSWORD;   export RMC_PASSWORD      # YOUR super-admin password
//   read -rs OWNER_PASSWORD; export OWNER_PASSWORD    # the new tenant owner's
//   LOGIN='super@platform.com' \
//   TENANT_CODE='PILOT2' TENANT_NAME='Second Ready Mix' \
//   OWNER_NAME='Owner Name' OWNER_EMAIL='owner@pilot2.com' \
//   PLAN_CODE='pro' MODULES='qc,purchase,weighbridge' \
//     node scripts/setup/provision-tenant.mjs
//   unset RMC_PASSWORD OWNER_PASSWORD
//
// Run each `read -rs` line ON ITS OWN — pasting it with other lines makes the
// shell swallow the next line as the password.
//
// Flags:
//   --list-plans     Show the plans available, then exit.
//   --list-modules   Show the module keys available, then exit.
//   --dry-run        Validate everything and show what would happen; create nothing.
//
// Safe to re-run: an existing tenantCode is reused rather than duplicated, an
// existing owner email is left alone, and enabling an already-enabled module is
// a no-op. Re-running after a partial failure finishes the job.

const API_URL = (process.env.API_URL || 'https://api.mixnovas.com').replace(/\/+$/, '');
const BASE = `${API_URL}/api/v1`;
const LOGIN = process.env.LOGIN || process.env.RMC_LOGIN || '';
const PASSWORD = process.env.RMC_PASSWORD || '';

const TENANT_CODE = (process.env.TENANT_CODE || '').trim().toUpperCase();
const TENANT_NAME = (process.env.TENANT_NAME || '').trim();
const LEGAL_NAME = (process.env.LEGAL_NAME || '').trim();
const OWNER_NAME = (process.env.OWNER_NAME || '').trim();
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const PLAN_CODE = (process.env.PLAN_CODE || '').trim();
const PLAN_ID = (process.env.PLAN_ID || '').trim();
const MODULES = (process.env.MODULES || '').split(',').map((m) => m.trim()).filter(Boolean);

const args = process.argv.slice(2);
const LIST_PLANS = args.includes('--list-plans');
const LIST_MODULES = args.includes('--list-modules');
const DRY = args.includes('--dry-run');

// The list projections return `code`/`name` while the create DTOs take
// `planCode`/`tenantCode` — read through both so a projection change cannot
// silently turn a lookup into "not found" and create a duplicate.
const planCodeOf = (p) => String(p?.planCode ?? p?.code ?? '');
const tenantCodeOf = (t) => String(t?.tenantCode ?? t?.code ?? '');
const emailOf = (u) => String(u?.email ?? '').toLowerCase();

const log = (...a) => console.log(...a);
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

let TOKEN = '';
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? json?.message ?? `${res.status}`;
    throw new Error(`${method} ${path} -> ${res.status} ${msg}`);
  }
  return json?.data ?? json;
}

// ---- sign in as the platform super admin ----
if (!LOGIN) die('LOGIN is required (your super-admin email).');
if (!PASSWORD) die('RMC_PASSWORD is required — set it with: read -rs RMC_PASSWORD; export RMC_PASSWORD');
try {
  TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
} catch (e) {
  die(`could not sign in as ${LOGIN}: ${e.message}`);
}
if (!TOKEN) die('login returned no access token.');

// ---- listings ----
if (LIST_PLANS) {
  const plans = await api('GET', '/platform/plans');
  log('\nPlans:');
  for (const p of plans) log(`  ${planCodeOf(p).padEnd(16)} ${p.planName ?? p.name ?? ''}`);
  process.exit(0);
}
if (LIST_MODULES) {
  const mods = await api('GET', '/platform/modules');
  log('\nModules:');
  for (const m of mods) log(`  ${String(m.key ?? m.moduleKey).padEnd(24)} ${m.name ?? ''}`);
  process.exit(0);
}

// ---- validate ----
if (!TENANT_CODE) die('TENANT_CODE is required (e.g. PILOT2).');
if (!/^[A-Z0-9_-]{2,20}$/.test(TENANT_CODE)) die(`TENANT_CODE "${TENANT_CODE}" must be 2-20 chars of A-Z, 0-9, _ or -.`);
if (!TENANT_NAME) die('TENANT_NAME is required.');
if (!OWNER_NAME) die('OWNER_NAME is required.');
if (!OWNER_EMAIL) die('OWNER_EMAIL is required.');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(OWNER_EMAIL)) die(`OWNER_EMAIL "${OWNER_EMAIL}" is not a valid address.`);
if (!OWNER_PASSWORD) die('OWNER_PASSWORD is required — set it with: read -rs OWNER_PASSWORD; export OWNER_PASSWORD');
if (OWNER_PASSWORD.length < 10) die('OWNER_PASSWORD must be at least 10 characters (the API enforces this).');

// Resolve the plan before creating anything, so a bad plan name fails early
// rather than leaving a tenant with no plan behind.
const plans = await api('GET', '/platform/plans');
let plan = null;
if (PLAN_ID) plan = plans.find((p) => String(p.id) === PLAN_ID);
else if (PLAN_CODE) plan = plans.find((p) => planCodeOf(p).toLowerCase() === PLAN_CODE.toLowerCase());
else plan = plans[0];
if (!plan) {
  die(`no plan matched ${PLAN_ID ? `PLAN_ID=${PLAN_ID}` : `PLAN_CODE=${PLAN_CODE}`}. Run with --list-plans.`);
}

// Reject unknown module keys up front for the same reason.
if (MODULES.length) {
  const known = new Set((await api('GET', '/platform/modules')).map((m) => String(m.key ?? m.moduleKey)));
  const bad = MODULES.filter((m) => !known.has(m));
  if (bad.length) die(`unknown module key(s): ${bad.join(', ')}. Run with --list-modules.`);
}

log(`\nProvisioning tenant on ${API_URL}`);
log(`  code:    ${TENANT_CODE}`);
log(`  name:    ${TENANT_NAME}`);
log(`  plan:    ${plan.planName ?? plan.name} (${planCodeOf(plan)})`);
log(`  owner:   ${OWNER_NAME} <${OWNER_EMAIL}>`);
log(`  modules: ${MODULES.length ? MODULES.join(', ') : '(plan defaults only)'}`);

if (DRY) {
  log('\n--dry-run: nothing was created.');
  process.exit(0);
}

// ---- tenant (idempotent on tenantCode) ----
const existing = (await api('GET', '/platform/tenants')).find(
  (t) => tenantCodeOf(t).toUpperCase() === TENANT_CODE,
);
let tenant;
if (existing) {
  tenant = existing;
  log(`\n• tenant ${TENANT_CODE} already exists — reusing it (id ${tenant.id})`);
} else {
  tenant = await api('POST', '/platform/tenants', {
    tenantCode: TENANT_CODE,
    tenantName: TENANT_NAME,
    ...(LEGAL_NAME ? { legalName: LEGAL_NAME } : {}),
    planId: plan.id,
  });
  log(`\n• tenant created (id ${tenant.id})`);
}

// assign-plan is separate from creation and safe to repeat.
await api('POST', `/platform/tenants/${tenant.id}/assign-plan`, { planId: plan.id });
log(`• plan ${planCodeOf(plan)} assigned`);

// ---- owner user (idempotent on email) ----
const users = await api('GET', `/platform/tenants/${tenant.id}/users`);
if (users.some((u) => emailOf(u) === OWNER_EMAIL)) {
  log(`• owner ${OWNER_EMAIL} already exists — left unchanged`);
} else {
  await api('POST', `/platform/tenants/${tenant.id}/users`, {
    name: OWNER_NAME,
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  log(`• owner ${OWNER_EMAIL} created`);
}

// ---- modules ----
for (const key of MODULES) {
  await api('PUT', `/platform/tenants/${tenant.id}/modules/${key}`, { isEnabled: true });
  log(`• module ${key} enabled`);
}

log(`\n✓ tenant ${TENANT_CODE} is ready.`);
log('\nNext:');
log(`  1. Sign in as ${OWNER_EMAIL} and confirm the tenant loads.`);
log('  2. Prove the tenants cannot see each other:');
log('       node scripts/ops/verify-tenant-isolation.mjs');
