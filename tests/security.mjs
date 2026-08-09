import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, raw, login, suite, PASSWORD } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** Security checks (Design Doc 11): rate limit, no secrets to FE, sync auth, tenant access. */
export async function run() {
  const s = suite('Security checks (Doc 11)');
  const admin = await login('admin@alpha.test');

  // --- No secrets exposed to frontend ---
  const me = await api('GET', '/auth/me', { token: admin }).catch(() => null);
  const meStr = JSON.stringify(me ?? {});
  s.ok('/auth/me does not leak passwordHash', !/passwordhash/i.test(meStr));
  const users = await api('GET', '/users', { token: admin });
  s.ok('/users does not leak passwordHash', !users.some((u) => 'passwordHash' in u || 'password_hash' in u));

  const forbidden = /JWT_SECRET|JWT_REFRESH_SECRET|POSTGRES_PASSWORD|APP_DB_PASSWORD|passwordHash/;
  const webFiles = walk(join(ROOT, 'apps/web/src'));
  const leaks = webFiles.filter((f) => forbidden.test(readFileSync(f, 'utf8')));
  s.ok('web source references no server secrets', leaks.length === 0, leaks.map((f) => f.replace(ROOT, '')).join(', '));

  // Only NEXT_PUBLIC_* env vars may appear in web code.
  const envRefs = [];
  for (const f of webFiles) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!m[1].startsWith('NEXT_PUBLIC_')) envRefs.push(m[1]);
  }
  s.ok('web reads only NEXT_PUBLIC_* env vars', envRefs.length === 0, [...new Set(envRefs)].join(', '));

  // --- Offline sync authorization ---
  s.ok('unauthenticated sync device register → 401', (await raw('POST', '/sync/devices/register', { body: {} })).status === 401);
  s.ok('unauthenticated sync push → 401', (await raw('POST', '/sync/push', { body: {} })).status === 401);

  // --- Tenant / plant access enforcement (TenantGuard) ---
  const superToken = await login('super@platform.test');
  s.ok('super_admin (no tenant) blocked on tenant route → 403', (await raw('GET', '/orders', { token: superToken })).status === 403);
  s.ok('super_admin blocked on masters route → 403', (await raw('GET', '/customers', { token: superToken })).status === 403);

  // --- Rate limiting (login throttle 5/60s) — run LAST (intentionally trips the limiter) ---
  let got429 = false;
  for (let i = 0; i < 10 && !got429; i++) {
    const r = await raw('POST', '/auth/login', { body: { login: 'rl-probe@alpha.test', password: PASSWORD } });
    if (r.status === 429) got429 = true;
  }
  s.ok('login endpoint is rate-limited (429 after burst)', got429);

  return s.done();
}
