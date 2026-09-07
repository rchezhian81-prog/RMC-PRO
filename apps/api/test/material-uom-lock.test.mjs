/**
 * Material unit of measure is frozen once stock exists (data-integrity item I39).
 * Stock balances and the ledger carry no unit, and the weighbridge scales by
 * the LIVE material uom, so flipping MT → kg after stock exists mixes scales
 * with no way to reconstruct. Other fields stay editable; a material with no
 * stock movements can still change its unit.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_PLANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
const PLANT = process.env.TEST_PLANT_ID;
if (!TENANT || !PLANT) { console.error('TEST_TENANT_ID, TEST_PLANT_ID required'); process.exit(1); }

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
const tag = Date.now().toString(36);

console.log('\n[I39] uom frozen once stock exists');
{
  const M = randomUUID();
  await q(`INSERT INTO materials (id, tenant_id, material_code, material_name, uom) VALUES ($1, $2, $3, 'Cement UOM', 'MT')`, [M, TENANT, `UOM-${tag}`]);
  const free = await call('PATCH', `/materials/${M}`, { uom: 'kg' });
  ok(free.ok, `with no stock the unit can still change (${free.status} ${free.msg})`);
  await call('PATCH', `/materials/${M}`, { uom: 'MT' });
  const op = await call('POST', '/stock/opening', { materialId: M, plantId: PLANT, quantity: 160 });
  ok(op.ok, `opening stock of 160 MT recorded (${op.status} ${op.msg})`);
  const flip = await call('PATCH', `/materials/${M}`, { uom: 'kg' });
  ok(flip.status === 400 && /cannot be changed/i.test(flip.msg), `MT → kg is refused once stock exists (${flip.status}: ${flip.msg})`);
  const row = await one(`SELECT uom, material_name FROM materials WHERE id = $1`, [M]);
  ok(row.uom === 'MT', 'the unit is unchanged');
  const same = await call('PATCH', `/materials/${M}`, { uom: 'MT', materialName: 'Cement UOM (renamed)' });
  ok(same.ok, `re-sending the same unit alongside other edits is fine (${same.status})`);
  const other = await call('PATCH', `/materials/${M}`, { materialName: 'Cement UOM 2', standardRate: 5400 });
  ok(other.ok, `other fields stay editable (${other.status})`);
  const row2 = await one(`SELECT uom, material_name, standard_rate::float AS r FROM materials WHERE id = $1`, [M]);
  ok(row2.uom === 'MT' && row2.material_name === 'Cement UOM 2' && row2.r === 5400, 'edits landed, unit intact');
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
