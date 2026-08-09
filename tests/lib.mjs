/**
 * Shared helpers for the RMC Phase-1 hardening / UAT test suite.
 * Runs against a live API (default http://localhost:4000) with the seeded
 * demo tenants. Tokens are cached per-user so the whole run stays under the
 * login rate limit.
 */
export const BASE = process.env.RMC_BASE ?? 'http://localhost:4000';
// Matches the demo seed password (apps/api/src/core/database/seed.ts) and
// satisfies the shared password policy, so makeScopedUser can create users
// through POST /users without a validation error.
export const PASSWORD = 'Concrete#2026';

const tokenCache = new Map();

export async function raw(method, path, { token, body } = {}) {
  const bodyless = method === 'GET' || method === 'HEAD';
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body && !bodyless ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  // Parse a CLONE so the caller can still read res.text()/res.arrayBuffer() (PDF/CSV).
  try { json = await res.clone().json(); } catch { /* non-JSON (e.g. PDF/CSV) */ }
  return { status: res.status, ok: res.ok, json, res };
}

export async function api(method, path, { token, body } = {}) {
  const r = await raw(method, path, { token, body });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json?.data;
}

export async function login(who) {
  if (tokenCache.has(who)) return tokenCache.get(who);
  const d = await api('POST', '/auth/login', { body: { login: who, password: PASSWORD } });
  tokenCache.set(who, d.access_token);
  return d.access_token;
}

/** Create (idempotently) a tenant user with an exact permission set; return its token. */
export async function makeScopedUser(adminToken, { roleKey, roleName, permissions, email }) {
  const role = await api('POST', '/roles', { token: adminToken, body: { roleKey, roleName } });
  const catalog = await api('GET', '/roles/permissions-catalog', { token: adminToken });
  const ids = catalog.filter((p) => permissions.includes(String(p.permissionKey))).map((p) => String(p.id));
  await api('PUT', `/roles/${role.id}/permissions`, { token: adminToken, body: { permissionIds: ids } });
  await api('POST', '/users', { token: adminToken, body: { name: roleName, email, password: PASSWORD, roleId: role.id } });
  const d = await api('POST', '/auth/login', { body: { login: email, password: PASSWORD } });
  return d.access_token;
}

/** A tiny assertion recorder. */
export function suite(name) {
  const results = [];
  const ok = (label, cond, extra = '') => {
    results.push({ label, pass: !!cond, extra });
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    return !!cond;
  };
  const done = () => ({ name, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results });
  return { ok, done };
}
