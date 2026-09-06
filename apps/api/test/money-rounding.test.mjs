/**
 * Numeric integrity (data-integrity items I20, I27, I32).
 *
 * I20 — money inputs are rounded ONCE at the boundary with a rounder that
 *       agrees with numeric(…,2), so every derived figure in a transaction
 *       reconciles to the paise (receipt amount = allocated + unallocated,
 *       SUM(allocations) = header, invoice amount_paid = SUM(allocations)).
 * I27 — CSV numeric cells that are not finite numbers are rejected per row
 *       instead of persisting NaN; grouped digits ("5,200") are accepted.
 * I32 — re-setting an opening balance writes the CHANGE to the ledger, so
 *       SUM(in) − SUM(out) always equals the balance.
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
if (!TENANT || !PLANT) { console.error('TEST_TENANT_ID and TEST_PLANT_ID required'); process.exit(1); }

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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);

// ───────────────────────── I20 — receipts reconcile to the paise ─────────────────────────
console.log('\n[I20] receipt of 1.005: one figure everywhere');
{
  const C = randomUUID();
  await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, $4)`, [C, TENANT, `MR-${tag}`, `Rounding Co ${tag}`]);
  const A = randomUUID();
  await q(
    `INSERT INTO invoices (id, tenant_id, invoice_no, customer_id, invoice_status, invoice_date, total_amount, amount_paid, written_off_amount, outstanding_amount, payment_status)
     VALUES ($1, $2, $3, $4, 'issued', $5, 1000, 0, 0, 1000, 'unpaid')`,
    [A, TENANT, `MRI-${tag}`, C, TODAY],
  );
  const r = await post('/receipts', { customerId: C, amount: 1.005, paymentMode: 'cash', receiptDate: TODAY, allocations: [{ invoiceId: A, amount: 1.005 }] });
  ok(r.ok, `receipt created (${r.status} ${r.msg})`);
  const p = await one(`SELECT amount::float AS a, allocated_amount::float AS al, unallocated_amount::float AS un, is_advance FROM payments WHERE id = $1`, [r.data?.id]);
  ok(near(p?.a, 1.01), `receipt amount stored as 1.01, the numeric(…,2) value (${p?.a})`);
  ok(near(p?.al, 1.01) && near(p?.un, 0), `header allocated 1.01 / unallocated 0.00 (${p?.al}/${p?.un})`);
  ok(p?.is_advance === false, 'not flagged as an advance');
  const s = await one(`SELECT COALESCE(SUM(allocated_amount), 0)::float AS s FROM payment_allocations WHERE payment_id = $1`, [r.data?.id]);
  ok(near(s.s, p?.al), `SUM(allocation rows) equals the header allocated (${s.s})`);
  const inv = await one(`SELECT amount_paid::float AS paid, outstanding_amount::float AS o, payment_status FROM invoices WHERE id = $1`, [A]);
  ok(near(inv.paid, 1.01) && near(inv.o, 998.99), `invoice paid 1.01 / outstanding 998.99 (${inv.paid}/${inv.o})`);
  ok(inv.payment_status === 'partially_paid', `invoice is partially_paid (${inv.payment_status})`);

  const r2 = await post('/receipts', { customerId: C, amount: 10.005, paymentMode: 'cash', receiptDate: TODAY, allocations: [{ invoiceId: A, amount: 5.005 }] });
  ok(r2.ok, 'second receipt with a part allocation created');
  const p2 = await one(`SELECT amount::float AS a, allocated_amount::float AS al, unallocated_amount::float AS un FROM payments WHERE id = $1`, [r2.data?.id]);
  ok(near(p2.a, 10.01) && near(p2.al, 5.01) && near(p2.un, 5), `10.005 → amount 10.01 = allocated 5.01 + unallocated 5.00 (${p2.a}/${p2.al}/${p2.un})`);
  ok(near(p2.a, p2.al + p2.un), 'amount = allocated + unallocated exactly');
  const inv2 = await one(`SELECT amount_paid::float AS paid FROM invoices WHERE id = $1`, [A]);
  const sumInv = await one(`SELECT COALESCE(SUM(allocated_amount), 0)::float AS s FROM payment_allocations WHERE invoice_id = $1`, [A]);
  ok(near(inv2.paid, sumInv.s) && near(inv2.paid, 6.02), `invoice amount_paid equals SUM(its allocations) = 6.02 (${inv2.paid}/${sumInv.s})`);
}

// ───────────────────────── I27 — CSV numeric cells ─────────────────────────
console.log('\n[I27] material import: grouped digits accepted, non-numbers rejected per row');
{
  const tpl = await fetch(`${BASE}/imports/materials/template`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const header = (await tpl.text()).split(/\r?\n/)[0];
  ok(tpl.ok && header.length > 0, 'materials template header fetched');
  const codeOk = `MR-OK-${tag}`;
  const codeBad = `MR-BAD-${tag}`;
  const content = [
    header,
    `${codeOk},Rounding Cement ${tag},cement,MT,2523,cement,10,20,"5,200"`,
    `${codeBad},Bad Rate ${tag},cement,MT,2523,cement,10,abc,5200`,
  ].join('\n');
  const job = await post('/imports/materials', { content, fileName: 'materials.csv' });
  ok(job.ok, `import ran (${job.status} ${job.msg})`);
  ok(job.data?.successCount === 1 && job.data?.errorCount === 1, `1 row imported, 1 rejected (${job.data?.successCount}/${job.data?.errorCount})`);
  const err = (job.data?.errors ?? [])[0];
  ok(err?.row === 3 && /not a number/i.test(err?.message ?? ''), `the rejected row names the bad cell (${err?.row}: ${err?.message})`);
  const good = await one(`SELECT standard_rate::float AS r FROM materials WHERE tenant_id = $1 AND material_code = $2`, [TENANT, codeOk]);
  ok(near(good?.r, 5200), `"5,200" imported as 5200 (${good?.r})`);
  const bad = await one(`SELECT count(*)::int AS n FROM materials WHERE tenant_id = $1 AND material_code = $2`, [TENANT, codeBad]);
  ok(bad.n === 0, 'the NaN row was not persisted');
  const nan = await one(`SELECT count(*)::int AS n FROM materials WHERE tenant_id = $1 AND (standard_rate = 'NaN' OR minimum_stock = 'NaN' OR reorder_level = 'NaN')`, [TENANT]);
  ok(nan.n === 0, 'no NaN thresholds/rates anywhere in the tenant');

  const direct = await post('/materials', { materialCode: `MR-API-${tag}`, materialName: 'Api NaN', standardRate: 'abc' });
  ok(direct.status === 400, `a non-numeric standardRate on the API is a 400 (${direct.status})`);
  const neg = await post('/materials', { materialCode: `MR-NEG-${tag}`, materialName: 'Api Neg', minimumStock: -5 });
  ok(neg.status === 400, `a negative minimumStock on the API is a 400 (${neg.status})`);
}

// ───────────────────────── I32 — opening balance reset ─────────────────────────
console.log('\n[I32] opening balance: resets are signed ledger deltas');
{
  const M = randomUUID();
  await q(`INSERT INTO materials (id, tenant_id, material_code, material_name, uom) VALUES ($1, $2, $3, $4, 'MT')`, [M, TENANT, `MR-STK-${tag}`, `Stock Reset ${tag}`]);
  const o1 = await post('/stock/opening', { materialId: M, plantId: PLANT, quantity: 100 });
  ok(o1.ok, `first opening recorded (${o1.status} ${o1.msg})`);
  const o2 = await post('/stock/opening', { materialId: M, plantId: PLANT, quantity: 60 });
  ok(o2.ok, 'reset downwards to 60 accepted');
  const o3 = await post('/stock/opening', { materialId: M, plantId: PLANT, quantity: 130 });
  ok(o3.ok, 'reset upwards to 130 accepted');
  const rows = await q(
    `SELECT transaction_type AS t, in_quantity::float AS i, out_quantity::float AS o, balance_after::float AS b
       FROM stock_transactions WHERE material_id = $1 AND plant_id = $2 ORDER BY created_at ASC, id ASC`,
    [M, PLANT],
  );
  ok(rows.length === 3, `three ledger rows (${rows.length})`);
  ok(rows[0]?.t === 'opening' && near(rows[0]?.i, 100) && near(rows[0]?.o, 0), `first is an opening inflow of 100 (${rows[0]?.t} ${rows[0]?.i}/${rows[0]?.o})`);
  ok(rows[1]?.t === 'adjustment' && near(rows[1]?.i, 0) && near(rows[1]?.o, 40) && near(rows[1]?.b, 60), `downward reset is an adjustment OUT 40, balance 60 (${rows[1]?.t} ${rows[1]?.i}/${rows[1]?.o}/${rows[1]?.b})`);
  ok(rows[2]?.t === 'adjustment' && near(rows[2]?.i, 70) && near(rows[2]?.o, 0) && near(rows[2]?.b, 130), `upward reset is an adjustment IN 70, balance 130 (${rows[2]?.t} ${rows[2]?.i}/${rows[2]?.o}/${rows[2]?.b})`);
  const bal = await one(`SELECT current_quantity::float AS c FROM stock_balances WHERE material_id = $1 AND plant_id = $2`, [M, PLANT]);
  const led = await one(`SELECT (COALESCE(SUM(in_quantity), 0) - COALESCE(SUM(out_quantity), 0))::float AS n FROM stock_transactions WHERE material_id = $1 AND plant_id = $2`, [M, PLANT]);
  ok(near(bal.c, 130) && near(led.n, bal.c), `SUM(in) − SUM(out) = balance = 130 (${led.n}/${bal.c})`);
  const negQ = await post('/stock/opening', { materialId: M, plantId: PLANT, quantity: -5 });
  ok(negQ.status === 400, `negative opening quantity is refused (${negQ.status})`);
  const nanQ = await post('/stock/opening', { materialId: M, plantId: PLANT, quantity: 'abc' });
  ok(nanQ.status === 400, `non-numeric opening quantity is refused (${nanQ.status})`);
  const after = await one(`SELECT count(*)::int AS n FROM stock_transactions WHERE material_id = $1 AND plant_id = $2`, [M, PLANT]);
  ok(after.n === 3, 'refusals wrote nothing to the ledger');
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
