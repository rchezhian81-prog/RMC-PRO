/**
 * Integration test for refresh-token rotation / session revocation (Wave 1).
 *
 * Proves that bumping a user's token_version (which change-password does) revokes
 * every refresh token issued before it — closing the gap where a leaked refresh
 * token stayed valid for its full lifetime with no way to revoke it.
 *
 * NOTE: this test changes the fixture owner's password, so run-integration.mjs
 * schedules it LAST — nothing after it depends on the old password, and the DB is
 * thrown away at the end of the run.
 *
 * Env (from the orchestrator): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) throw new Error('FAIL: ' + name);
  pass++;
};
const j = async (m, p, b, t) => {
  const r = await fetch(`${API_BASE}${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping refresh-rotation — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== refresh-token rotation / revocation ===');
const NEW_PW = 'Rotated#2026Key';

// 1. Login mints an access + refresh token.
const login1 = await j('POST', '/auth/login', { login: LOGIN, password: PASSWORD });
ok('login succeeds and returns access + refresh tokens',
  login1.status === 200 && !!login1.body?.data?.access_token && !!login1.body?.data?.refresh_token);
const refreshBefore = login1.body.data.refresh_token;

// 2. A valid refresh token can be exchanged for new tokens.
const r1 = await j('POST', '/auth/refresh', { refresh_token: refreshBefore });
ok('a valid refresh token is accepted (2xx)', r1.status >= 200 && r1.status < 300 && !!r1.body?.data?.access_token);
const accessForChange = r1.body.data.access_token;
const refreshFromStep2 = r1.body.data.refresh_token;

// 3. Change the password — bumps token_version, revoking earlier refresh tokens.
const cp = await j('POST', '/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PW }, accessForChange);
ok('change-password succeeds', cp.status >= 200 && cp.status < 300);

// 4. Every refresh token issued before the change is now rejected.
const r2 = await j('POST', '/auth/refresh', { refresh_token: refreshBefore });
ok('the original refresh token is revoked after the change (401)', r2.status === 401);
ok('revocation reports SESSION_REVOKED', r2.body?.error?.code === 'SESSION_REVOKED');
const r3 = await j('POST', '/auth/refresh', { refresh_token: refreshFromStep2 });
ok('the refresh token minted just before the change is also revoked (401)', r3.status === 401);

// 5. The old password no longer works; the new one mints a fresh, valid session.
const badLogin = await j('POST', '/auth/login', { login: LOGIN, password: PASSWORD });
ok('the old password no longer logs in (401)', badLogin.status === 401);
const goodLogin = await j('POST', '/auth/login', { login: LOGIN, password: NEW_PW });
ok('the new password logs in', goodLogin.status === 200 && !!goodLogin.body?.data?.refresh_token);

// 6. The fresh session refreshes successfully (rotation didn't break the happy path).
const r4 = await j('POST', '/auth/refresh', { refresh_token: goodLogin.body.data.refresh_token });
ok('the fresh session can still refresh', r4.status >= 200 && r4.status < 300 && !!r4.body?.data?.access_token);

console.log(`\nREFRESH ROTATION TEST: ${pass} passed`);
process.exit(0);
