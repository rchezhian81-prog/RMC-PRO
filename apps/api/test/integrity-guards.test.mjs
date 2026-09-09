/**
 * Integrity guards (data-integrity items I8, I16, I17, I26, I28, I31, I34, I40).
 * Each block seeds the pre-state via the owner role and proves the guard.
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
const patch = (path, body = {}) => call('PATCH', path, body);
const del = (path) => call('DELETE', path);
const tag = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);

async function grade(code) {
  const existing = await one(`SELECT id FROM concrete_grades WHERE tenant_id = $1 AND grade_code = $2`, [TENANT, code]);
  if (existing) return existing.id;
  const id = randomUUID();
  await q(`INSERT INTO concrete_grades (id, tenant_id, grade_code, grade_name) VALUES ($1, $2, $3, $3)`, [id, TENANT, code]);
  return id;
}
const M25 = await grade('M25');
const M40 = await grade('M40');

// ───────────────────────── I8 — approved documents: items locked ─────────────────────────
console.log('\n[I8] approved rate contract / quotation: items are locked like the header');
{
  const RC = randomUUID(); const RCI = randomUUID();
  await q(`INSERT INTO rate_contracts (id, tenant_id, rate_contract_no, approval_status) VALUES ($1, $2, $3, 'approved')`, [RC, TENANT, `IG-RC-${tag}`]);
  await q(`INSERT INTO rate_contract_items (id, tenant_id, rate_contract_id, grade_id) VALUES ($1, $2, $3, $4)`, [RCI, TENANT, RC, M25]);
  const a = await post(`/rate-contracts/${RC}/items`, { gradeId: M40, ratePerM3: 4200 });
  const u = await patch(`/rate-contracts/${RC}/items/${RCI}`, { ratePerM3: 4200 });
  const d = await del(`/rate-contracts/${RC}/items/${RCI}`);
  ok(a.status === 400 && u.status === 400 && d.status === 400, `add/update/delete item on an approved contract are 400 (${a.status}/${u.status}/${d.status}: ${u.msg})`);
  ok((await one(`SELECT count(*)::int AS n FROM rate_contract_items WHERE rate_contract_id = $1`, [RC])).n === 1, 'the approved contract still has exactly its one item');

  const Q = randomUUID(); const QI = randomUUID();
  await q(`INSERT INTO quotations (id, tenant_id, quotation_no, approval_status, status) VALUES ($1, $2, $3, 'approved', 'active')`, [Q, TENANT, `IG-Q-${tag}`]);
  await q(`INSERT INTO quotation_items (id, tenant_id, quotation_id, grade_id) VALUES ($1, $2, $3, $4)`, [QI, TENANT, Q, M25]);
  const qa = await post(`/quotations/${Q}/items`, { gradeId: M40, ratePerM3: 4200 });
  const qu = await patch(`/quotations/${Q}/items/${QI}`, { ratePerM3: 4200 });
  const qd = await del(`/quotations/${Q}/items/${QI}`);
  ok(qa.status === 400 && qu.status === 400 && qd.status === 400, `add/update/delete item on an approved quotation are 400 (${qa.status}/${qu.status}/${qd.status})`);
  ok(/revision/i.test(qu.msg), `the refusal points at createRevision (${qu.msg})`);
}

// ───────────────────────── I28 — quotation status not client-writable; revision reopens ─────────────────────────
console.log('\n[I28] converted quotation: status cannot be PATCHed; a revision reopens it');
{
  const Q = randomUUID();
  await q(`INSERT INTO quotations (id, tenant_id, quotation_no, approval_status, status, revision_no) VALUES ($1, $2, $3, 'draft', 'converted', 1)`, [Q, TENANT, `IG-QC-${tag}`]);
  const p = await patch(`/quotations/${Q}`, { status: 'active', remarks: 'trying to reopen' });
  const row = await one(`SELECT status FROM quotations WHERE id = $1`, [Q]);
  ok(row.status === 'converted', `PATCH {status:'active'} is ignored — still converted (${p.status}, ${row.status})`);
  const rev = await post(`/quotations/${Q}/revisions`, { changeReason: 'second order' });
  ok(rev.ok, `revision created (${rev.status} ${rev.msg})`);
  const after = await one(`SELECT status, approval_status, revision_no FROM quotations WHERE id = $1`, [Q]);
  ok(after.status === 'active' && after.approval_status === 'draft' && Number(after.revision_no) === 2, `revision reopened the quote: active/draft/rev 2 (${after.status}/${after.approval_status}/${after.revision_no})`);
}

// ───────────────────────── I16 — production plan line: order line owns the grade ─────────────────────────
console.log('\n[I16] production plan line: the order line owns the grade');
{
  const O = randomUUID(); const OI = randomUUID();
  await q(`INSERT INTO orders (id, tenant_id, order_no, order_status) VALUES ($1, $2, $3, 'confirmed')`, [O, TENANT, `IG-ORD-${tag}`]);
  await q(`INSERT INTO order_items (id, tenant_id, order_id, grade_id, grade_label, quantity_m3) VALUES ($1, $2, $3, $4, 'M25', 10)`, [OI, TENANT, O, M25]);
  const plan = await post('/production-plans', { plantId: PLANT, planDate: TODAY, shift: 'day' });
  ok(plan.ok, `plan created (${plan.status} ${plan.msg})`);
  const P = plan.data?.id;
  const mismatch = await post(`/production-plans/${P}/items`, { orderId: O, orderItemId: OI, gradeId: M40, plannedQuantityM3: 5 });
  ok(mismatch.status === 400 && /does not match/i.test(mismatch.msg), `a gradeId differing from the order line is refused (${mismatch.status}: ${mismatch.msg})`);
  const notOnOrder = await post(`/production-plans/${P}/items`, { orderId: O, gradeId: M40, plannedQuantityM3: 500 });
  ok(notOnOrder.status === 400 && /not on the order/i.test(notOnOrder.msg), `a grade not on the order is refused instead of uncapped (${notOnOrder.status}: ${notOnOrder.msg})`);
  const good = await post(`/production-plans/${P}/items`, { orderId: O, orderItemId: OI, plannedQuantityM3: 5 });
  ok(good.ok, `a plain line plan succeeds (${good.status} ${good.msg})`);
  const li = await one(`SELECT grade_id FROM production_plan_items WHERE production_plan_id = $1`, [P]);
  ok(li?.grade_id === M25, 'the plan line carries the order line\'s grade');

  // ── D1-D4: a finished plan is a record, not a live worksheet ──
  // A queued line cannot simply be deleted — batch_queue FKs to it, and the
  // load is already on the floor.
  const enq = await post(`/production-plans/${P}/enqueue`);
  ok(enq.ok, `plan enqueued (${enq.status} ${enq.msg})`);
  const lineId = (await one(`SELECT id FROM production_plan_items WHERE production_plan_id = $1`, [P]))?.id;
  const delQueued = await del(`/production-plans/${P}/items/${lineId}`);
  ok(delQueued.status === 400 && /already queued/i.test(delQueued.msg),
    `deleting a queued line is refused with a reason, not an FK 500 (${delQueued.status}: ${delQueued.msg})`);

  // Cancelling the plan must actually end it.
  const cancelled = await post(`/production-plans/${P}/status`, { status: 'cancelled' });
  ok(cancelled.ok, `plan cancelled (${cancelled.status} ${cancelled.msg})`);
  const queuedBefore = await one(`SELECT count(*)::int AS n FROM batch_queue WHERE production_plan_item_id = $1`, [lineId]);

  const reEnqueue = await post(`/production-plans/${P}/enqueue`);
  ok(reEnqueue.status === 400 && /cannot be queued/i.test(reEnqueue.msg),
    `a cancelled plan cannot be enqueued (${reEnqueue.status}: ${reEnqueue.msg})`);
  const planAfter = await one(`SELECT status FROM production_plans WHERE id = $1`, [P]);
  ok(planAfter.status === 'cancelled', `and stays cancelled — enqueue used to write in_progress straight past the guard (${planAfter.status})`);
  const queuedAfter = await one(`SELECT count(*)::int AS n FROM batch_queue WHERE production_plan_item_id = $1`, [lineId]);
  ok(queuedAfter.n === queuedBefore.n, `with no new loads queued (${queuedBefore.n} → ${queuedAfter.n})`);

  const addAfter = await post(`/production-plans/${P}/items`, { orderId: O, orderItemId: OI, plannedQuantityM3: 1 });
  ok(addAfter.status === 400 && /cannot take new lines/i.test(addAfter.msg),
    `a cancelled plan takes no new lines (${addAfter.status})`);
  const delAfter = await del(`/production-plans/${P}/items/${lineId}`);
  ok(delAfter.status === 400 && /cannot have lines removed/i.test(delAfter.msg),
    `nor loses existing ones (${delAfter.status})`);
}

// ───────────────────────── I17 / I31 — GRN ↔ PO scoping and PO status re-check ─────────────────────────
console.log('\n[I17] goods receipt: PO lines must belong to the receipt\'s PO');
async function seedPo(status) {
  const id = randomUUID(); const item = randomUUID();
  await q(`INSERT INTO purchase_orders (id, tenant_id, po_no, status) VALUES ($1, $2, $3, $4)`, [id, TENANT, `IG-PO-${tag}-${id.slice(0, 4)}`, status]);
  await q(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, quantity) VALUES ($1, $2, $3, $4, 10)`, [item, TENANT, id, MATERIAL]);
  return { id, item };
}
{
  const po1 = await seedPo('issued');
  const po2 = await seedPo('issued');
  const line = (poItemId) => ({ purchaseOrderItemId: poItemId, materialId: MATERIAL, receivedQuantity: 5, acceptedQuantity: 5, rate: 10 });
  const cross = await post('/goods-receipts', { purchaseOrderId: po1.id, plantId: PLANT, receiptDate: TODAY, lines: [line(po2.item)] });
  ok(cross.status === 400 && /not found on this purchase order/i.test(cross.msg), `citing another PO's line is refused (${cross.status}: ${cross.msg})`);
  const dangling = await post('/goods-receipts', { purchaseOrderId: po1.id, plantId: PLANT, receiptDate: TODAY, lines: [line(randomUUID())] });
  ok(dangling.status === 400, `a dangling PO line id is refused (${dangling.status})`);
  const noPo = await post('/goods-receipts', { plantId: PLANT, receiptDate: TODAY, lines: [line(po1.item)] });
  ok(noPo.status === 400 && /names its purchase order/i.test(noPo.msg), `a PO line without the PO on the receipt is refused (${noPo.status}: ${noPo.msg})`);
  ok((await one(`SELECT received_quantity::float AS r FROM purchase_order_items WHERE id = $1`, [po2.item])).r === 0, 'PO-2 was never touched');

  const good = await post('/goods-receipts', { purchaseOrderId: po1.id, plantId: PLANT, receiptDate: TODAY, lines: [line(po1.item)] });
  ok(good.ok, `a receipt citing its own PO's line is created (${good.status} ${good.msg})`);
  console.log('\n[I31] PO cancel vs draft receipt; posting against a cancelled PO');
  const cancel = await post(`/purchase-orders/${po1.id}/cancel`);
  ok(cancel.status === 400 && /draft goods receipts/i.test(cancel.msg), `cancelling a PO with a draft receipt is refused (${cancel.status}: ${cancel.msg})`);

  const po3 = await seedPo('cancelled');
  const G = randomUUID();
  await q(`INSERT INTO goods_receipts (id, tenant_id, grn_no, purchase_order_id, plant_id, status) VALUES ($1, $2, $3, $4, $5, 'draft')`, [G, TENANT, `IG-GRN-${tag}`, po3.id, PLANT]);
  await q(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, received_quantity, accepted_quantity) VALUES ($1, $2, $3, $4, $5, 5, 5)`, [randomUUID(), TENANT, G, po3.item, MATERIAL]);
  const postIt = await post(`/goods-receipts/${G}/post`);
  ok(postIt.status === 400 && /cancelled purchase order/i.test(postIt.msg), `posting a draft receipt against a cancelled PO is refused (${postIt.status}: ${postIt.msg})`);
  ok((await one(`SELECT received_quantity::float AS r FROM purchase_order_items WHERE id = $1`, [po3.item])).r === 0, 'the cancelled PO acquired no received quantity');
  ok((await one(`SELECT status FROM goods_receipts WHERE id = $1`, [G])).status === 'draft', 'the receipt stays draft');
}

// ───────────────────────── I26 — GPS: latest fix only moves forward ─────────────────────────
console.log('\n[I26] GPS: an older buffered fix does not overwrite the latest position');
{
  const D = randomUUID();
  await q(`INSERT INTO dispatches (id, tenant_id, dispatch_no, dispatch_status) VALUES ($1, $2, $3, 'left_plant')`, [D, TENANT, `IG-DSP-${tag}`]);
  const t2 = new Date(Date.now() - 60_000).toISOString();
  const t1 = new Date(Date.now() - 180_000).toISOString();
  const newer = await post(`/gps/dispatches/${D}/ping`, { latitude: 13.0827, longitude: 80.2707, recordedAt: t2, speedKmph: 40 });
  ok(newer.ok, `newer fix recorded (${newer.status} ${newer.msg})`);
  const older = await post(`/gps/dispatches/${D}/ping`, { latitude: 13.0, longitude: 80.2, recordedAt: t1, speedKmph: 20 });
  ok(older.ok, 'older (buffered) fix is still accepted for the track');
  const d = await one(`SELECT last_latitude::float AS lat, last_location_at AS at, last_speed_kmph::float AS s FROM dispatches WHERE id = $1`, [D]);
  ok(Math.abs(d.lat - 13.0827) < 1e-6 && new Date(d.at).toISOString() === t2 && d.s === 40, `dispatch still shows the newer fix (${d.lat} @ ${new Date(d.at).toISOString()})`);
  ok((await one(`SELECT count(*)::int AS n FROM dispatch_location_pings WHERE dispatch_id = $1`, [D])).n === 2, 'both pings are on the track');
}

// ───────────────────────── I34 — weighbridge slip released on inward cancel ─────────────────────────
console.log('\n[I34] cancelling a weighbridge-derived draft inward releases the slip');
{
  const W = randomUUID();
  await q(`INSERT INTO weighbridge_entries (id, tenant_id, slip_no, status, material_id, net_weight) VALUES ($1, $2, $3, 'completed', $4, 5000)`, [W, TENANT, `IG-WB-${tag}`, MATERIAL]);
  const conv = await post(`/weighbridge/${W}/to-inward`, { rate: 10 });
  ok(conv.ok, `slip converted to a draft inward (${conv.status} ${conv.msg})`);
  const INW = conv.data?.inward?.id;
  ok((await one(`SELECT status FROM weighbridge_entries WHERE id = $1`, [W])).status === 'matched', 'slip is matched while the draft exists');
  const cancel = await post(`/material-inwards/${INW}/cancel`);
  ok(cancel.ok, `draft inward cancelled (${cancel.status} ${cancel.msg})`);
  ok((await one(`SELECT status FROM weighbridge_entries WHERE id = $1`, [W])).status === 'completed', 'slip released back to completed');
  const again = await post(`/weighbridge/${W}/to-inward`, { rate: 10 });
  ok(again.ok, `the slip can be converted again (${again.status} ${again.msg})`);
  ok((await one(`SELECT status FROM weighbridge_entries WHERE id = $1`, [W])).status === 'matched', 'and is matched once more');
}

// ───────────────────────── I40 — cube set fck agrees with the grade ─────────────────────────
console.log('\n[I40] cube set: fck reconciled with the grade; grade derived from the ticket');
{
  const bad = await post('/qc/cube-sets', { castDate: TODAY, gradeId: M25, targetStrengthMpa: 30, specimenCount: 3 });
  ok(bad.status === 400 && /does not match grade/i.test(bad.msg), `fck 30 on an M25 set is refused (${bad.status}: ${bad.msg})`);
  const good = await post('/qc/cube-sets', { castDate: TODAY, gradeId: M25, targetStrengthMpa: 25, specimenCount: 3 });
  ok(good.ok && Number(good.data?.targetStrengthMpa) === 25, `fck 25 on an M25 set is accepted (${good.status})`);
  const BT = randomUUID();
  await q(`INSERT INTO batch_tickets (id, tenant_id, batch_ticket_no, status, grade_id, grade_label) VALUES ($1, $2, $3, 'confirmed', $4, 'M25')`, [BT, TENANT, `IG-BT-${tag}`, M25]);
  const fromTicket = await post('/qc/cube-sets', { castDate: TODAY, batchTicketId: BT, specimenCount: 3 });
  ok(fromTicket.ok && fromTicket.data?.gradeId === M25 && Number(fromTicket.data?.targetStrengthMpa) === 25, `ticket-only set derives grade M25 and fck 25 (${fromTicket.status}: ${fromTicket.data?.gradeId}/${fromTicket.data?.targetStrengthMpa})`);
  const wrongForTicket = await post('/qc/cube-sets', { castDate: TODAY, batchTicketId: BT, targetStrengthMpa: 40, specimenCount: 3 });
  ok(wrongForTicket.status === 400, `fck 40 against an M25 ticket is refused (${wrongForTicket.status}: ${wrongForTicket.msg})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
