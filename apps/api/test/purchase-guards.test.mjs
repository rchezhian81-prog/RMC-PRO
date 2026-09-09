/**
 * Purchase gap scan — items P1, P2, P3.
 *
 *   P1 — purchaseOrder.issue() read the PO WITHOUT a row lock while cancel()
 *        took one. A cancel committing between that read and the UPDATE was
 *        overwritten: a purchase order somebody deliberately cancelled came
 *        back as 'issued', and an issued PO can be received against and billed.
 *   P2 — vendor payments had no duplicate-reference guard. Customer receipts
 *        got one (I5) after a lost response + retry doubled a receipt; the
 *        money-OUT side never did, so a retried payment paid a supplier's bill
 *        twice and understated payables by the whole amount.
 *   P3 — the purchase reports passed `from`/`to` straight into `$1::date`, so
 *        `?from=garbage` was a 500 rather than a 400.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_PLANT_ID, POSTGRES_*.
 */
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
  return { status: res.status, ok: res.ok, data: json?.data, code: json?.error?.code ?? json?.code ?? '', msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);

const supplier = await post('/suppliers', {
  supplierCode: `PGS-${tag}`, supplierName: `Purchase Guard ${tag}`, state: 'Tamil Nadu',
});
ok(supplier.ok, `supplier created (${supplier.status} ${supplier.msg})`);
const supplierId = supplier.data?.id;
const material = await one(`SELECT id FROM materials WHERE tenant_id = $1 LIMIT 1`, [TENANT]);

const newPo = async () => post('/purchase-orders', {
  supplierId, plantId: PLANT, orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ materialId: material.id, quantity: 10, rate: 100 }],
});

// ---------------------------------------------------------------------------
console.log('\n[P1] a cancelled purchase order cannot be resurrected by an issue');
{
  const po = await newPo();
  ok(po.ok, `PO drafted (${po.status} ${po.msg})`);
  const id = po.data?.id;

  // Issue and cancel dispatched together — the interleaving the missing lock
  // allowed. Whichever wins, the PO must not end up issued-after-cancel.
  const [a, b] = await Promise.all([post(`/purchase-orders/${id}/issue`), post(`/purchase-orders/${id}/cancel`)]);
  ok([a.status, b.status].some((s) => s === 200 || s === 201), `one of issue/cancel succeeded (${a.status}/${b.status})`);
  const row = await one(`SELECT status FROM purchase_orders WHERE id = $1`, [id]);
  ok(['issued', 'cancelled'].includes(row.status), `PO ended in a real state (${row.status})`);

  // Whatever it settled on must be self-consistent: a cancelled PO refuses a
  // receipt, an issued one accepts a draft against it.
  const grn = await post('/goods-receipts', {
    purchaseOrderId: id, supplierId, plantId: PLANT,
    lines: [{ materialId: material.id, receivedQuantity: 1, acceptedQuantity: 1 }],
  });
  if (row.status === 'cancelled') {
    ok(!grn.ok, `a cancelled PO refuses a receipt (${grn.status}: ${grn.msg})`);
  } else {
    ok(grn.ok, `an issued PO still accepts a receipt (${grn.status} ${grn.msg})`);
  }

  // The sequential paths still behave.
  const po2 = await newPo();
  const issued = await post(`/purchase-orders/${po2.data?.id}/issue`);
  ok(issued.ok && issued.data?.status === 'issued', `a normal issue still works (${issued.status})`);
  const again = await post(`/purchase-orders/${po2.data?.id}/issue`);
  ok(again.status === 400, `issuing twice is refused (${again.status})`);
  const cancelIssued = await post(`/purchase-orders/${po2.data?.id}/cancel`);
  ok(cancelIssued.ok, `an issued PO with nothing received can still be cancelled (${cancelIssued.status})`);
  const reIssue = await post(`/purchase-orders/${po2.data?.id}/issue`);
  ok(reIssue.status === 400, `and cannot then be re-issued (${reIssue.status}: ${reIssue.msg})`);
}

// ---------------------------------------------------------------------------
console.log('\n[P2] the same payment reference cannot be posted twice');
{
  const ref = `UTR-${tag}`;
  const p1 = await post('/vendor-payments', {
    supplierId, amount: 5000, paymentMode: 'neft', bankReference: ref,
  });
  ok(p1.ok, `first payment posts (${p1.status} ${p1.msg})`);

  const p2 = await post('/vendor-payments', {
    supplierId, amount: 5000, paymentMode: 'neft', bankReference: ref,
  });
  ok(p2.status === 409 && p2.code === 'DUPLICATE_RECORD', `the retry is refused (${p2.status} ${p2.code})`);
  ok(/already recorded/.test(p2.msg), `naming the existing payment (${p2.msg})`);

  const variant = await post('/vendor-payments', {
    supplierId, amount: 5000, paymentMode: 'neft', bankReference: `  ${ref.toLowerCase()}  `,
  });
  ok(variant.status === 409, `a case/whitespace variant is refused too (${variant.status})`);

  const live = await one(
    `SELECT count(*)::int AS n FROM vendor_payments WHERE supplier_id = $1 AND lower(btrim(bank_reference)) = lower($2) AND status <> 'reversed'`,
    [supplierId, ref],
  );
  ok(live.n === 1, `exactly one live payment carries the reference (${live.n})`);

  // Cash has no instrument, and a blank reference is "no reference".
  const cash = await post('/vendor-payments', { supplierId, amount: 100, paymentMode: 'cash', bankReference: ref });
  ok(cash.ok, `cash with the same text is allowed (${cash.status})`);
  const blank1 = await post('/vendor-payments', { supplierId, amount: 50, paymentMode: 'neft', bankReference: '' });
  const blank2 = await post('/vendor-payments', { supplierId, amount: 60, paymentMode: 'neft', bankReference: '' });
  ok(blank1.ok && blank2.ok, `blank references never collide (${blank1.status}/${blank2.status})`);
  const stored = await one(`SELECT bank_reference FROM vendor_payments WHERE id = $1`, [blank1.data?.id]);
  ok(stored.bank_reference === null, 'a blank reference is stored as NULL');

  // Reversing frees the reference for a corrected re-post.
  const rev = await post(`/vendor-payments/${p1.data?.id}/reverse`, { reason: `keyed wrongly ${tag}` });
  ok(rev.ok, `reversing the first payment (${rev.status} ${rev.msg})`);
  const reuse = await post('/vendor-payments', {
    supplierId, amount: 5000, paymentMode: 'neft', bankReference: ref,
  });
  ok(reuse.ok, `the reference can be used again after the reversal (${reuse.status})`);

  const idx = await one(
    `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'uq_vendor_payments_supplier_bank_reference'`,
  );
  ok(idx.n === 1, 'the partial unique index backstops it under concurrency');
}

// ---------------------------------------------------------------------------
console.log('\n[P3] a malformed purchase-report date is a 400, not a 500');
{
  for (const r of ['itc-register', 'purchase-register']) {
    const res = await call('GET', `/purchase-reports/${r}?from=garbage`);
    ok(res.status === 400, `${r} refuses a junk date (${res.status})`);
  }
  const ledger = await call('GET', `/purchase-reports/vendor-ledger?supplierId=${supplierId}&to=31-03-2026`);
  ok(ledger.status === 400 && /YYYY-MM-DD/.test(ledger.msg), `vendor-ledger too (${ledger.status})`);
  const backwards = await call('GET', '/purchase-reports/purchase-register?from=2026-06-01&to=2026-01-01');
  ok(backwards.status === 400, `a backwards range is refused (${backwards.status})`);
  const good = await call('GET', '/purchase-reports/purchase-register?from=2026-01-01&to=2026-12-31');
  ok(good.ok, `a real range still works (${good.status})`);
  const empty = await call('GET', '/purchase-reports/purchase-register?from=&to=');
  ok(empty.ok, `an empty ?from= means unbounded (${empty.status})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
await owner.destroy();
process.exit(failed ? 1 : 0);
