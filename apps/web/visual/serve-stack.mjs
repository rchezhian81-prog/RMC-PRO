/**
 * Visual-regression stack runner (PR-UI0).
 *
 * Boots the REAL app end-to-end against a provided empty Postgres, exactly like
 * the API integration harness, then starts the built web server and runs the
 * Playwright baseline. No mock data, no prototype routing — the screenshots are
 * of the real product rendered from the real API.
 *
 *   1. migrate + seed platform            (owner DB role)
 *   2. boot API on :4000                  (app DB role, like production)
 *   3. create pilot tenant + owner, enable every module, seed plant master
 *   4. start `next start` web on :3000    (already built; flag OFF = baseline)
 *   5. run Playwright (writes/*compares* the baseline), then tear everything down
 *
 * Postgres comes from the environment (a CI service container or a local
 * throwaway), same contract as apps/api/test/run-integration.mjs.
 *
 * Usage (from repo root, with an empty Postgres reachable via POSTGRES_*):
 *   node apps/web/visual/serve-stack.mjs                # compare against baseline
 *   node apps/web/visual/serve-stack.mjs --update-snapshots   # (re)write baseline
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const API_DIR = path.join(ROOT, 'apps/api');
const WEB_DIR = path.join(ROOT, 'apps/web');

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
  THROTTLE_LIMIT: '100000',
  AUTH_THROTTLE_LIMIT: '100000',
  GST_PROVIDER: 'fake',
  SUPERADMIN_EMAIL: 'super@visual.test',
  SUPERADMIN_PASSWORD: 'SuperVis#12345',
  SUPERADMIN_NAME: 'Visual Super',
};
const OWNER_LOGIN = process.env.VISUAL_LOGIN ?? 'owner@visual.test';
const OWNER_PW = process.env.VISUAL_PASSWORD ?? 'OwnerVis#12345';
const API_BASE = `http://localhost:${E.API_PORT}/api/v1`;
const WEB_PORT = process.env.WEB_PORT ?? '3000';
const apiEnv = { ...process.env, ...E };

let apiProc, webProc;
function killAll() { apiProc?.kill('SIGKILL'); webProc?.kill('SIGKILL'); }

function step(name, cmd, args, cwd, extraEnv = {}) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd, env: { ...apiEnv, ...extraEnv } });
  if ((r.status ?? 1) !== 0) { console.error(`✗ setup failed: ${name}`); killAll(); process.exit(1); }
}

async function api(method, p, body, token) {
  const res = await fetch(`${API_BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}

async function waitHealthy(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await fetch(url).then((r) => r.ok).catch(() => false);
    if (ok) { console.log(`${label} healthy after ${i}s`); return; }
    await sleep(1000);
  }
  throw new Error(`${label} did not become healthy`);
}

async function main() {
  // 1) schema + seed (owner role)
  step('migrate', 'node_modules/.bin/typeorm', ['migration:run', '-d', 'dist/core/database/data-source.js'], API_DIR);
  step('seed platform', 'node', ['dist/core/database/seed-prod.js'], API_DIR);

  // 2) boot API (app role)
  console.log('\n── boot API ──');
  apiProc = spawn('node', ['dist/main.js'], { cwd: API_DIR, env: apiEnv, stdio: 'inherit' });
  await waitHealthy(`http://localhost:${E.API_PORT}/health`, 'API');

  // 3) fixtures: tenant + owner + all modules + plant master
  console.log('\n── fixtures ──');
  const su = (await api('POST', '/auth/login', { login: E.SUPERADMIN_EMAIL, password: E.SUPERADMIN_PASSWORD })).access_token;
  const plans = await api('GET', '/platform/plans', null, su);
  const plan = plans[plans.length - 1];
  const tenant = await api('POST', '/platform/tenants', { tenantCode: 'VISUAL', tenantName: 'Visual Baseline Co', planId: plan.id }, su);
  await api('POST', `/platform/tenants/${tenant.id}/assign-plan`, { planId: plan.id }, su).catch(() => {});
  await api('POST', `/platform/tenants/${tenant.id}/users`, { name: 'Visual Owner', email: OWNER_LOGIN, password: OWNER_PW }, su);
  // Enable every module so all module-gated nav renders in the baseline.
  const mods = await api('GET', '/platform/modules', null, su);
  for (const m of mods) {
    await api('PUT', `/platform/tenants/${tenant.id}/modules/${m.moduleKey}`, { isEnabled: true }, su).catch(() => {});
  }
  console.log(`tenant ${tenant.id} + owner + ${mods.length} modules ready`);
  step('seed plant master', 'node', ['../../scripts/setup/seed-plant-master.mjs'], API_DIR, {
    API_URL: `http://localhost:${E.API_PORT}`, LOGIN: OWNER_LOGIN, RMC_PASSWORD: OWNER_PW,
  });

  // 4) build the web pointed at THIS API origin (so CSP connect-src + the client
  // BASE both target http://localhost:4000), flag OFF, then serve the standalone
  // build the way the production image does.
  // UI_V2_BUILD selects the skin baked into the build: '' (OFF, current UI) or
  // '1' (ON, Deep Violet Matte). Paired with VISUAL_MODE so ON writes '-v2' shots.
  const UI_V2 = process.env.UI_V2_BUILD ?? '';
  step('build web', 'node_modules/.bin/next', ['build'], WEB_DIR, {
    NEXT_PUBLIC_API_URL: `http://localhost:${E.API_PORT}`, NEXT_PUBLIC_UI_V2: UI_V2,
  });
  // next.config uses output:'standalone' (the production image runs it that way),
  // so `next start` won't serve it — run the standalone server, first copying the
  // static assets + public/ into it exactly like the Dockerfile does.
  console.log('\n── boot WEB (standalone) ──');
  const SA = path.join(WEB_DIR, '.next/standalone/apps/web');
  step('standalone: static', 'cp', ['-rT', path.join(WEB_DIR, '.next/static'), path.join(SA, '.next/static')], ROOT);
  step('standalone: public', 'bash', ['-c', `d="${path.join(WEB_DIR, 'public')}"; [ -d "$d" ] && cp -rT "$d" "${path.join(SA, 'public')}" || true`], ROOT);
  webProc = spawn('node', [path.join(SA, 'server.js')], {
    env: { ...process.env, NODE_ENV: 'production', PORT: WEB_PORT, HOSTNAME: '127.0.0.1',
      NEXT_PUBLIC_API_URL: `http://localhost:${E.API_PORT}`, NEXT_PUBLIC_UI_V2: UI_V2 },
    stdio: 'inherit',
  });
  await waitHealthy(`http://localhost:${WEB_PORT}/api/health`, 'WEB');

  // 5) run Playwright
  console.log('\n── playwright ──');
  const extra = process.argv.slice(2);
  const r = spawnSync('node_modules/.bin/playwright', ['test', ...extra], {
    cwd: WEB_DIR, stdio: 'inherit',
    env: {
      ...process.env,
      WEB_BASE_URL: `http://localhost:${WEB_PORT}`,
      VISUAL_LOGIN: OWNER_LOGIN, VISUAL_PASSWORD: OWNER_PW,
      VISUAL_MODE: process.env.VISUAL_MODE ?? 'off',
      PW_CHROME_PATH: process.env.PW_CHROME_PATH ?? '',
    },
  });
  return r.status ?? 1;
}

main()
  .then((code) => { killAll(); process.exit(code); })
  .catch((e) => { console.error('\nSTACK ERROR:', e.message); killAll(); process.exit(1); });
