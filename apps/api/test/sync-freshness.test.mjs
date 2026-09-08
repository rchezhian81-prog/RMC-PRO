/**
 * Cloud → device freshness (gap-scan items O2, O3, O4).
 *
 * The pull cursor is `(updated_at, id)`, and raw SQL bypasses TypeORM's
 * @UpdateDateColumn (the tables have no trigger). So any write that did not set
 * updated_at itself was invisible to every offline device:
 *   O2 — upsertBalance is the ONLY writer of stock_balances and never set it, so
 *        a balance was delivered exactly once, at creation, and never again.
 *   O3 — the order-cancel sweep cancels draft challans with raw SQL, so a
 *        challan cancelled with its order stayed "live" on the plant forever.
 *   O4 — a device's plantId was stored without an in-tenant lookup, and it is
 *        stamped on every challan the device pushes.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_PLANT_ID,
 *      TEST_MATERIAL_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
const PLANT = process.env.TEST_PLANT_ID;
const MATERIAL = process.env.TEST_MATERIAL_ID;
if (!TENANT || !PLANT || !MATERIAL) { console.error('TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID required'); process.exit(1); }

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  database: process.env.POSTGRES_DB ?? 'rmc',
});
await owner.initialize();
const q = (sql, params) => owner.query(sql, params);
const one = async (sql, params) => (await owner.query(sql, params))[0];

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);

const dev = await post('/sync/devices/register', { deviceIdentifier: `SF-${tag}`, deviceName: `Freshness ${tag}`, plantId: PLANT });
ok(dev.ok, `device registered (${dev.status} ${dev.msg})`);
const D = dev.data?.id;

/** Pull until the server stops setting hasMore; returns the final token + everything seen. */
async function drain(from) {
  let token = from;
  const seen = { stockBalances: [], deliveryChallans: [], orders: [], customers: [] };
  for (let i = 0; i < 200; i++) {
    const r = await call('GET', `/sync/pull?deviceId=${D}${token ? `&since=${encodeURIComponent(token)}` : ''}`);
    if (!r.ok) return { token, seen, error: `${r.status} ${r.msg}` };
    for (const k of Object.keys(seen)) seen[k].push(...(r.data.changes?.[k] ?? []));
    token = r.data.syncToken;
    if (!r.data.hasMore) break;
  }
  return { token, seen };
}

console.log('\n[O2] a stock-balance change reaches the next pull');
{
  // Make sure the balance row exists, then drain so the device is fully caught up.
  const seed = await post('/stock/opening', { materialId: MATERIAL, plantId: PLANT, quantity: 500 });
  ok(seed.ok, `opening balance seeded (${seed.status} ${seed.msg})`);
  const caughtUp = await drain(undefined);
  ok(!caughtUp.error, `device drained to a current cursor (${caughtUp.error ?? 'ok'})`);
  const idle = await drain(caughtUp.token);
  if (idle.seen.stockBalances.length) console.log('    (diag) idle re-delivered:', JSON.stringify(idle.seen.stockBalances.map((b) => b.id)));
  ok(idle.seen.stockBalances.length === 0, 'a drained cursor returns no stock rows');

  const before = await one(`SELECT current_quantity::float AS q, updated_at FROM stock_balances WHERE plant_id = $1 AND material_id = $2`, [PLANT, MATERIAL]);
  const adj = await post('/stock-adjustments', { materialId: MATERIAL, plantId: PLANT, quantity: 25, direction: 'decrease', reason: `freshness ${tag}` });
  ok(adj.ok, `stock adjusted −25 (${adj.status} ${adj.msg})`);
  const after = await one(`SELECT current_quantity::float AS q, updated_at FROM stock_balances WHERE plant_id = $1 AND material_id = $2`, [PLANT, MATERIAL]);
  ok(after.q === before.q - 25, `balance moved ${before.q} → ${after.q}`);
  ok(new Date(after.updated_at) > new Date(before.updated_at), 'updated_at advanced with the change (it used to stay at row creation)');

  const next = await drain(caughtUp.token);
  const row = next.seen.stockBalances.find((b) => b.materialId === MATERIAL && b.plantId === PLANT);
  if (!row) console.log('    (diag) stock rows seen:', JSON.stringify(next.seen.stockBalances.map((b) => ({ m: b.materialId, q: b.currentQuantity, u: b.updatedAt }))));
  ok(!!row, 'the changed balance is delivered on the next pull');
  ok(Number(row?.currentQuantity) === after.q, `and carries the NEW quantity (${row?.currentQuantity})`);
}

console.log('\n[O3] a challan cancelled by the order-cancel sweep reaches the next pull');
{
  const caughtUp = await drain(undefined);
  const O = randomUUID(); const C = randomUUID();
  const grade = await one(`SELECT id, grade_code FROM concrete_grades WHERE tenant_id = $1 ORDER BY grade_code LIMIT 1`, [TENANT]);
  await q(`INSERT INTO orders (id, tenant_id, order_no, order_status) VALUES ($1, $2, $3, 'confirmed')`, [O, TENANT, `SF-ORD-${tag}`]);
  await q(`INSERT INTO order_items (id, tenant_id, order_id, grade_id, grade_label, quantity_m3) VALUES ($1, $2, $3, $4, $5, 10)`, [randomUUID(), TENANT, O, grade.id, grade.grade_code]);
  await q(`INSERT INTO delivery_challans (id, tenant_id, challan_no, challan_status, order_id, quantity_m3) VALUES ($1, $2, $3, 'draft', $4, 6)`, [C, TENANT, `SF-DC-${tag}`, O]);
  const seeded = await drain(caughtUp.token); // deliver the draft challan first
  ok(seeded.seen.deliveryChallans.some((c) => c.id === C), 'the draft challan reached the device');

  const cancel = await post(`/orders/${O}/cancel`, { reason: 'freshness test' });
  ok(cancel.ok, `order cancelled, sweeping the draft challan (${cancel.status} ${cancel.msg})`);
  const row = await one(`SELECT challan_status, updated_at FROM delivery_challans WHERE id = $1`, [C]);
  ok(row.challan_status === 'cancelled', 'challan is cancelled in the cloud');

  const next = await drain(seeded.token);
  const got = next.seen.deliveryChallans.find((c) => c.id === C);
  ok(!!got, 'the cancellation is delivered on the next pull (it used to be invisible)');
  ok(got?.challanStatus === 'cancelled', `and carries the new status (${got?.challanStatus})`);
}

console.log('\n[O4] a device cannot be registered against another tenant\'s plant');
{
  const F = randomUUID(); const FP = randomUUID();
  await q(`INSERT INTO tenants (id, tenant_code, tenant_name, status) VALUES ($1, $2, $3, 'active')`, [F, `SF${tag}`.toUpperCase().slice(0, 12), `Foreign ${tag}`]);
  await q(`INSERT INTO plants (id, tenant_id, plant_code, plant_name) VALUES ($1, $2, 'FP-1', 'Foreign Plant')`, [FP, F]);
  const bad = await post('/sync/devices/register', { deviceIdentifier: `SF-X-${tag}`, deviceName: 'Cross tenant', plantId: FP });
  ok(bad.status === 400 && /plant not found/i.test(bad.msg), `foreign plantId is refused (${bad.status}: ${bad.msg})`);
  ok((await one(`SELECT count(*)::int AS n FROM devices WHERE device_identifier = $1`, [`SF-X-${tag}`])).n === 0, 'no device row was created');
  const good = await post('/sync/devices/register', { deviceIdentifier: `SF-OK-${tag}`, deviceName: 'Own plant', plantId: PLANT });
  ok(good.ok && good.data?.plantId === PLANT, `the tenant's own plant is accepted (${good.status})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
