/**
 * State-machine lock/guard races (data-integrity items I11, I12, I13, I15, I25).
 *
 * Every write path here used to be read-then-write without a row lock or a
 * conditional UPDATE, so two concurrent requests both saw the pre-state and the
 * later one silently won. Each scenario fires two conflicting requests at once
 * (or seeds the half-applied state directly) and checks that exactly one wins
 * and the final rows are mutually consistent. Rows are seeded via the owner
 * role (bypasses RLS) with only their NOT NULL columns.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
if (!TENANT) { console.error('TEST_TENANT_ID required'); process.exit(1); }

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
  return { status: res.status, ok: res.ok, json, msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const del = (path) => call('DELETE', path);
const tag = Date.now().toString(36);

// ───────────────────────── I11 — approval decide race ─────────────────────────
console.log('\n[I11] approval decision: approve vs reject at once');
{
  const id = randomUUID();
  await q(
    `INSERT INTO agent_approval_requests (id, tenant_id, agent_name, action_kind, title, status)
     VALUES ($1, $2, 'automation', 'state_lock_probe', 'race probe', 'pending')`,
    [id, TENANT],
  );
  const [a, b] = await Promise.all([
    post(`/agents/approvals/${id}/decide`, { decision: 'approved' }),
    post(`/agents/approvals/${id}/decide`, { decision: 'rejected', reason: 'race' }),
  ]);
  const wins = [a, b].filter((r) => r.ok).length;
  ok(wins === 1, `exactly one of two concurrent decisions wins (${a.status}/${b.status})`);
  ok([a, b].some((r) => r.status === 409), 'the loser is told 409 ALREADY_DECIDED');
  const row = await one(`SELECT status FROM agent_approval_requests WHERE id = $1`, [id]);
  const winner = a.ok ? 'approved' : 'rejected';
  ok(row.status === winner, `stored decision is the winner's (${row.status})`);
  const again = await post(`/agents/approvals/${id}/decide`, { decision: 'approved' });
  ok(again.status === 409, 'a later re-decision is refused');
}

// ───────────────── I12 — credit-hold approve vs order cancel ─────────────────
console.log('\n[I12] credit hold: approve racing the order cancel');
async function seedHold(orderStatus = 'credit_hold') {
  const orderId = randomUUID();
  const holdId = randomUUID();
  await q(
    `INSERT INTO orders (id, tenant_id, order_no, order_status) VALUES ($1, $2, $3, $4)`,
    [orderId, TENANT, `SL-ORD-${tag}-${orderId.slice(0, 4)}`, orderStatus],
  );
  await q(
    `INSERT INTO credit_hold_requests (id, tenant_id, order_id, status, requested_amount) VALUES ($1, $2, $3, 'pending', 1000)`,
    [holdId, TENANT, orderId],
  );
  return { orderId, holdId };
}
{
  const h = await seedHold();
  const [ap, cn] = await Promise.all([
    post(`/credit-holds/${h.holdId}/approve`, { note: 'race' }),
    post(`/orders/${h.orderId}/cancel`, { reason: 'race' }),
  ]);
  const o = await one(`SELECT order_status FROM orders WHERE id = $1`, [h.orderId]);
  const hd = await one(`SELECT status FROM credit_hold_requests WHERE id = $1`, [h.holdId]);
  ok(ap.ok || cn.ok, `at least one of approve/cancel succeeded (${ap.status}/${cn.status})`);
  if (cn.ok) ok(o.order_status === 'cancelled', `cancel succeeded → order ends cancelled (${o.order_status})`);
  else ok(o.order_status === 'confirmed' && hd.status === 'approved', `only approve succeeded → confirmed/approved (${o.order_status}/${hd.status})`);
  ok(!(o.order_status === 'confirmed' && hd.status === 'cancelled'), 'never a confirmed order with a cancelled hold');
  ok(!(o.order_status === 'cancelled' && hd.status === 'pending'), 'never a cancelled order with a pending hold');

  // Deterministic: the order is cancelled first, then the approver decides.
  const h2 = await seedHold();
  const c2 = await post(`/orders/${h2.orderId}/cancel`, { reason: 'first' });
  ok(c2.ok, 'cancel of a credit_hold order succeeds');
  const a2 = await post(`/credit-holds/${h2.holdId}/approve`, { note: 'late' });
  ok(a2.status === 400, `approving the hold of a cancelled order is refused (${a2.status}: ${a2.msg})`);
  const o2 = await one(`SELECT order_status FROM orders WHERE id = $1`, [h2.orderId]);
  ok(o2.order_status === 'cancelled', 'the cancelled order was not revived to confirmed');

  // Deterministic: a pending hold whose order is no longer on credit hold.
  const h3 = await seedHold('draft');
  const r3 = await post(`/credit-holds/${h3.holdId}/reject`, { note: 'stale' });
  ok(r3.status === 400, `deciding a hold whose order is not on credit hold is refused (${r3.status})`);
  const hd3 = await one(`SELECT status FROM credit_hold_requests WHERE id = $1`, [h3.holdId]);
  ok(hd3.status === 'pending', 'the stale hold row is left untouched');
}

// ──────────── I12 — dispatch reject vs challan deliver on the same load ────────────
console.log('\n[I12] dispatch board: reject racing the challan delivery');
async function seedLoad(dispatchStatus, challanStatus) {
  const dispatchId = randomUUID();
  const challanId = randomUUID();
  await q(
    `INSERT INTO dispatches (id, tenant_id, dispatch_no, dispatch_status, quantity_m3) VALUES ($1, $2, $3, $4, 6)`,
    [dispatchId, TENANT, `SL-DSP-${tag}-${dispatchId.slice(0, 4)}`, dispatchStatus],
  );
  await q(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, challan_status, dispatch_id, quantity_m3) VALUES ($1, $2, $3, $4, $5, 6)`,
    [challanId, TENANT, `SL-DC-${tag}-${challanId.slice(0, 4)}`, challanStatus, dispatchId],
  );
  return { dispatchId, challanId };
}
{
  const L = await seedLoad('reached_site', 'issued');
  const [rej, dlv] = await Promise.all([
    post(`/dispatches/${L.dispatchId}/status`, { status: 'rejected', note: 'race' }),
    post(`/delivery-challans/${L.challanId}/deliver`, { receiverName: 'Site engineer' }),
  ]);
  const d = await one(`SELECT dispatch_status FROM dispatches WHERE id = $1`, [L.dispatchId]);
  const c = await one(`SELECT challan_status FROM delivery_challans WHERE id = $1`, [L.challanId]);
  ok(rej.ok !== dlv.ok, `exactly one of reject/deliver wins (${rej.status}/${dlv.status})`);
  ok(
    (d.dispatch_status === 'rejected' && c.challan_status === 'issued')
      || (d.dispatch_status === 'completed' && c.challan_status === 'delivered'),
    `dispatch/challan end consistent (${d.dispatch_status}/${c.challan_status})`,
  );

  // Deterministic: the challan is already delivered → the load cannot be rejected/cancelled.
  const L2 = await seedLoad('reached_site', 'delivered');
  const r2 = await post(`/dispatches/${L2.dispatchId}/status`, { status: 'rejected' });
  ok(r2.status === 400 && /delivered challan/i.test(r2.msg), `rejecting a load with a delivered challan is refused (${r2.status}: ${r2.msg})`);
  const x2 = await post(`/dispatches/${L2.dispatchId}/status`, { status: 'cancelled' });
  ok(x2.status === 400, 'cancelling it is refused too');
  const p2 = await post(`/dispatches/${L2.dispatchId}/status`, { status: 'pouring' });
  ok(p2.ok, 'a forward move on the same load still works');
  const d2 = await one(`SELECT dispatch_status FROM dispatches WHERE id = $1`, [L2.dispatchId]);
  ok(d2.dispatch_status === 'pouring', 'dispatch advanced to pouring');
}

// ───────────────── I13 — batch queue cap re-applied at confirm ─────────────────
console.log('\n[I13] batch ticket confirm: queue cap under lock; cancel recompute');
async function seedQueue(planned, produced, status) {
  const id = randomUUID();
  await q(
    `INSERT INTO batch_queue (id, tenant_id, planned_quantity_m3, produced_quantity_m3, queue_status) VALUES ($1, $2, $3, $4, $5)`,
    [id, TENANT, planned, produced, status],
  );
  return id;
}
async function seedTicket(queueId, qty, status) {
  const id = randomUUID();
  await q(
    `INSERT INTO batch_tickets (id, tenant_id, batch_ticket_no, status, batch_queue_id, batch_quantity_m3) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, TENANT, `SL-BT-${tag}-${id.slice(0, 4)}`, status, queueId, qty],
  );
  return id;
}
{
  const queue = await seedQueue(12, 8, 'batching');
  const over = await seedTicket(queue, 6, 'draft');
  const fits = await seedTicket(queue, 4, 'draft');
  const c1 = await post(`/batch-tickets/${over}/confirm`, {});
  ok(c1.status === 400 && /planned/i.test(c1.msg), `a ticket that would overshoot the plan is refused (${c1.status}: ${c1.msg})`);
  const c2 = await post(`/batch-tickets/${fits}/confirm`, {});
  ok(c2.status === 400 && !/planned/i.test(c2.msg), `a ticket within the remaining plan passes the cap (${c2.status}: ${c2.msg})`);
  const qrow = await one(`SELECT produced_quantity_m3::float AS p, queue_status FROM batch_queue WHERE id = $1`, [queue]);
  ok(qrow.p === 8 && qrow.queue_status === 'batching', 'queue line untouched by the refusals');

  // Cancel: only a draft; a completed line is not reset to waiting.
  const done = await seedQueue(12, 12, 'completed');
  const confirmed = await seedTicket(done, 12, 'confirmed');
  const stray = await seedTicket(done, 3, 'draft');
  const x1 = await post(`/batch-tickets/${confirmed}/cancel`, {});
  ok(x1.status === 400, `cancelling a confirmed ticket is refused (${x1.status})`);
  const x2 = await post(`/batch-tickets/${stray}/cancel`, {});
  ok(x2.ok, 'cancelling a stray draft on a completed line succeeds');
  const drow = await one(`SELECT queue_status FROM batch_queue WHERE id = $1`, [done]);
  ok(drow.queue_status === 'completed', `the completed line stays completed (${drow.queue_status})`);
  const x3 = await post(`/batch-tickets/${stray}/cancel`, {});
  ok(x3.status === 400, 'cancelling an already-cancelled ticket is refused');

  // Cancel on a live line: falls back to waiting only when nothing is left.
  const live = await seedQueue(10, 0, 'batching');
  const t1 = await seedTicket(live, 5, 'draft');
  const t2 = await seedTicket(live, 5, 'draft');
  await post(`/batch-tickets/${t1}/cancel`, {});
  const l1 = await one(`SELECT queue_status FROM batch_queue WHERE id = $1`, [live]);
  ok(l1.queue_status === 'batching', `line with another live ticket stays batching (${l1.queue_status})`);
  await post(`/batch-tickets/${t2}/cancel`, {});
  const l2 = await one(`SELECT queue_status FROM batch_queue WHERE id = $1`, [live]);
  ok(l2.queue_status === 'waiting', `empty line returns to waiting (${l2.queue_status})`);
}

// ───────────────── I15 — approved mix design is a record ─────────────────
console.log('\n[I15] mix design: approved recipe cannot be edited or rejected in place');
{
  const designId = randomUUID();
  const rowId = randomUUID();
  await q(
    `INSERT INTO mix_designs (id, tenant_id, mix_code, approval_status) VALUES ($1, $2, $3, 'approved')`,
    [designId, TENANT, `SL-MIX-${tag}`],
  );
  await q(
    `INSERT INTO mix_design_materials (id, tenant_id, mix_design_id, material_label, target_quantity) VALUES ($1, $2, $3, 'Cement', 350)`,
    [rowId, TENANT, designId],
  );
  const d1 = await del(`/mix-designs/${designId}/materials/${rowId}`);
  ok(d1.status === 400 && /locked/i.test(d1.msg), `deleting a material from an approved design is refused (${d1.status}: ${d1.msg})`);
  const still = await one(`SELECT count(*)::int AS n FROM mix_design_materials WHERE id = $1`, [rowId]);
  ok(still.n === 1, 'the material row is still there');
  const r1 = await post(`/mix-designs/${designId}/reject`, {});
  ok(r1.status === 400, `rejecting an approved design in place is refused (${r1.status}: ${r1.msg})`);
  const st = await one(`SELECT approval_status FROM mix_designs WHERE id = $1`, [designId]);
  ok(st.approval_status === 'approved', 'design stays approved');

  const draftId = randomUUID();
  await q(`INSERT INTO mix_designs (id, tenant_id, mix_code, approval_status) VALUES ($1, $2, $3, 'draft')`, [draftId, TENANT, `SL-MIXD-${tag}`]);
  const r2 = await post(`/mix-designs/${draftId}/reject`, {});
  ok(r2.ok, 'rejecting a draft design works');
  const r3 = await post(`/mix-designs/${draftId}/reject`, {});
  ok(r3.status === 400, 'rejecting it twice is refused');
}

// ───────────────── I25 — QC cube results double-submit ─────────────────
console.log('\n[I25] QC cube set: two result submissions at once');
{
  const setId = randomUUID();
  await q(
    `INSERT INTO qc_cube_sets (id, tenant_id, set_no, cast_date, target_strength_mpa, specimen_count) VALUES ($1, $2, $3, current_date - 28, 30, 3)`,
    [setId, TENANT, `SL-CUBE-${tag}`],
  );
  const results = [1, 2, 3].map((n) => ({ specimenNo: n, testAgeDays: 28, compressiveStrengthMpa: 34 + n }));
  const [s1, s2] = await Promise.all([
    post(`/qc/cube-sets/${setId}/results`, { results }),
    post(`/qc/cube-sets/${setId}/results`, { results }),
  ]);
  ok(s1.ok !== s2.ok, `exactly one submission is accepted (${s1.status}/${s2.status})`);
  const n = await one(`SELECT count(*)::int AS n FROM qc_cube_results WHERE cube_set_id = $1`, [setId]);
  ok(n.n === 3, `the set holds exactly its 3 cast specimens (${n.n})`);
  const set = await one(`SELECT acceptance_status FROM qc_cube_sets WHERE id = $1`, [setId]);
  ok(set.acceptance_status === 'accepted', `verdict assessed once on the full sample (${set.acceptance_status})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
