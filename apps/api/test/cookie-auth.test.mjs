/**
 * Integration test for cookie-based auth (Wave 1, dual-mode).
 *
 * Proves the server issues the refresh token as an httpOnly cookie, accepts a
 * refresh from that cookie alone, still accepts a refresh from the body
 * (backward compatible), rejects a refresh with neither, and clears the cookie
 * on logout. Non-destructive (no password change), so it may run any time.
 *
 * Env (from the orchestrator): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const RT = 'rmc_rt';

let pass = 0;
const ok = (name, cond) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) throw new Error('FAIL: ' + name);
  pass++;
};
const call = async (m, p, { body, cookie, token } = {}) => {
  const r = await fetch(`${API_BASE}${p}`, {
    method: m,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  return { status: r.status, body: await r.json().catch(() => null), setCookie };
};
const rtLine = (setCookie) => setCookie.find((c) => c.startsWith(RT + '='));
const rtValue = (setCookie) => {
  const line = rtLine(setCookie);
  return line ? line.split(';')[0].slice(RT.length + 1) : null;
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping cookie-auth — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== cookie-based auth (dual-mode) ===');

// 1. Login sets an httpOnly refresh cookie (and still returns it in the body).
const login = await call('POST', '/auth/login', { body: { login: LOGIN, password: PASSWORD } });
ok('login succeeds', login.status === 200);
ok('login sets an rmc_rt cookie', !!rtLine(login.setCookie));
ok('the refresh cookie is HttpOnly', /httponly/i.test(rtLine(login.setCookie) || ''));
const cookieRt = rtValue(login.setCookie);
const accessToken = login.body?.data?.access_token;
ok('the cookie value matches the body refresh_token', cookieRt === login.body?.data?.refresh_token);

// 2. Refresh works from the cookie alone (no body token) and rotates the cookie.
const viaCookie = await call('POST', '/auth/refresh', { cookie: `${RT}=${cookieRt}` });
ok('refresh works from the cookie alone', viaCookie.status === 200 && !!viaCookie.body?.data?.access_token);
ok('refresh rotates the cookie', !!rtValue(viaCookie.setCookie));

// 3. Backward compatible: refresh from the body still works.
const viaBody = await call('POST', '/auth/refresh', { body: { refresh_token: login.body.data.refresh_token } });
ok('refresh still works from the body (backward compatible)', viaBody.status === 200 && !!viaBody.body?.data?.access_token);

// 4. Neither cookie nor body → rejected.
const neither = await call('POST', '/auth/refresh', {});
ok('refresh with neither cookie nor body is rejected (401)', neither.status === 401);

// 5. Logout clears the cookie.
const logout = await call('POST', '/auth/logout', { token: accessToken });
ok('logout succeeds', logout.status === 200);
ok('logout clears the refresh cookie', /(max-age=0|expires=)/i.test(rtLine(logout.setCookie) || ''));

console.log(`\nCOOKIE AUTH TEST: ${pass} passed`);
process.exit(0);
