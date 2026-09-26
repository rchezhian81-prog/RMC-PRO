/**
 * The sign-in family end to end: forgot-password answers the same for any
 * address and never errors; a bad reset token is refused; a password an
 * administrator typed is flagged for change at the first sign-in and the
 * flag clears once the person changes it; support can reset a company login's
 * password and switch it off, and a deactivated login is told so plainly.
 *
 * Env (from run-integration.mjs childEnv): API_BASE, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const SU_LOGIN = process.env.SUPERADMIN_EMAIL;
const SU_PASSWORD = process.env.SUPERADMIN_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

let TOKEN = '';
async function raw(method, path, body, token = TOKEN) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function api(method, path, body, token) {
  const r = await raw(method, path, body, token);
  if (r.status >= 400 || !r.body?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

if (!SU_LOGIN || !SU_PASSWORD) {
  console.log('(skipping password-reset — SUPERADMIN creds not set)');
  process.exit(0);
}

console.log('=== password reset, first-sign-in change, support levers ===');

// ---- public: forgot-password never says whether the login exists ----
const unknown = await raw('POST', '/auth/forgot-password', { login: 'nobody.at.all@ci.test' }, '');
ok('forgot-password for an unknown email answers 200', unknown.status === 200 && unknown.body?.data?.ok === true);
ok('the answer names the channel (email or none)', ['email', 'none'].includes(unknown.body?.data?.channel));
const known = await raw('POST', '/auth/forgot-password', { login: SU_LOGIN }, '');
ok('forgot-password for a real login answers exactly the same shape', known.status === 200 && known.body?.data?.channel === unknown.body?.data?.channel);
const empty = await raw('POST', '/auth/forgot-password', {}, '');
ok('forgot-password without a login is a 400', empty.status === 400);

// ---- public: a reset token that is not the one issued is refused ----
const junk = await raw('POST', '/auth/reset-password', { token: 'abc', newPassword: 'Kovai#Plant2026' }, '');
ok('a malformed token is refused (400)', junk.status === 400 && junk.body?.error?.code === 'RESET_LINK_INVALID');
const unissued = await raw('POST', '/auth/reset-password', { token: 'a'.repeat(64), newPassword: 'Kovai#Plant2026' }, '');
ok('a well-formed token that was never issued is refused (400)', unissued.status === 400 && unissued.body?.error?.code === 'RESET_LINK_INVALID');

// ---- support: a login the super admin typed must be changed at first sign-in ----
const SFX = Date.now().toString(36).slice(-6).toLowerCase();
TOKEN = (await api('POST', '/auth/login', { login: SU_LOGIN, password: SU_PASSWORD })).access_token;
const tenant = await api('POST', '/platform/tenants', { tenantCode: `pwreset${SFX}`, tenantName: `Reset Co ${SFX}` });
const OWNER_EMAIL = `reset.owner.${SFX}@ci.test`;
const FIRST_PW = 'FirstTyped#12345';
const owner = await api('POST', `/platform/tenants/${tenant.id}/users`, { name: 'Reset Owner', email: OWNER_EMAIL, password: FIRST_PW });
const listed = (await api('GET', `/platform/tenants/${tenant.id}/users`)).find((u) => u.id === owner.id);
ok('the platform lists the login with its role and the first-sign-in flag', listed?.roleKey === 'company_owner' && listed?.mustChangePassword === true);

const first = await api('POST', '/auth/login', { login: OWNER_EMAIL, password: FIRST_PW }, '');
ok('signing in with the typed password says a change is required', first.mustChangePassword === true);
const OWN_PW = 'MyOwnChoice#2026';
await api('POST', '/auth/change-password', { currentPassword: FIRST_PW, newPassword: OWN_PW }, first.access_token);
const second = await api('POST', '/auth/login', { login: OWNER_EMAIL, password: OWN_PW }, '');
ok('after choosing their own password the flag is clear', second.mustChangePassword === false);
const me = await api('GET', '/auth/me', undefined, second.access_token);
ok('/auth/me carries the flag too', me.mustChangePassword === false);

// ---- support: a new password from the platform, then the login switched off ----
const SUPPORT_PW = 'SupportSet#2026';
const reset = await api('PATCH', `/platform/tenants/${tenant.id}/users/${owner.id}`, { password: SUPPORT_PW });
ok('support reset the password and the flag is set again', reset?.mustChangePassword === true);
const old = await raw('POST', '/auth/login', { login: OWNER_EMAIL, password: OWN_PW }, '');
ok('the old password no longer signs in', old.status === 401);
const third = await api('POST', '/auth/login', { login: OWNER_EMAIL, password: SUPPORT_PW }, '');
ok('the support-set password signs in and asks for a change', third.mustChangePassword === true);
const weak = await raw('PATCH', `/platform/tenants/${tenant.id}/users/${owner.id}`, { password: 'password1' });
ok('support cannot set a password the rule refuses', weak.status === 400);

const off = await api('PATCH', `/platform/tenants/${tenant.id}/users/${owner.id}`, { status: 'inactive' });
ok('support deactivated the login', off?.status === 'inactive');
const blocked = await raw('POST', '/auth/login', { login: OWNER_EMAIL, password: SUPPORT_PW }, '');
ok('a deactivated login is told so, not "invalid credentials"', blocked.status === 401 && blocked.body?.error?.code === 'USER_INACTIVE');
const wrong = await raw('POST', '/auth/login', { login: OWNER_EMAIL, password: 'NotThePassword#1' }, '');
ok('a wrong password on a deactivated login still reads as invalid credentials', wrong.status === 401 && wrong.body?.error?.code !== 'USER_INACTIVE');
const on = await api('PATCH', `/platform/tenants/${tenant.id}/users/${owner.id}`, { status: 'active' });
ok('support reactivated the login', on?.status === 'active');
const back = await raw('POST', '/auth/login', { login: OWNER_EMAIL, password: SUPPORT_PW }, '');
ok('the reactivated login signs in again', back.status === 200);

const trail = await api('GET', '/audit-logs', undefined, back.body.data.access_token);
ok('the password reset by support is in the company trail', trail.some((e) => e.action === 'user.password_reset'));
ok('the deactivation by support is in the company trail', trail.some((e) => e.action === 'user.deactivate'));

console.log(`\nPASSWORD RESET TEST: ${pass} passed`);
process.exit(0);
