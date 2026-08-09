/**
 * End-to-end (Suite B) orchestrator — wires the repo-root `tests/` suite
 * (tenant isolation, RBAC, UAT, security) into CI (roadmap Wave 0).
 *
 * These suites were previously runnable only by hand against a live, seeded
 * stack, so they gated nothing. This script makes them a CI gate: against an
 * EMPTY Postgres it runs migrations, seeds the DEMO tenants the suite expects
 * (Alpha/Beta, admin@alpha.test / admin@beta.test; password is the demo seed's
 * DEMO_PASSWORD), boots the API as the non-superuser app role, then runs
 * `tests/run.mjs` and fails the
 * process if any suite fails.
 *
 * Mirrors test/run-integration.mjs: owner role runs migrations/seed, the API
 * runs as APP_DB_USER exactly like production.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..'); // apps/api/test -> repo root
const SUITE_RUNNER = resolve(REPO_ROOT, 'tests/run.mjs');

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
};
// The demo tenants are unprovisioned by design (Beta has no plan/modules) so the
// suite can exercise MODULE_NOT_ENABLED and the fail-open path — so we must NOT
// run these under PROVISIONING_STRICT.
delete E.PROVISIONING_STRICT;
const childEnv = { ...process.env, ...E, PROVISIONING_STRICT: '' };

let apiProc;
function step(name, cmd, args, extraEnv = {}) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...childEnv, ...extraEnv } });
  if ((r.status ?? 1) !== 0) {
    console.error(`\n✗ setup step failed: ${name}`);
    apiProc?.kill('SIGKILL');
    process.exit(1);
  }
}

async function main() {
  // 1) schema + DEMO seed (owner role). The demo seed creates Alpha/Beta and the
  //    master data the suite reads.
  step('migrate', 'node_modules/.bin/typeorm', ['migration:run', '-d', 'dist/core/database/data-source.js']);
  step('seed demo', 'node', ['dist/core/database/seed.js']);

  // 2) boot API (runs as APP_DB_USER)
  console.log('\n── boot API ──');
  apiProc = spawn('node', ['dist/main.js'], { env: childEnv, stdio: 'inherit' });
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(`http://localhost:${E.API_PORT}/health`).then((r) => r.ok).catch(() => false);
    if (ok) { console.log(`API healthy after ${i}s`); break; }
    await sleep(1000);
    if (i === 39) throw new Error('API did not become healthy');
  }

  // 3) run the repo-root suite against the booted API (node:sqlite for the
  //    plant-app offline engine the UAT suite drives).
  console.log('\n════════ tests/run.mjs ════════');
  const r = spawnSync('node', ['--experimental-sqlite', SUITE_RUNNER], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: { ...childEnv, RMC_BASE: `http://localhost:${E.API_PORT}` },
  });
  return (r.status ?? 1) === 0 ? 0 : 1;
}

main()
  .then((failed) => { apiProc?.kill('SIGKILL'); process.exit(failed ? 1 : 0); })
  .catch((e) => { console.error('\nORCHESTRATOR ERROR:', e.message); apiProc?.kill('SIGKILL'); process.exit(1); });
