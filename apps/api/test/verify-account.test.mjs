/**
 * A read-only account can run the live verification (ops follow-up to O5b).
 *
 * `scripts/ops/verify-app.sh` is a read-only smoke test, but three of its
 * checks read the role list and the permission catalogue, and those routes
 * required `roles.manage` — a permission that also grants the power to CHANGE
 * roles. So the only account that could run a full verification was the owner,
 * and ops kept the owner's password to hand for it (and reset it when that
 * password was lost). Reads now take `roles.view` OR `roles.manage`, and the
 * Auditor role holds `roles.view`.
 *
 * Runs in its OWN tenant with its own plan and users, so the pilot fixtures and
 * their plan seats are untouched.
 *
 * Env: API_BASE, SUPERADMIN_EMAIL/PASSWORD.
 */
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

const plan = await call('POST', '/platform/plans', { planCode: `VAP-${tag}`, planName: `Verify Account ${tag}`, maxUsers: 5 }, SU);
const tenant = await call('POST', '/platform/tenants', { tenantCode: `VA${tag}`.toUpperCase().slice(0, 12), tenantName: `Verify Account Co ${tag}`, planId: plan.data?.id }, SU);
ok(tenant.ok, `own tenant created (${tenant.status} ${tenant.msg})`);
const T = tenant.data?.id;
const OWNER = `owner-${tag}@verifyacct.test`;
const PW = 'Owner#12345x';
ok((await call('POST', `/platform/tenants/${T}/users`, { name: 'Verify Owner', email: OWNER, password: PW }, SU)).ok, 'owner provisioned');
const ot = await login(OWNER, PW);
ok(!!ot, 'owner can log in');

const roles = await call('GET', '/roles', undefined, ot);
const auditor = (roles.data ?? []).find((r) => r.roleKey === 'auditor');
ok(!!auditor, 'the tenant has an Auditor role');
const AUD = `verify-${tag}@verifyacct.test`;
const mk = await call('POST', '/users', { name: 'Verification Account', email: AUD, password: PW, roleId: auditor?.id }, ot);
ok(mk.ok, `auditor user created (${mk.status} ${mk.msg})`);
const at = await login(AUD, PW);
ok(!!at, 'the verification account can log in');

console.log('\n[reads] every authenticated check verify-app.sh makes answers 200');
{
  // The exact routes verify-app.sh hits once it holds a token.
  const probes = [
    ['/dashboard/summary', 'dashboard summary'],
    ['/alerts', 'alerts'],
    ['/stock/balances', 'stock balances'],
    ['/roles', 'role list'],
    ['/roles/permissions-catalog', 'permission catalogue'],
    [`/roles/${auditor?.id}/permissions`, "a role's permissions"],
    ['/auth/me', 'own subscription + modules'],
    ['/plan-usage', 'plan usage'],
    ['/audit-logs?limit=1', 'audit log'],
  ];
  for (const [path, label] of probes) {
    const r = await call('GET', path, undefined, at);
    ok(r.ok, `${label} — ${r.status}${r.ok ? '' : ` ${r.code} ${r.msg}`}`);
  }
}

console.log('\n[writes] reading roles does NOT confer the power to change them');
{
  const create = await call('POST', '/roles', { roleKey: `snoop-${tag}`, roleName: 'Snoop' }, at);
  ok(create.status === 403 && create.code === 'PERMISSION_DENIED', `creating a role is refused (${create.status} ${create.code})`);
  const rename = await call('PATCH', `/roles/${auditor?.id}`, { roleName: 'Renamed' }, at);
  ok(rename.status === 403, `renaming a role is refused (${rename.status})`);
  const grant = await call('PUT', `/roles/${auditor?.id}/permissions`, { permissions: ['roles.manage'] }, at);
  ok(grant.status === 403, `granting itself roles.manage is refused (${grant.status})`);
  const del = await call('DELETE', `/roles/${auditor?.id}`, undefined, at);
  ok(del.status === 403, `deleting a role is refused (${del.status})`);

  // getPermissions returns permission IDS, so resolve them through the
  // catalogue the account can also read.
  const catalog = await call('GET', '/roles/permissions-catalog', undefined, at);
  const keyById = new Map((catalog.data ?? []).map((r) => [r.id, r.permissionKey ?? r.permission_key]));
  const after = await call('GET', `/roles/${auditor?.id}/permissions`, undefined, at);
  const keys = (after.data ?? []).map((id) => keyById.get(id)).filter(Boolean);
  ok(keys.length > 0, `the account can read its own grants (${keys.length} permissions)`);
  ok(!keys.includes('roles.manage'), 'and it still does not hold roles.manage');
  ok(keys.includes('roles.view'), 'only roles.view, which is what let it read');

  // The owner keeps full control — the split must not have narrowed
  // roles.manage. (Auditor is a system role and is rename-protected, so this
  // uses a custom role, which is what roles.manage exists to manage.)
  const custom = await call('POST', '/roles', { roleKey: `custom-${tag}`, roleName: 'Custom Role' }, ot);
  ok(custom.ok, `the owner can still create a role (${custom.status} ${custom.msg})`);
  const ownerRename = await call('PATCH', `/roles/${custom.data?.id}`, { roleName: `Renamed ${tag}` }, ot);
  ok(ownerRename.ok, `and rename it (${ownerRename.status} ${ownerRename.msg})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
