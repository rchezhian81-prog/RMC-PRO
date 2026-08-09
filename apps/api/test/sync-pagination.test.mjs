/**
 * Sync pull pagination + keyset-cursor test (offline-sync hardening).
 *
 * Proves the fix for the silent data-loss the old pull had: it capped each
 * entity at N rows but advanced the cursor to wall-clock `now`, so a backlog
 * bigger than one page lost its tail. The pull now uses a `(updated_at, id)`
 * keyset with a `hasMore` flag, and the plant-app engine drains until it clears.
 *
 * Drives the REAL SyncEngine against the booted API. Seeds a tie group LARGER
 * than the page limit (many rows sharing one updated_at) so a page boundary
 * falls inside the tie — the exact case a plain timestamp cursor skips or loops
 * on. Every seeded row must arrive exactly once.
 *
 * Env (from run-integration.mjs): API_URL, TEST_TENANT_ID, LOGIN, RMC_PASSWORD,
 * SYNC_PULL_LIMIT, POSTGRES_* (owner, to seed rows with a controlled updated_at).
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { SyncEngine } from '../../plant-app/src/sync/engine.js';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const LIMIT = Math.max(1, Number(process.env.SYNC_PULL_LIMIT ?? 3));
const TENANT = process.env.TEST_TENANT_ID;
const LOGIN = process.env.LOGIN;
const PW = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  synchronize: false,
  logging: false,
});

async function apiPull(deviceId, since, token) {
  const res = await fetch(`${BASE}/api/v1/sync/pull?deviceId=${deviceId}&since=${encodeURIComponent(since)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()).data;
}

(async () => {
  await owner.initialize();

  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PW }),
  });
  const token = (await loginRes.json())?.data?.access_token;
  ok('logged in for the sync test', typeof token === 'string' && token.length > 0);

  // The integration fixture tenant is on Starter, which does not include the
  // offline-sync module. Enable it via the super-admin (this also invalidates
  // the entitlement cache, so it takes effect immediately).
  const suToken = (await (await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD }),
  })).json())?.data?.access_token;
  const enable = await fetch(`${BASE}/api/v1/platform/tenants/${TENANT}/modules/offline_sync`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${suToken}` },
    body: JSON.stringify({ isEnabled: true }),
  });
  ok('offline_sync module enabled for the tenant', enable.status === 200);

  const engine = new SyncEngine({ dbPath: ':memory:', baseUrl: BASE, token });
  await engine.registerAndBootstrap({ deviceIdentifier: `PAGE-${Date.now() % 1000000}`, deviceName: 'Pagination Test PC' });
  const baseline = engine.getMeta('sync_token'); // ISO token captured at bootstrap
  ok('device bootstrapped with a sync token', !!baseline);

  // Seed N > LIMIT customers AFTER the bootstrap token. The first LIMIT+1 share
  // one exact updated_at (a tie group bigger than a page); the rest are later.
  const N = LIMIT * 2 + 1;
  const base = Date.parse(baseline);
  const T1 = new Date(base + 60_000).toISOString();
  const T2 = new Date(base + 120_000).toISOString();
  const tag = randomUUID().slice(0, 8);
  const ids = [];
  for (let i = 0; i < N; i++) {
    const id = randomUUID();
    ids.push(id);
    const ts = i <= LIMIT ? T1 : T2; // first LIMIT+1 rows tie on T1
    await owner.query(
      `INSERT INTO customers (id, tenant_id, customer_code, customer_name, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)`,
      [id, TENANT, `PGT-${tag}-${i}`, `Pagination ${i}`, ts],
    );
  }
  console.log(`  seeded ${N} customers (LIMIT=${LIMIT}; ${LIMIT + 1} tie on one timestamp)`);

  // A single pull from the baseline must cap at LIMIT and admit there is more.
  const first = await apiPull(engine.deviceId, baseline, token);
  ok('a single pull caps a full entity at LIMIT', first.counts.customers === LIMIT);
  ok('a capped pull signals hasMore', first.hasMore === true);
  ok('the pull token is opaque (not a bare timestamp)', Number.isNaN(Date.parse(first.syncToken)));

  // The engine drains from its own (still baseline) token.
  const drain = await engine.pull();
  ok('drain terminates in a sane number of pages', drain.pages >= Math.ceil(N / LIMIT) && drain.pages < 100);
  ok('every seeded row is delivered EXACTLY once (no loss, no duplicate)', drain.customers === N);

  const placeholders = ids.map(() => '?').join(',');
  const local = engine.db.prepare(
    `SELECT count(*) c FROM ref_data WHERE entity='customers' AND cloud_id IN (${placeholders})`,
  ).get(...ids).c;
  ok('all seeded rows are present in the local store', Number(local) === N);

  // A follow-up pull from the drained token is now empty and settled.
  const after = await apiPull(engine.deviceId, engine.getMeta('sync_token'), token);
  ok('a drained cursor returns no more changes', after.counts.customers === 0 && after.hasMore === false);

  engine.close();
  await owner.destroy();
  console.log(`\nSYNC PAGINATION TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
