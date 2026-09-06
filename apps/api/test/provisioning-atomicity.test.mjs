/**
 * Provisioning + user-management atomicity (data-integrity items I23, I24).
 *
 * I24 — creating a tenant validates the plan before any write and provisions
 *       the tenant row, its module entitlements, roles and company in ONE
 *       transaction; assign-plan moves current_plan_id and the module reset
 *       together; plan-module edits are one transaction with duplicates
 *       collapsed.
 * I23 — creating a user resolves the role, checks the seat and writes user +
 *       role in one transaction under a per-tenant lock (two creates for the
 *       last seat → exactly one); updating a user validates the role before
 *       the password/status write lands.
 *
 * Env: API_BASE, SUPERADMIN_EMAIL/PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const CI_TENANT = process.env.TEST_TENANT_ID;
const SU_EMAIL = process.env.SUPERADMIN_EMAIL;
const SU_PW = process.env.SUPERADMIN_PASSWORD;
if (!CI_TENANT || !SU_EMAIL || !SU_PW) { console.error('TEST_TENANT_ID + SUPERADMIN_* required'); process.exit(1); }

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  database: process.env.POSTGRES_DB ?? 'rmc',
});
await owner.initialize();
const q = (sql, params) => owner.query(sql, params);
const one = async (sql, params) => (await owner.query(sql, params))[0];
const count = async (sql, params) => Number((await one(sql, params))?.n ?? -1);

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
  return { status: res.status, ok: res.ok, data: json?.data, code: json?.error?.code ?? json?.code ?? '', msg: json?.error?.message ?? json?.message ?? '' };
}
async function login(email, password) {
  const r = await call('POST', '/auth/login', { login: email, password });
  return r.data?.access_token;
}
const tag = Date.now().toString(36);
const SU = await login(SU_EMAIL, SU_PW);
if (!SU) { console.error('superadmin login failed'); process.exit(1); }
const su = (method, path, body) => call(method, path, body, SU);

// ───────────────────────── I24 — tenant provisioning ─────────────────────────
console.log('\n[I24] tenant creation: plan validated first, everything in one transaction');
const CODE = `AT-${tag}`.toUpperCase();
{
  const bad = await su('POST', '/platform/tenants', { tenantCode: CODE, tenantName: `Atomic Co ${tag}`, planId: randomUUID() });
  ok(bad.status === 404, `unknown planId is a 404 (${bad.status})`);
  ok((await count(`SELECT count(*)::int AS n FROM tenants WHERE tenant_code = $1`, [CODE])) === 0, 'no orphan tenant row was committed');
}

console.log('\n[I24] plan modules: duplicates collapse, a bad edit leaves the previous set');
const plan = await su('POST', '/platform/plans', { planCode: `ATP-${tag}`, planName: `Atomic Plan ${tag}`, maxUsers: 2 });
ok(plan.ok, `throwaway plan created with 2 seats (${plan.status} ${plan.msg})`);
const PLAN = plan.data?.id;
{
  const dup = await su('PUT', `/platform/plans/${PLAN}/modules`, { moduleKeys: ['qc', 'qc', 'fleet'] });
  ok(dup.ok, `['qc','qc','fleet'] accepted (${dup.status} ${dup.msg})`);
  ok((await count(`SELECT count(*)::int AS n FROM plan_modules WHERE plan_id = $1`, [PLAN])) === 2, 'plan holds 2 module rows (duplicate collapsed)');
  const badEdit = await su('PUT', `/platform/plans/${PLAN}/modules`, { moduleKeys: ['qc', 'no_such_module'] });
  ok(badEdit.status === 400, `unknown module key is a 400 (${badEdit.status})`);
  ok((await count(`SELECT count(*)::int AS n FROM plan_modules WHERE plan_id = $1`, [PLAN])) === 2, 'the previous set is still in place');
}

console.log('\n[I24] tenant on that plan: modules, roles and company all exist');
const created = await su('POST', '/platform/tenants', { tenantCode: CODE, tenantName: `Atomic Co ${tag}`, planId: PLAN });
ok(created.ok, `tenant created (${created.status} ${created.msg})`);
const T = created.data?.id;
{
  const t = await one(`SELECT current_plan_id, status FROM tenants WHERE id = $1`, [T]);
  ok(t?.current_plan_id === PLAN && t?.status === 'active', 'tenant row carries the plan and is active');
  const mods = await q(`SELECT module_key FROM tenant_modules WHERE tenant_id = $1 AND is_enabled ORDER BY module_key`, [T]);
  ok(mods.map((r) => r.module_key).join(',') === 'fleet,qc', `entitlements are exactly the plan's modules (${mods.map((r) => r.module_key).join(',')})`);
  ok((await count(`SELECT count(*)::int AS n FROM roles WHERE tenant_id = $1`, [T])) >= 2, 'roles provisioned at creation');
  let companies = -1;
  try { companies = await count(`SELECT count(*)::int AS n FROM companies WHERE tenant_id = $1`, [T]); } catch { companies = await count(`SELECT count(*)::int AS n FROM company WHERE tenant_id = $1`, [T]); }
  ok(companies === 1, `company profile row provisioned (${companies})`);
  const again = await su('POST', '/platform/tenants', { tenantCode: CODE, tenantName: 'dup', planId: PLAN });
  ok(again.status === 400 || again.status === 409, `same code again is refused (${again.status})`);
}

// ───────────────────────── I23 — users ─────────────────────────
console.log('\n[I23] user create: role resolved and seat checked inside the transaction');
const ownerEmail = `owner-${tag}@atomic.test`;
const OWNER_PW = 'Owner#12345x';
const ownerUser = await su('POST', `/platform/tenants/${T}/users`, { name: 'Atomic Owner', email: ownerEmail, password: OWNER_PW });
ok(ownerUser.ok, `first login provisioned (${ownerUser.status} ${ownerUser.msg})`);
const OT = await login(ownerEmail, OWNER_PW);
ok(!!OT, 'the new owner can log in');
const ot = (method, path, body) => call(method, path, body, OT);
const roles = await ot('GET', '/roles');
const staffRole = (roles.data ?? []).find((r) => r.roleKey !== 'company_owner') ?? (roles.data ?? [])[0];
ok(!!staffRole?.id, `a non-owner role is available (${staffRole?.roleKey})`);
{
  const email = `ghost-${tag}@atomic.test`;
  const bogus = await ot('POST', '/users', { name: 'Ghost', email, password: 'Ghost#12345x', roleId: randomUUID() });
  ok(bogus.status === 400 && /unknown role/i.test(bogus.msg), `stale roleId is a 400 (${bogus.status}: ${bogus.msg})`);
  ok((await count(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email])) === 0, 'no role-less user row was committed');

  const foreign = await one(`SELECT id FROM roles WHERE tenant_id = $1 LIMIT 1`, [CI_TENANT]);
  const cross = await ot('POST', '/users', { name: 'Cross', email: `cross-${tag}@atomic.test`, password: 'Cross#12345x', roleId: foreign.id });
  ok(cross.status === 400, `another tenant's roleId is a 400, not an FK 500 (${cross.status}: ${cross.msg})`);
  ok((await count(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [`cross-${tag}@atomic.test`])) === 0, 'no cross-tenant user row was committed');
}

console.log('\n[I23] the last seat: two concurrent creates → exactly one');
let seatUserId = null;
{
  const mk = (n) => ot('POST', '/users', { name: `Seat ${n}`, email: `seat${n}-${tag}@atomic.test`, password: 'Seat#12345x', roleId: staffRole.id });
  const [a, b] = await Promise.all([mk(1), mk(2)]);
  const wins = [a, b].filter((r) => r.ok);
  ok(wins.length === 1, `exactly one of two creates wins (${a.status}/${b.status})`);
  ok([a, b].some((r) => r.code === 'PLAN_LIMIT_EXCEEDED'), `the other is PLAN_LIMIT_EXCEEDED (${a.code}/${b.code})`);
  const active = await count(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND status = 'active'`, [T]);
  ok(active === 2, `active users equal the plan's 2 seats (${active})`);
  seatUserId = wins[0]?.data?.id ?? null;
  ok((await count(`SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1`, [seatUserId])) === 1, 'the winner has its role row');
}

console.log('\n[I23] user update: an unknown role rolls back the password change');
{
  const before = await one(`SELECT password_hash FROM users WHERE id = $1`, [seatUserId]);
  const bad = await ot('PATCH', `/users/${seatUserId}`, { password: 'Changed#12345x', roleId: randomUUID() });
  ok(bad.status === 400 && /unknown role/i.test(bad.msg), `unknown role on update is a 400 (${bad.status}: ${bad.msg})`);
  const after = await one(`SELECT password_hash FROM users WHERE id = $1`, [seatUserId]);
  ok(before.password_hash === after.password_hash, 'the password was NOT changed by the failed update');
  const good = await ot('PATCH', `/users/${seatUserId}`, { password: 'Changed#12345x', roleId: staffRole.id });
  ok(good.ok, `a valid update succeeds (${good.status} ${good.msg})`);
  const after2 = await one(`SELECT password_hash FROM users WHERE id = $1`, [seatUserId]);
  ok(before.password_hash !== after2.password_hash, 'the valid update changed the password');
  const relog = await login(`seat1-${tag}@atomic.test`, 'Changed#12345x').catch(() => null) ?? await login(`seat2-${tag}@atomic.test`, 'Changed#12345x');
  ok(!!relog, 'the updated user can log in with the new password');
}

// ───────────────────────── I24 — assign-plan atomicity ─────────────────────────
console.log('\n[I24] assign-plan: plan pointer and module reset move together');
{
  const plans = await su('GET', '/platform/plans');
  const target = (plans.data ?? []).find((p) => p.id !== PLAN);
  ok(!!target, 'another plan exists to move to');
  const targetMods = await count(`SELECT count(*)::int AS n FROM plan_modules WHERE plan_id = $1 AND is_enabled`, [target.id]);
  const bogus = await su('POST', `/platform/tenants/${T}/assign-plan`, { planId: randomUUID() });
  ok(bogus.status === 404, `unknown plan on assign is a 404 (${bogus.status})`);
  const still = await one(`SELECT current_plan_id FROM tenants WHERE id = $1`, [T]);
  ok(still.current_plan_id === PLAN, 'plan pointer untouched by the failed assign');
  const mv = await su('POST', `/platform/tenants/${T}/assign-plan`, { planId: target.id });
  ok(mv.ok, `assign to the other plan succeeds (${mv.status} ${mv.msg})`);
  const now = await one(`SELECT current_plan_id FROM tenants WHERE id = $1`, [T]);
  const tm = await count(`SELECT count(*)::int AS n FROM tenant_modules WHERE tenant_id = $1 AND is_enabled`, [T]);
  ok(now.current_plan_id === target.id && tm === targetMods, `pointer and ${targetMods} module rows moved together (${tm})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
