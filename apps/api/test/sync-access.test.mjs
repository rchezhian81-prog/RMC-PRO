/**
 * Offline-sync access control (gap-scan items O1, O5).
 *
 * O1 — every /sync route now requires `sync.manage`. Bootstrap and pull carry
 *      the whole customer master, confirmed orders and approved mix designs,
 *      and the device/conflict lists expose the fleet; PermissionsGuard allows
 *      a route that declares nothing, so these were readable by ANY
 *      authenticated user of a tenant with offline sync on — including roles
 *      deliberately without customers.view.
 * O5 — `device.status` was written at registration and never read: a lost or
 *      decommissioned device kept syncing and could not be revoked. It is now
 *      checked on every device-plane call, revocation is an endpoint, and
 *      re-registering the identifier cannot silently un-revoke it.
 *
 * Runs in its OWN tenant (its own plan and users), so the pilot fixtures and
 * their plan seats are untouched.
 *
 * Env: API_BASE, SUPERADMIN_EMAIL/PASSWORD, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const SU_EMAIL = process.env.SUPERADMIN_EMAIL;
const SU_PW = process.env.SUPERADMIN_PASSWORD;
if (!SU_EMAIL || !SU_PW) { console.error('SUPERADMIN_EMAIL/PASSWORD required'); process.exit(1); }

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, code: json?.error?.code ?? '', msg: json?.error?.message ?? json?.message ?? '' };
}
const login = async (email, password) => (await call('POST', '/auth/login', { login: email, password })).data?.access_token;

const tag = Date.now().toString(36);
const SU = await login(SU_EMAIL, SU_PW);
if (!SU) { console.error('superadmin login failed'); process.exit(1); }

// ── own tenant, own plan, own users ──────────────────────────────────────────
const plan = await call('POST', '/platform/plans', { planCode: `SAP-${tag}`, planName: `Sync Access ${tag}`, maxUsers: 5 }, SU);
const tenant = await call('POST', '/platform/tenants', { tenantCode: `SA${tag}`.toUpperCase().slice(0, 12), tenantName: `Sync Access Co ${tag}`, planId: plan.data?.id }, SU);
ok(tenant.ok, `own tenant created (${tenant.status} ${tenant.msg})`);
const T = tenant.data?.id;
const mod = await call('PUT', `/platform/tenants/${T}/modules/offline_sync`, { isEnabled: true }, SU);
ok(mod.ok, 'offline_sync enabled for it');
const OWNER = `owner-${tag}@syncaccess.test`;
const PW = 'Owner#12345x';
ok((await call('POST', `/platform/tenants/${T}/users`, { name: 'Sync Owner', email: OWNER, password: PW }, SU)).ok, 'owner provisioned');
const ot = await login(OWNER, PW);
ok(!!ot, 'owner can log in');

const roles = await call('GET', '/roles', undefined, ot);
const staffRole = (roles.data ?? []).find((r) => r.roleKey === 'batching_operator')
  ?? (roles.data ?? []).find((r) => !['company_owner', 'company_admin'].includes(String(r.roleKey)));
ok(!!staffRole, `a non-owner role exists to test with (${staffRole?.roleKey})`);
const STAFF = `staff-${tag}@syncaccess.test`;
const mk = await call('POST', '/users', { name: 'Plant Operator', email: STAFF, password: PW, roleId: staffRole.id }, ot);
ok(mk.ok, `staff user created (${mk.status} ${mk.msg})`);
const st = await login(STAFF, PW);
ok(!!st, 'staff can log in');

const dev = await call('POST', '/sync/devices/register', { deviceIdentifier: `SA-${tag}`, deviceName: `Access Device ${tag}` }, ot);
ok(dev.ok, `owner registered a device (${dev.status} ${dev.msg})`);
const D = dev.data?.id;

// ───────────────────── O1 — every /sync route needs sync.manage ─────────────────────
console.log('\n[O1] a role without sync.manage is refused on every sync route');
{
  ok(!(staffRole.permissions ?? []).includes?.('sync.manage'), 'sanity: the staff role does not hold sync.manage');
  const probes = [
    ['GET', `/sync/bootstrap?deviceId=${D}`, undefined],
    ['GET', `/sync/pull?deviceId=${D}`, undefined],
    ['GET', '/sync/devices', undefined],
    ['GET', '/sync/conflicts', undefined],
    ['GET', '/sync/number-reservations', undefined],
    ['POST', '/sync/number-reservations', { documentType: 'delivery_challan', count: 1 }],
    ['POST', '/sync/push', { deviceId: D, records: [] }],
    ['POST', '/sync/devices/register', { deviceIdentifier: `SA2-${tag}`, deviceName: 'sneaky' }],
    ['POST', `/sync/devices/${D}/deactivate`, {}],
  ];
  for (const [method, path, body] of probes) {
    const r = await call(method, path, body, st);
    ok(r.status === 403 && r.code === 'PERMISSION_DENIED', `${method} ${path.split('?')[0]} → 403 (${r.status} ${r.code})`);
  }
  const boot = await call('GET', `/sync/bootstrap?deviceId=${D}`, undefined, st);
  ok(boot.data === undefined, 'the refused bootstrap returns no customer/mix-design payload');
  // The staff token itself is valid — the refusals above are the sync permission
  // gate, not a broken login. (/dashboard/summary is deliberately un-gated: it
  // is the screen every user lands on, so it is the honest control here. The
  // module-gated screens are out of this tenant's plan and would 403 for a
  // different reason.)
  const home = await call('GET', '/dashboard/summary', undefined, st);
  ok(home.ok, `the same token still reads its own front door (/dashboard/summary ${home.status})`);
}

console.log('\n[O1] the owner (sync.manage) still has the whole device plane');
{
  const boot = await call('GET', `/sync/bootstrap?deviceId=${D}`, undefined, ot);
  ok(boot.ok && Array.isArray(boot.data?.reference?.customers), `bootstrap works for the owner (${boot.status})`);
  const pull = await call('GET', `/sync/pull?deviceId=${D}`, undefined, ot);
  ok(pull.ok && !!pull.data?.syncToken, `pull works for the owner (${pull.status})`);
  for (const p of ['/sync/devices', '/sync/conflicts', '/sync/number-reservations']) {
    const r = await call('GET', p, undefined, ot);
    ok(r.ok, `${p} works for the owner (${r.status})`);
  }
}

// ───────────────────── O5 — a revoked device cannot sync ─────────────────────
console.log('\n[O5] revoking a device stops its sync and cannot be undone by re-registering');
{
  const off = await call('POST', `/sync/devices/${D}/deactivate`, {}, ot);
  ok(off.ok && off.data?.status === 'inactive', `device revoked (${off.status} ${off.data?.status})`);
  const refusals = [
    ['GET', `/sync/bootstrap?deviceId=${D}`, undefined],
    ['GET', `/sync/pull?deviceId=${D}`, undefined],
    ['POST', '/sync/push', { deviceId: D, records: [] }],
    ['POST', '/sync/number-reservations', { deviceId: D, documentType: 'delivery_challan', count: 1 }],
  ];
  for (const [method, path, body] of refusals) {
    const r = await call(method, path, body, ot);
    ok(r.status === 400 && /inactive/i.test(r.msg), `${method} ${path.split('?')[0]} refused while revoked (${r.status}: ${r.msg})`);
  }
  const reReg = await call('POST', '/sync/devices/register', { deviceIdentifier: `SA-${tag}`, deviceName: `Access Device ${tag}` }, ot);
  ok(reReg.status === 400 && /reactivate/i.test(reReg.msg), `re-registering the identifier does NOT un-revoke it (${reReg.status}: ${reReg.msg})`);
  const listed = await call('GET', '/sync/devices', undefined, ot);
  ok((listed.data ?? []).find((d) => d.id === D)?.status === 'inactive', 'it is still listed, as inactive');
  const on = await call('POST', `/sync/devices/${D}/reactivate`, {}, ot);
  ok(on.ok && on.data?.status === 'active', `reactivation restores it (${on.status} ${on.data?.status})`);
  const boot = await call('GET', `/sync/bootstrap?deviceId=${D}`, undefined, ot);
  ok(boot.ok, `and it can bootstrap again (${boot.status})`);
  const gone = await call('GET', `/sync/pull?deviceId=${randomUUID()}`, undefined, ot);
  ok(gone.status === 404, `pull with an unknown device is a 404, not a silent success (${gone.status})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
