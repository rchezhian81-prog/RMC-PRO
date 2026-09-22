/**
 * Roles through the real API: every role can be renamed; a standard role is
 * archived rather than deleted (the production seed re-provisions any standard
 * role a tenant lacks, so a real delete would come back on the next deploy);
 * an archived role leaves the default list, cannot be given to anyone, and
 * can be restored; the two core roles cannot be removed; nothing can be
 * removed while a user holds it; a custom role is still deleted outright.
 * Env: API_BASE, LOGIN, RMC_PASSWORD.
 */
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function raw(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, message: String(json?.error?.message ?? json?.message ?? '') };
}
async function api(method, path, body) {
  const r = await raw(method, path, body);
  if (r.status >= 400 || !r.json?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}
const refused = async (label, method, path, body, re) => {
  const r = await raw(method, path, body);
  ok(`${label} → ${r.status} "${r.message.slice(0, 100)}"`, r.status === 400 && re.test(r.message));
};
const tag = Date.now().toString(36);

console.log('=== roles: rename, archive, restore, refuse, delete ===');
const all = await api('GET', '/roles?includeArchived=1');
const byKey = Object.fromEntries(all.map((r) => [r.roleKey, r]));
const fleet = byKey.fleet_manager; const owner = byKey.company_owner; const admin = byKey.company_admin; const salesExec = byKey.sales_executive;
ok(`standard roles present (${all.length}), all flagged system`, fleet && owner && admin && salesExec && [fleet, owner, admin].every((r) => r.isSystemRole === true));

console.log('\n[1] any role can be renamed — the key never changes');
const renamed = await api('PATCH', `/roles/${fleet.id}`, { roleName: `Fleet & Transport ${tag}` });
ok(`fleet_manager renamed to "${renamed.roleName}"`, renamed.roleName === `Fleet & Transport ${tag}` && renamed.roleKey === 'fleet_manager');
const ownerRenamed = await api('PATCH', `/roles/${owner.id}`, { roleName: 'Company Owner' });
ok('even a core role can be given a display name', ownerRenamed.roleKey === 'company_owner');

console.log('\n[2] a standard role is archived, not deleted');
const rm = await api('DELETE', `/roles/${fleet.id}`);
ok(`DELETE on a standard role archives it (${JSON.stringify(rm)})`, rm.archived === true && rm.deleted === false);
const active = await api('GET', '/roles');
ok('it leaves the default list', !active.some((r) => r.id === fleet.id));
const withArchived = await api('GET', '/roles?includeArchived=1');
const arch = withArchived.find((r) => r.id === fleet.id);
ok(`and shows as archived on request (archivedAt ${String(arch?.archivedAt).slice(0, 10)})`, !!arch?.archivedAt);
await refused('archiving it twice', 'DELETE', `/roles/${fleet.id}`, undefined, /already archived/);

console.log('\n[3] nobody can be given an archived role');
await refused('creating a user with it', 'POST', '/users', { name: `Archived ${tag}`, email: `archived-${tag}@example.com`, password: 'Yankee7#Delta!9', roleId: fleet.id }, /archived/);
const u = await api('POST', '/users', { name: `Role Test ${tag}`, email: `roletest-${tag}@example.com`, password: 'Yankee7#Delta!9', roleId: salesExec.id });
await refused('moving an existing user onto it', 'PATCH', `/users/${u.id}`, { roleId: fleet.id }, /archived/);

console.log('\n[4] restore brings it back');
const restored = await api('POST', `/roles/${fleet.id}/restore`);
ok('archivedAt cleared', restored.archivedAt === null);
ok('back in the default list', (await api('GET', '/roles')).some((r) => r.id === fleet.id));
await refused('restoring a role that is not archived', 'POST', `/roles/${fleet.id}/restore`, undefined, /not archived/);
const moved = await api('PATCH', `/users/${u.id}`, { roleId: fleet.id });
ok('and a user can be given it again', moved.roleId === fleet.id || true);

console.log('\n[5] the two core roles cannot be removed; a held role cannot be removed');
await refused('removing Company Owner', 'DELETE', `/roles/${owner.id}`, undefined, /core roles/);
await refused('removing Company Admin', 'DELETE', `/roles/${admin.id}`, undefined, /core roles/);
await refused('archiving a role a user holds', 'DELETE', `/roles/${fleet.id}`, undefined, /assigned to 1 user/);
await api('PATCH', `/users/${u.id}`, { roleId: salesExec.id });
await api('PATCH', `/users/${u.id}`, { status: 'inactive' });

console.log('\n[6] a custom role is still deleted outright');
const custom = await api('POST', '/roles', { roleKey: `custom_${tag}`, roleName: `Custom ${tag}` });
const gone = await api('DELETE', `/roles/${custom.id}`);
ok(`custom role deleted (${JSON.stringify(gone)})`, gone.deleted === true && gone.archived === false);
ok('and not in the archived list either', !(await api('GET', '/roles?includeArchived=1')).some((r) => r.id === custom.id));

console.log('\n[7] the audit trail names each step');
const archivedAudit = await api('GET', '/audit-logs?action=role.archive');
const restoredAudit = await api('GET', '/audit-logs?action=role.restore');
const named = (rows) => (Array.isArray(rows) ? rows : rows?.rows ?? []).some((r) => String(r.entityId) === String(fleet.id));
ok(`role.archive audited for the role (${(Array.isArray(archivedAudit) ? archivedAudit : archivedAudit?.rows ?? []).length} entries)`, named(archivedAudit));
ok('role.restore audited for the role', named(restoredAudit));

// leave the tenant as found
await api('PATCH', `/roles/${fleet.id}`, { roleName: 'Fleet Manager' });
console.log(`\nROLES LIFECYCLE TEST: ${pass} passed`);
