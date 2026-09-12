#!/usr/bin/env node
// Mix Nova — prove two live tenants cannot see each other.
//
// The RLS isolation e2e test runs in CI against synthetic fixtures. This runs
// against the REAL box with REAL tenants, which is the only thing that proves
// the deployed configuration — roles, policies, the app DB user — is actually
// enforcing isolation. It is the reason to stand up a second tenant at all.
//
// READ-ONLY: it issues GETs and nothing else.
// It prints COUNTS AND VERDICTS ONLY — never tenant data, never an id from the
// other tenant's records, so the output is safe to paste into a ticket.
//
// Usage (on the VPS):
//   read -rs PASSWORD_A; export PASSWORD_A
//   read -rs PASSWORD_B; export PASSWORD_B
//   LOGIN_A='owner@pilot1.com' LOGIN_B='owner@pilot2.com' \
//     node scripts/ops/verify-tenant-isolation.mjs
//   unset PASSWORD_A PASSWORD_B
//
// Exits 0 only if every check passes.

const API_URL = (process.env.API_URL || 'https://api.mixnovas.com').replace(/\/+$/, '');
const BASE = `${API_URL}/api/v1`;
const LOGIN_A = (process.env.LOGIN_A || '').trim();
const LOGIN_B = (process.env.LOGIN_B || '').trim();
const PASSWORD_A = process.env.PASSWORD_A || '';
const PASSWORD_B = process.env.PASSWORD_B || '';

// Collections worth checking: each is tenant-scoped and each has a GET /:id.
const COLLECTIONS = [
  { path: '/customers', label: 'customers' },
  { path: '/orders', label: 'orders' },
  { path: '/delivery-challans', label: 'delivery challans' },
  { path: '/invoices', label: 'invoices' },
  { path: '/materials', label: 'materials' },
  { path: '/plants', label: 'plants' },
];

const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };
let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}

async function call(token, method, path) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data: json?.data };
}

async function signIn(login, password, which) {
  if (!login) die(`LOGIN_${which} is required.`);
  if (!password) die(`PASSWORD_${which} is required — set it with: read -rs PASSWORD_${which}; export PASSWORD_${which}`);
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const json = await res.json().catch(() => null);
  const token = json?.data?.access_token;
  if (!token) die(`could not sign in as ${login} (${res.status}).`);
  return token;
}

const rows = (d) => (Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.items) ? d.items : []);
const idsOf = (d) => rows(d).map((r) => r?.id).filter(Boolean);

console.log(`\ntenant isolation check -> ${API_URL}`);
const tokenA = await signIn(LOGIN_A, PASSWORD_A, 'A');
const tokenB = await signIn(LOGIN_B, PASSWORD_B, 'B');

// The two logins must actually be different tenants, or every check below is
// vacuously true — the worst possible way for this script to "pass".
const meA = await call(tokenA, 'GET', '/auth/me');
const meB = await call(tokenB, 'GET', '/auth/me');
const tidA = meA.data?.user?.tenantId ?? meA.data?.tenantId;
const tidB = meB.data?.user?.tenantId ?? meB.data?.tenantId;
if (!tidA || !tidB) die('could not read the tenant id for one of the logins.');
if (String(tidA) === String(tidB)) {
  die('LOGIN_A and LOGIN_B are in the SAME tenant — this check would pass vacuously. Use two tenants.');
}
console.log(`  both logins resolved, and they are different tenants\n`);

for (const { path, label } of COLLECTIONS) {
  const a = await call(tokenA, 'GET', path);
  const b = await call(tokenB, 'GET', path);
  if (!a.ok || !b.ok) {
    // A module disabled for one tenant is a legitimate 403, not an isolation
    // failure — report it and move on rather than scoring it either way.
    console.log(`  – ${label}: skipped (A ${a.status}, B ${b.status})`);
    continue;
  }
  const idsA = idsOf(a.data);
  const idsB = idsOf(b.data);
  const overlap = idsA.filter((id) => idsB.includes(id));
  ok(overlap.length === 0, `${label}: lists are disjoint (A ${idsA.length}, B ${idsB.length}, shared ${overlap.length})`);

  // The stronger check: take one of A's ids and fetch it AS B. A 404 is right;
  // a 200 is a data breach; a 500 means the row was reached and then blew up.
  const probe = idsA[0];
  if (!probe) {
    console.log(`  – ${label}: no rows in A to cross-fetch`);
    continue;
  }
  const cross = await call(tokenB, 'GET', `${path}/${probe}`);
  ok(
    cross.status === 404 || cross.status === 403,
    `${label}: A's record is not readable by B (got ${cross.status}${cross.status === 200 ? ' — LEAK' : ''})`,
  );
}

// Neither tenant owner may reach the platform console.
for (const [label, token] of [['A', tokenA], ['B', tokenB]]) {
  const res = await call(token, 'GET', '/platform/tenants');
  ok(res.status === 403 || res.status === 401, `tenant ${label} cannot list platform tenants (got ${res.status})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nTENANT ISOLATION: FAIL — do not onboard another tenant until this is understood.');
  process.exit(1);
}
console.log('\nTENANT ISOLATION: PASS');
