/**
 * Reversal paths (data-integrity items I18, I33).
 *
 * I18 — a DRAFT goods receipt can be cancelled; a POSTED one can be reversed:
 *       stock goes back out through the ledger (inward_reversal), PO lines and
 *       PO status rewind, a live vendor bill blocks it, and the PO becomes
 *       cancellable again.
 * I33 — an invoice write-off can be reversed, partially or fully, after which
 *       the invoice can be cancelled (cancel used to demand a reversal that did
 *       not exist).
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID, POSTGRES_*.
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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0005;

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, msg: json?.error?.message ?? json?.message ?? '' };
}
const tag = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);
const balance = async () => Number((await one(`SELECT COALESCE((SELECT current_quantity::float FROM stock_balances WHERE plant_id = $1 AND material_id = $2), 0) AS b`, [PLANT, MATERIAL])).b);

// ───────────────────────── I18 — GRN cancel / reverse ─────────────────────────
console.log('\n[I18] draft receipt cancel');
const SUP = randomUUID(); const PO = randomUUID(); const POI = randomUUID();
await q(`INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name) VALUES ($1, $2, $3, 'GRN Rev Supplier')`, [SUP, TENANT, `GR-${tag}`]);
await q(`INSERT INTO purchase_orders (id, tenant_id, po_no, status, supplier_id, plant_id) VALUES ($1, $2, $3, 'issued', $4, $5)`, [PO, TENANT, `GR-PO-${tag}`, SUP, PLANT]);
await q(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, quantity, received_quantity) VALUES ($1, $2, $3, $4, 10, 0)`, [POI, TENANT, PO, MATERIAL]);
const line = (qty) => ({ purchaseOrderItemId: POI, materialId: MATERIAL, receivedQuantity: qty, acceptedQuantity: qty, rate: 10 });
{
  const g = await post('/goods-receipts', { purchaseOrderId: PO, plantId: PLANT, receiptDate: TODAY, lines: [line(6)] });
  ok(g.ok, `draft receipt created (${g.status} ${g.msg})`);
  const c = await post(`/goods-receipts/${g.data?.id}/cancel`);
  ok(c.ok && c.data?.status === 'cancelled', `draft cancelled (${c.status} ${c.data?.status})`);
  const p = await post(`/goods-receipts/${g.data?.id}/post`);
  ok(p.status === 400, `a cancelled receipt cannot be posted (${p.status})`);
  const r = await post(`/goods-receipts/${g.data?.id}/reverse`, { reason: 'x' });
  ok(r.status === 400 && /posted receipt/i.test(r.msg), `a cancelled receipt cannot be reversed (${r.status}: ${r.msg})`);
}

console.log('\n[I18] posted receipt reverse: stock, PO line and PO status rewind');
{
  const before = await balance();
  const g = await post('/goods-receipts', { purchaseOrderId: PO, plantId: PLANT, receiptDate: TODAY, lines: [line(6)] });
  const G = g.data?.id;
  const p = await post(`/goods-receipts/${G}/post`);
  ok(p.ok, `receipt posted (${p.status} ${p.msg})`);
  ok(near(await balance(), before + 6), `stock +6 after post (${await balance()})`);
  let poi = await one(`SELECT received_quantity::float AS r FROM purchase_order_items WHERE id = $1`, [POI]);
  let po = await one(`SELECT status FROM purchase_orders WHERE id = $1`, [PO]);
  ok(near(poi.r, 6) && po.status === 'partially_received', `PO line 6 received, PO partially_received (${poi.r}/${po.status})`);
  const cancelPo = await post(`/purchase-orders/${PO}/cancel`);
  ok(cancelPo.status === 400 && /already received/i.test(cancelPo.msg), `PO cannot be cancelled while goods are received (${cancelPo.status})`);

  // A live vendor bill on this receipt blocks the reversal.
  const BILL = randomUUID();
  await q(`INSERT INTO vendor_bills (id, tenant_id, bill_no, supplier_id, goods_receipt_id, status, total_amount, paid_amount, outstanding_amount, payment_status) VALUES ($1, $2, $3, $4, $5, 'draft', 60, 0, 60, 'unpaid')`, [BILL, TENANT, `GR-VB-${tag}`, SUP, G]);
  const blocked = await post(`/goods-receipts/${G}/reverse`, { reason: 'only 4 t arrived' });
  ok(blocked.status === 400 && /vendor bill/i.test(blocked.msg), `reversal refused while a bill cites the receipt (${blocked.status}: ${blocked.msg})`);
  await q(`UPDATE vendor_bills SET status = 'cancelled' WHERE id = $1`, [BILL]);
  const rev = await post(`/goods-receipts/${G}/reverse`, { reason: 'only 4 t arrived' });
  ok(rev.ok && rev.data?.status === 'reversed', `reversal accepted once the bill is cancelled (${rev.status} ${rev.data?.status} ${rev.msg})`);
  ok(near(await balance(), before), `stock back to where it was (${await balance()})`);
  const led = await one(`SELECT transaction_type, out_quantity::float AS o FROM stock_transactions WHERE reference_id = $1 ORDER BY created_at DESC LIMIT 1`, [G]);
  ok(led?.transaction_type === 'inward_reversal' && near(led.o, 6), `ledger shows an inward_reversal of 6 (${led?.transaction_type} ${led?.o})`);
  poi = await one(`SELECT received_quantity::float AS r FROM purchase_order_items WHERE id = $1`, [POI]);
  po = await one(`SELECT status FROM purchase_orders WHERE id = $1`, [PO]);
  ok(near(poi.r, 0) && po.status === 'not_received', `PO line back to 0, PO not_received (${poi.r}/${po.status})`);
  const again = await post(`/goods-receipts/${G}/reverse`, { reason: 'twice' });
  ok(again.status === 400, `a reversed receipt cannot be reversed again (${again.status})`);
  const repost = await post(`/goods-receipts/${G}/post`);
  ok(repost.status === 400, `a reversed receipt cannot be re-posted (${repost.status})`);
  // The real delivery can now be booked, and the PO is cancellable again if it never comes.
  const g2 = await post('/goods-receipts', { purchaseOrderId: PO, plantId: PLANT, receiptDate: TODAY, lines: [line(4)] });
  const p2 = await post(`/goods-receipts/${g2.data?.id}/post`);
  ok(p2.ok, `the corrected 4 t receipt posts (${p2.status})`);
  const rev2 = await post(`/goods-receipts/${g2.data?.id}/reverse`, { reason: 'cleanup' });
  ok(rev2.ok, 'cleanup reversal ok');
  const cancelPo2 = await post(`/purchase-orders/${PO}/cancel`);
  ok(cancelPo2.ok, `with nothing received the PO can be cancelled again (${cancelPo2.status} ${cancelPo2.msg})`);
}

// ───────────────────────── I33 — write-off reversal ─────────────────────────
console.log('\n[I33] write-off can be reversed partially and fully; then the invoice can be cancelled');
{
  const C = randomUUID(); const INV = randomUUID();
  await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, 'Writeoff Co')`, [C, TENANT, `WO-${tag}`]);
  await q(`INSERT INTO invoices (id, tenant_id, invoice_no, customer_id, invoice_status, invoice_date, total_amount, amount_paid, written_off_amount, outstanding_amount, payment_status)
           VALUES ($1, $2, $3, $4, 'issued', $5, 1000, 0, 0, 1000, 'unpaid')`, [INV, TENANT, `WO-INV-${tag}`, C, TODAY]);
  const inv = () => one(`SELECT written_off_amount::float AS w, outstanding_amount::float AS o, payment_status AS s, invoice_status AS st FROM invoices WHERE id = $1`, [INV]);
  const none = await post(`/invoices/${INV}/writeoff/reverse`, { amount: 10 });
  ok(none.status === 400 && /no write-off/i.test(none.msg), `nothing to reverse yet (${none.status})`);
  const wo = await post(`/invoices/${INV}/writeoff`, { amount: 300, reason: 'dispute' });
  ok(wo.ok, `write-off 300 recorded (${wo.status} ${wo.msg})`);
  let i = await inv();
  ok(near(i.w, 300) && near(i.o, 700), `written off 300, outstanding 700 (${i.w}/${i.o})`);
  const tooMuch = await post(`/invoices/${INV}/writeoff/reverse`, { amount: 500 });
  ok(tooMuch.status === 400 && /exceeds/i.test(tooMuch.msg), `reversing more than was written off is refused (${tooMuch.status})`);
  const part = await post(`/invoices/${INV}/writeoff/reverse`, { amount: 100, reason: 'customer paid part' });
  ok(part.ok, `partial reversal accepted (${part.status} ${part.msg})`);
  i = await inv();
  ok(near(i.w, 200) && near(i.o, 800) && i.s === 'unpaid', `written off 200, outstanding 800, unpaid (${i.w}/${i.o}/${i.s})`);
  const cancelBlocked = await post(`/invoices/${INV}/cancel`, { reason: 'wrong customer' });
  ok(cancelBlocked.status === 400 && /write-off/i.test(cancelBlocked.msg), `cancel still blocked while a write-off remains (${cancelBlocked.status})`);
  const rest = await post(`/invoices/${INV}/writeoff/reverse`, { amount: 200 });
  ok(rest.ok, 'remaining write-off reversed');
  i = await inv();
  ok(near(i.w, 0) && near(i.o, 1000) && i.s === 'unpaid', `back to written off 0, outstanding 1000 (${i.w}/${i.o}/${i.s})`);
  const full = await post(`/invoices/${INV}/writeoff`, { amount: 1000, reason: 'bad debt' });
  const st = await inv();
  ok(full.ok && st.s === 'written_off' && near(st.o, 0), `full write-off marks the invoice written_off (${st.s})`);
  const undo = await post(`/invoices/${INV}/writeoff/reverse`, { amount: 1000, reason: 'recovered' });
  const st2 = await inv();
  ok(undo.ok && st2.s === 'unpaid' && near(st2.o, 1000), `full reversal returns it to unpaid (${st2.s}/${st2.o})`);
  const cancel = await post(`/invoices/${INV}/cancel`, { reason: 'wrong customer' });
  const st3 = await inv();
  ok(cancel.ok && st3.st === 'cancelled', `with the write-off gone the invoice can be cancelled (${cancel.status} ${cancel.msg})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
