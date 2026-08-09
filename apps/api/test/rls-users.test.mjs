/**
 * RLS-on-users end-to-end test (migration 18).
 *
 * Drives the BOOTED API — as the non-superuser app role, exactly like
 * production — to prove that putting `users` and `tenant_modules` under
 * Row-Level Security did not break the identity/admin paths, and that the tenant
 * scoping now holds at the database:
 *
 *   - a platform super-admin (tenant_id NULL) can still log in         (runAsPlatform)
 *   - a tenant user can log in and read /auth/me                        (runAsPlatform)
 *   - a tenant admin's /users lists only their own tenant's users       (runInTenant)
 *   - creating a user works and the plan seat count reflects it         (runInTenant insert + countUsers)
 *   - one tenant never sees another tenant's users through the API      (RLS tenant scope)
 *   - the duplicate-email guard still spans tenants                     (runAsPlatform email check)
 *
 * Fixtures (from run-integration.mjs env): API_BASE, LOGIN, RMC_PASSWORD,
 * TEST_TENANT_ID, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD.
 */
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const SU_EMAIL = process.env.SUPERADMIN_EMAIL ?? 'super@ci.test';
const SU_PW = process.env.SUPERADMIN_PASSWORD ?? 'SuperCI#12345';
const OWNER_LOGIN = process.env.LOGIN;
const OWNER_PW = process.env.RMC_PASSWORD;
const TENANT_ID = process.env.TEST_TENANT_ID;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function api(method, path, body, token) {
  const { status, data } = await req(method, path, body, token);
  if (!data?.success) throw new Error(`${method} ${path} -> ${status} ${JSON.stringify(data)}`);
  return data.data;
}
const login = async (email, pw) => (await api('POST', '/auth/login', { login: email, password: pw })).access_token;

(async () => {
  console.log('=== RLS-on-users: identity paths still work ===');

  // Super-admin has tenant_id NULL: only the platform clause can admit the row.
  const su = await login(SU_EMAIL, SU_PW);
  ok('platform super-admin can log in (tenant_id NULL)', typeof su === 'string' && su.length > 0);

  const owner = await login(OWNER_LOGIN, OWNER_PW);
  ok('tenant owner can log in', typeof owner === 'string' && owner.length > 0);

  const me = await api('GET', '/auth/me', null, owner);
  ok('/auth/me returns the tenant user', me.user?.email === OWNER_LOGIN && me.tenant?.id === TENANT_ID);
  ok('/auth/me carries module entitlements (tenant_modules read)', Array.isArray(me.modules) && me.modules.length > 0);

  console.log('=== tenant user listing is tenant-scoped ===');

  // Baseline seat count from the platform view (plan-limits.countUsers).
  const t0 = await api('GET', `/platform/tenants/${TENANT_ID}`, null, su);
  const seat0 = t0.usage.users.used;
  ok('platform tenant view reports a seat count', Number.isInteger(seat0) && seat0 >= 1);

  const suUsers = await api('GET', `/platform/tenants/${TENANT_ID}/users`, null, su);
  ok('super-admin lists the tenant users (runInTenant target)', suUsers.some((u) => u.email === OWNER_LOGIN));
  ok('super-admin user list size matches the seat count', suUsers.length === seat0);

  const ownerUsers = await api('GET', '/users', null, owner);
  ok('tenant owner /users lists own users', ownerUsers.some((u) => u.email === OWNER_LOGIN));
  ok('tenant owner /users size matches the seat count', ownerUsers.length === seat0);

  // Create a user → seat count and both listings must move by exactly one.
  const newEmail = `rls-new-${randomUUID().slice(0, 8)}@rls.test`;
  await api('POST', '/users', { name: 'RLS New', email: newEmail, password: 'NewUser#12345' }, owner);
  const ownerUsers2 = await api('GET', '/users', null, owner);
  ok('created user appears in the tenant listing', ownerUsers2.some((u) => u.email === newEmail));
  ok('tenant listing grew by exactly one', ownerUsers2.length === seat0 + 1);
  const t1 = await api('GET', `/platform/tenants/${TENANT_ID}`, null, su);
  ok('plan seat count reflects the new user (countUsers via runInTenant)', t1.usage.users.used === seat0 + 1);

  console.log('=== cross-tenant isolation + global email uniqueness ===');

  // A second tenant with its own owner, set up by the super-admin.
  const plans = await api('GET', '/platform/plans', null, su);
  const plan = plans[plans.length - 1];
  const code2 = 'RLS2-' + randomUUID().slice(0, 6).toUpperCase();
  const t2 = await api('POST', '/platform/tenants', { tenantCode: code2, tenantName: 'RLS Second', planId: plan.id }, su);
  const owner2Email = `owner2-${randomUUID().slice(0, 8)}@rls.test`;
  await api('POST', `/platform/tenants/${t2.id}/users`, { name: 'Owner Two', email: owner2Email, password: 'OwnerTwo#12345' }, su);
  const owner2 = await login(owner2Email, 'OwnerTwo#12345');

  const t1Users = await api('GET', '/users', null, owner);
  const t2Users = await api('GET', '/users', null, owner2);
  ok('tenant 1 does NOT see tenant 2 users', !t1Users.some((u) => u.email === owner2Email));
  ok('tenant 2 does NOT see tenant 1 users', !t2Users.some((u) => u.email === OWNER_LOGIN));
  ok('tenant 2 sees only its own single user', t2Users.length === 1 && t2Users[0].email === owner2Email);

  // The duplicate-email check must still span tenants (email is globally unique,
  // login is by email). If it were wrongly tenant-scoped, RLS would hide the
  // clash and the DB unique index would surface an opaque 500 instead of 400.
  const dup = await req('POST', '/users', { name: 'Clash', email: owner2Email, password: 'Clash#123456' }, owner);
  ok('duplicate email across tenants is refused with a clean 400', dup.status === 400 && dup.data?.error?.code === 'DUPLICATE_RECORD');

  console.log(`\nRLS-ON-USERS TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
