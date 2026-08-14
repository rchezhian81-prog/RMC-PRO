/**
 * Super-admin audit hardening (pre-pilot safety fix):
 *
 * Creating a tenant and bootstrapping its first (Owner) login are the two
 * platform mutations that used to leave NO trace — the nearest thing the
 * platform has to support impersonation. These prove both now write an
 * append-only audit event into the target tenant's own trail, that the event
 * records WHO acted / WHAT was created / WHEN, and that the password the
 * super-admin typed never reaches the trail.
 *
 * Verified from the tenant side: the newly-created Owner (who holds
 * `audit_logs.view`) reads their own tenant's log and finds the events the
 * super-admin wrote there.
 *
 * Env (from run-integration.mjs childEnv): API_BASE, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const SU_LOGIN = process.env.SUPERADMIN_EMAIL;
const SU_PASSWORD = process.env.SUPERADMIN_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

let TOKEN = '';
async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}

if (!SU_LOGIN || !SU_PASSWORD) {
  console.log('(skipping platform-audit — SUPERADMIN creds not set)');
  process.exit(0);
}

console.log('=== platform audit: tenant + user creation are recorded ===');

// A unique suffix so the test is safe to re-run against a non-fresh DB too.
const SFX = Date.now().toString(36).slice(-6).toUpperCase();
const TENANT_CODE = `AUDIT${SFX}`;
const OWNER_EMAIL = `audit.owner.${SFX.toLowerCase()}@ci.test`;
const OWNER_PW = 'AuditOwner#12345';

// ---- act as the super admin ----
TOKEN = (await api('POST', '/auth/login', { login: SU_LOGIN, password: SU_PASSWORD })).access_token;

const tenant = await api('POST', '/platform/tenants', { tenantCode: TENANT_CODE, tenantName: `Audit Co ${SFX}` });
ok('super admin created a tenant', !!tenant.id);

const owner = await api('POST', `/platform/tenants/${tenant.id}/users`, {
  name: 'Audit Owner', email: OWNER_EMAIL, password: OWNER_PW,
});
ok('super admin bootstrapped the tenant owner login', !!owner.id);

// ---- read the tenant's trail from the tenant side (the Owner holds audit_logs.view) ----
TOKEN = (await api('POST', '/auth/login', { login: OWNER_EMAIL, password: OWNER_PW })).access_token;
const trail = await api('GET', '/audit-logs');
ok('owner can read the tenant audit trail', Array.isArray(trail));

const createEvt = trail.find((e) => e.action === 'tenant.create');
const userEvt = trail.find((e) => e.action === 'tenant_user.create');

// tenant.create — who / what / when
ok('tenant.create event was written', !!createEvt);
ok('tenant.create names the acting super admin (who)', createEvt.actorEmail === SU_LOGIN);
ok('tenant.create targets this tenant (what)', createEvt.entityType === 'tenant' && createEvt.entityId === tenant.id);
ok('tenant.create carries a timestamp (when)', !!createEvt.at);
ok('tenant.create keeps safe metadata', createEvt.details?.tenantCode === TENANT_CODE);

// tenant_user.create — who / what / when
ok('tenant_user.create event was written', !!userEvt);
ok('tenant_user.create names the acting super admin (who)', userEvt.actorEmail === SU_LOGIN);
ok('tenant_user.create targets the new login (what)', userEvt.entityType === 'user' && userEvt.entityLabel === OWNER_EMAIL);
ok('tenant_user.create carries a timestamp (when)', !!userEvt.at);

// the password must NEVER be in the trail (defence-in-depth: whole trail scanned)
const dump = JSON.stringify(trail);
ok('the owner password never appears anywhere in the trail', !dump.includes(OWNER_PW));
ok('no password/hash field leaked into event details', !/"password(Hash)?"\s*:/i.test(dump));

console.log(`\nPLATFORM AUDIT TEST: ${pass} passed ✓`);
process.exit(0);
