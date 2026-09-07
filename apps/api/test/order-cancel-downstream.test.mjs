/**
 * Order cancel vs live downstream (data-integrity item I14).
 *
 * Policy: concrete in flight (a confirmed batch never dispatched, or a dispatch
 * on the road) blocks the cancel — deliver it or reject it as wastage first.
 * Harmless leftovers (waiting queue lines, draft tickets, draft challans) are
 * cancelled with the order in the same transaction. Every downstream create
 * (ticket from queue, dispatch from ticket, challan from dispatch) refuses a
 * cancelled order.
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
const grade = await one(`SELECT id, grade_code FROM concrete_grades WHERE tenant_id = $1 ORDER BY grade_code LIMIT 1`, [TENANT]);

async function seedOrder(status = 'confirmed') {
  const id = randomUUID();
  await q(`INSERT INTO orders (id, tenant_id, order_no, order_status) VALUES ($1, $2, $3, $4)`, [id, TENANT, `OC-${tag}-${id.slice(0, 4)}`, status]);
  await q(`INSERT INTO order_items (id, tenant_id, order_id, grade_id, grade_label, quantity_m3) VALUES ($1, $2, $3, $4, $5, 12)`, [randomUUID(), TENANT, id, grade.id, grade.grade_code]);
  return id;
}
const seedQueue = async (orderId, status) => { const id = randomUUID(); await q(`INSERT INTO batch_queue (id, tenant_id, plant_id, order_id, grade_id, grade_label, planned_quantity_m3, produced_quantity_m3, queue_status) VALUES ($1, $2, $3, $4, $5, $6, 6, 0, $7)`, [id, TENANT, PLANT, orderId, grade.id, grade.grade_code, status]); return id; };
const seedTicket = async (orderId, status) => { const id = randomUUID(); await q(`INSERT INTO batch_tickets (id, tenant_id, plant_id, batch_ticket_no, status, order_id, grade_id, grade_label, batch_quantity_m3) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 6)`, [id, TENANT, PLANT, `OC-BT-${tag}-${id.slice(0, 4)}`, status, orderId, grade.id, grade.grade_code]); return id; };
const seedDispatch = async (orderId, ticketId, status) => { const id = randomUUID(); await q(`INSERT INTO dispatches (id, tenant_id, dispatch_no, dispatch_status, order_id, batch_ticket_id, quantity_m3) VALUES ($1, $2, $3, $4, $5, $6, 6)`, [id, TENANT, `OC-DSP-${tag}-${id.slice(0, 4)}`, status, orderId, ticketId]); return id; };
const seedChallan = async (orderId, dispatchId, status) => { const id = randomUUID(); await q(`INSERT INTO delivery_challans (id, tenant_id, challan_no, challan_status, order_id, dispatch_id, quantity_m3) VALUES ($1, $2, $3, $4, $5, $6, 6)`, [id, TENANT, `OC-DC-${tag}-${id.slice(0, 4)}`, status, orderId, dispatchId]); return id; };
const orderStatus = async (id) => (await one(`SELECT order_status FROM orders WHERE id = $1`, [id])).order_status;

console.log('\n[I14] concrete in flight blocks the cancel');
{
  const O = await seedOrder();
  const confirmedUndispatched = await seedTicket(O, 'confirmed');
  const c1 = await post(`/orders/${O}/cancel`, { reason: 'customer backed out' });
  ok(c1.status === 400 && /in flight/i.test(c1.msg), `confirmed, never-dispatched batch blocks the cancel (${c1.status}: ${c1.msg})`);
  ok((await orderStatus(O)) === 'confirmed', 'order stays confirmed');
  // The load is rejected as wastage → the ticket has been dealt with.
  const rejected = await seedDispatch(O, confirmedUndispatched, 'rejected');
  // Leftovers that must go with the order:
  const waiting = await seedQueue(O, 'waiting');
  const doneQ = await seedQueue(O, 'completed');
  const draftT = await seedTicket(O, 'draft');
  const draftC = await seedChallan(O, rejected, 'draft');
  const c2 = await post(`/orders/${O}/cancel`, { reason: 'customer backed out' });
  ok(c2.ok, `once the load is dealt with, the cancel succeeds (${c2.status} ${c2.msg})`);
  ok((await orderStatus(O)) === 'cancelled', 'order is cancelled');
  ok((await one(`SELECT queue_status FROM batch_queue WHERE id = $1`, [waiting])).queue_status === 'cancelled', 'waiting queue line cancelled with the order');
  ok((await one(`SELECT queue_status FROM batch_queue WHERE id = $1`, [doneQ])).queue_status === 'completed', 'completed queue line left alone');
  ok((await one(`SELECT status FROM batch_tickets WHERE id = $1`, [draftT])).status === 'cancelled', 'draft ticket cancelled with the order');
  ok((await one(`SELECT status FROM batch_tickets WHERE id = $1`, [confirmedUndispatched])).status === 'confirmed', 'confirmed (rejected-load) ticket left as the record of what was batched');
  ok((await one(`SELECT challan_status FROM delivery_challans WHERE id = $1`, [draftC])).challan_status === 'cancelled', 'draft challan cancelled with the order');
  const hist = await q(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [O]);
  ok(/1 queue line\(s\), 1 draft ticket\(s\), 1 draft challan\(s\)/.test(JSON.stringify(hist[0] ?? {})), 'the history note records what was swept');
}

console.log('\n[I14] a dispatch on the road blocks the cancel until it is delivered or rejected');
{
  const O = await seedOrder();
  const T = await seedTicket(O, 'confirmed');
  const D = await seedDispatch(O, T, 'loaded');
  const c1 = await post(`/orders/${O}/cancel`, {});
  ok(c1.status === 400 && /in flight/i.test(c1.msg), `live dispatch blocks the cancel (${c1.status})`);
  const rej = await post(`/dispatches/${D}/status`, { status: 'rejected', note: 'site refused' });
  ok(rej.ok, `dispatch rejected as wastage (${rej.status} ${rej.msg})`);
  const c2 = await post(`/orders/${O}/cancel`, {});
  ok(c2.ok, `cancel succeeds after the load is rejected (${c2.status} ${c2.msg})`);
}

console.log('\n[I14] nothing downstream can be created against a cancelled order');
{
  const O = await seedOrder('cancelled');
  const Q = await seedQueue(O, 'waiting');
  const fq = await post(`/batch-tickets/from-queue/${Q}`, { batchQuantityM3: 6 });
  ok(fq.status === 400 && /cancelled/i.test(fq.msg), `ticket from a queue line of a cancelled order is refused (${fq.status}: ${fq.msg})`);
  const T = await seedTicket(O, 'confirmed');
  const fd = await post(`/dispatches/from-batch-ticket/${T}`, {});
  ok(fd.status === 400 && /cancelled/i.test(fd.msg), `dispatch from a ticket of a cancelled order is refused (${fd.status}: ${fd.msg})`);
  const D = await seedDispatch(O, T, 'loaded');
  const fc = await post(`/delivery-challans/from-dispatch/${D}`, {});
  ok(fc.status === 400 && /cancelled/i.test(fc.msg), `challan from a dispatch of a cancelled order is refused (${fc.status}: ${fc.msg})`);
  ok((await one(`SELECT count(*)::int AS n FROM delivery_challans WHERE order_id = $1`, [O])).n === 0, 'no challan row was created');
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
