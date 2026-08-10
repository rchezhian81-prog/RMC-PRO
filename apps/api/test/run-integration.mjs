/**
 * Integration-test orchestrator (QA follow-up A1).
 *
 * Against an EMPTY Postgres (provided via env — a CI service container or a
 * local throwaway), this: runs migrations, seeds the platform, boots the API,
 * creates a pilot tenant + owner + plant master data, then runs every
 * test/*.test.mjs with the fixtures wired in, and fails the process if any test
 * fails. One command for CI and local: `pnpm test:integration`.
 *
 * The DB owner role (POSTGRES_USER, superuser) runs migrations/seed; the API
 * runs as the non-superuser APP_DB_USER, exactly like production.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const E = {
  POSTGRES_HOST: process.env.POSTGRES_HOST ?? '127.0.0.1',
  POSTGRES_PORT: process.env.POSTGRES_PORT ?? '5432',
  POSTGRES_DB: process.env.POSTGRES_DB ?? 'rmc',
  POSTGRES_USER: process.env.POSTGRES_USER ?? 'rmc_owner',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  APP_DB_USER: process.env.APP_DB_USER ?? 'rmc_app',
  APP_DB_PASSWORD: process.env.APP_DB_PASSWORD ?? 'apppw',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'ci-access-secret-0123456789abcdefghij',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'ci-refresh-secret-0123456789abcdefghij',
  API_PORT: process.env.API_PORT ?? '4000',
  NODE_ENV: 'production',
  // Relax the rate limiters for this suite only — it logs in many times across
  // fixtures + tests (incl. refresh rotation), far above the human 5/60s limit.
  // The e2e suite deliberately does NOT set these, so security.mjs still proves
  // the production 429 behaviour.
  THROTTLE_LIMIT: '100000',
  AUTH_THROTTLE_LIMIT: '100000',
  // Small pull pages so sync-pagination exercises the keyset drain with a
  // handful of rows instead of thousands. Production default is 500.
  SYNC_PULL_LIMIT: '3',
  // Token-gate the /metrics scrape so the metrics test can prove both paths.
  METRICS_TOKEN: 'ci-metrics-token',
  SUPERADMIN_EMAIL: 'super@ci.test',
  SUPERADMIN_PASSWORD: 'SuperCI#12345',
  SUPERADMIN_NAME: 'CI Super',
};
const OWNER_LOGIN = 'owner@ci.test';
const OWNER_PW = 'OwnerCI#12345';
const BASE = `http://localhost:${E.API_PORT}/api/v1`;
const childEnv = { ...process.env, ...E };

const TESTS = [
  'test/stock-ledger.integration.test.mjs',
  'test/master-validation.test.mjs',
  'test/rls-isolation.test.mjs',
  'test/order-to-cash.test.mjs',
  'test/cookie-auth.test.mjs',
  'test/observability.test.mjs',
  'test/metrics.test.mjs',
  'test/sync-pagination.test.mjs',
  'test/rls-users.test.mjs',
  'test/agents-substrate.test.mjs',
  'test/agents-insight.test.mjs',
  'test/agents-specialist.test.mjs',
  // Last: it changes the fixture owner's password (token_version bump), so
  // nothing after it may depend on the old password.
  'test/refresh-rotation.test.mjs',
];

function step(name, cmd, args, extraEnv = {}) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...childEnv, ...extraEnv } });
  if ((r.status ?? 1) !== 0) {
    console.error(`\n✗ setup step failed: ${name}`);
    apiProc?.kill('SIGKILL');
    process.exit(1);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}

let apiProc;
async function main() {
  // 1) schema + seed (owner role)
  step('migrate', 'node_modules/.bin/typeorm', ['migration:run', '-d', 'dist/core/database/data-source.js']);
  step('seed platform', 'node', ['dist/core/database/seed-prod.js']);

  // 2) boot API (runs as APP_DB_USER)
  console.log('\n── boot API ──');
  apiProc = spawn('node', ['dist/main.js'], { env: childEnv, stdio: 'inherit' });
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(`http://localhost:${E.API_PORT}/health`).then((r) => r.ok).catch(() => false);
    if (ok) { console.log(`API healthy after ${i}s`); break; }
    await sleep(1000);
    if (i === 39) throw new Error('API did not become healthy');
  }

  // 3) fixtures: pilot tenant + owner + plant master
  console.log('\n── fixtures ──');
  const su = (await api('POST', '/auth/login', { login: E.SUPERADMIN_EMAIL, password: E.SUPERADMIN_PASSWORD })).access_token;
  const plans = await api('GET', '/platform/plans', null, su);
  const plan = plans[plans.length - 1];
  const tenant = await api('POST', '/platform/tenants', { tenantCode: 'CIPILOT', tenantName: 'CI Pilot', planId: plan.id }, su);
  await api('POST', `/platform/tenants/${tenant.id}/assign-plan`, { planId: plan.id }, su).catch(() => {});
  await api('POST', `/platform/tenants/${tenant.id}/users`, { name: 'CI Owner', email: OWNER_LOGIN, password: OWNER_PW }, su);
  console.log(`pilot tenant ${tenant.id} + owner ready`);

  step('seed plant master', 'node', ['../../scripts/setup/seed-plant-master.mjs'], {
    API_URL: `http://localhost:${E.API_PORT}`,
    LOGIN: OWNER_LOGIN,
    RMC_PASSWORD: OWNER_PW,
  });

  const ownerTok = (await api('POST', '/auth/login', { login: OWNER_LOGIN, password: OWNER_PW })).access_token;
  const plants = await api('GET', '/plants', null, ownerTok);
  const materials = await api('GET', '/materials', null, ownerTok);
  const fixtures = {
    TEST_TENANT_ID: tenant.id,
    TEST_PLANT_ID: plants[0].id,
    TEST_MATERIAL_ID: materials[0].id,
    LOGIN: OWNER_LOGIN,
    RMC_PASSWORD: OWNER_PW,
    API_URL: `http://localhost:${E.API_PORT}`,
    API_BASE: BASE,
  };

  // 4) run the suite
  const results = [];
  for (const t of TESTS) {
    console.log(`\n════════ ${t} ════════`);
    // --experimental-sqlite so a test may drive the plant-app SyncEngine (which
    // uses node:sqlite); harmless for the tests that don't.
    const r = spawnSync('node', ['--experimental-sqlite', t], { stdio: 'inherit', env: { ...childEnv, ...fixtures } });
    results.push({ t, ok: (r.status ?? 1) === 0 });
  }

  console.log('\n════════ SUMMARY ════════');
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.t}`);
    if (!r.ok) failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} test files passed`);
  return failed;
}

main()
  .then((failed) => { apiProc?.kill('SIGKILL'); process.exit(failed ? 1 : 0); })
  .catch((e) => { console.error('\nORCHESTRATOR ERROR:', e.message); apiProc?.kill('SIGKILL'); process.exit(1); });
