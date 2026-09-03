/**
 * Returned / short-load concrete & wastage integration test (Plan B3).
 *
 * Builds a real challan (quotation → order → queue → ticket → confirm →
 * dispatch → challan), then proves:
 *   - marking delivered with a returned quantity + reason values the returned
 *     concrete at the order's rate for the grade (auto-costed)
 *   - the challan records the reason, cost-per-m³ and total return cost
 *   - the wastage report rolls the return up by reason and grade
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD. The
 * `dispatch` module is a phase-1 module, always enabled. Reuses the
 * CUST-001/SITE-001/M25/SRE-P1/M25-STD fixtures the orchestrator seeds.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let TOKEN = '';
async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};
// A POST that reports success/failure instead of throwing — for firing two at once.
async function rawPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return res.ok && data?.success === true;
}

if (!LOGIN || !PASSWORD) {
  console.log('(skipping returned-concrete — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== returned / short-load concrete & wastage (deliver with return → cost → report) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present (grade/plant/mix/customer)', !!(grade && plant && mix && customer));

const TODAY = new Date().toISOString().slice(0, 10);
const QTY = 8;
const RATE = 4800;

// ---- Build a confirmed batch ticket via the real chain ----
let q = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: QTY, ratePerM3: RATE }],
});
await api('POST', `/quotations/${q.id}/submit`);
q = await api('POST', `/quotations/${q.id}/approve`);

let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'B3 test auto-release' });
  order = await api('GET', `/orders/${order.id}`);
}
ok('order confirmed', String(order.orderStatus) === 'confirmed');

const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: QTY, mixDesignId: mix.id });
const mats = ticket.materials;
await api('POST', `/batch-tickets/${ticket.id}/actuals`, {
  materials: mats.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
});
ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
ok('batch ticket confirmed', ticket.status === 'confirmed');

// ---- Dispatch → challan → issue ----
const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {});
let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, {});
challan = await api('POST', `/delivery-challans/${challan.id}/issue`);
ok('challan issued', challan.challanStatus === 'issued');

// ---- Mark delivered with a returned / short-load quantity + reason ----
const RETURN = 1.5;
const delivered = await api('POST', `/delivery-challans/${challan.id}/deliver`, {
  receiverName: 'Site Engineer', returnQuantityM3: RETURN, returnReason: 'excess_ordered',
});
ok('challan delivered', delivered.challanStatus === 'delivered');
// Delivering the challan closes the trip — the dispatch is completed and its
// pour-end time stamped, so the load drops off the live board.
const doneDispatch = await api('GET', `/dispatches/${dispatch.id}`);
ok('dispatch auto-completed on delivery', doneDispatch.dispatchStatus === 'completed');
ok('dispatch pour-end time stamped', !!doneDispatch.pourEndTime);
ok('returned quantity recorded', near(delivered.returnQuantityM3, RETURN));
ok('return reason recorded', delivered.returnReason === 'excess_ordered');
ok('return valued at the order rate for the grade', near(delivered.returnCostPerM3, RATE));
ok('return cost = qty × rate', near(delivered.returnCost, RETURN * RATE)); // 1.5 * 4800 = 7200

// ---- Wastage report reconciles ----
const report = await api('GET', '/delivery-challans/report/wastage');
ok('wastage report totals the returned volume', Number(report.totalReturnedM3) >= RETURN - 0.001);
ok('wastage report totals the wasted value', Number(report.totalReturnCost) >= RETURN * RATE - 0.01);
const reasonBucket = (report.byReason ?? []).find((b) => b.label === 'excess_ordered');
ok('wastage report buckets the reason', !!reasonBucket && Number(reasonBucket.cost) >= RETURN * RATE - 0.01);
const gradeBucket = (report.byGrade ?? []).find((b) => b.label === String(grade.gradeName));
ok('wastage report buckets the grade', !!gradeBucket);

// ---- Whole-load wastage: a rejected dispatch counts its full batched load ----
// A load rejected on site (or a dispatch cancelled after batching) never reaches
// a challan, but the concrete was produced — so the full batched quantity is
// wasted, valued at the order rate, and bucketed as "Rejected load".
async function confirmedDispatch(qty) {
  let qq = await api('POST', '/quotations', {
    customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
    items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: qty, ratePerM3: RATE }],
  });
  await api('POST', `/quotations/${qq.id}/submit`);
  qq = await api('POST', `/quotations/${qq.id}/approve`);
  let o = await api('POST', `/order-drafts/from-quotation/${qq.id}`, { plantId: plant.id, orderDate: TODAY });
  o = await api('POST', `/orders/${o.id}/confirm`);
  if (String(o.orderStatus) === 'credit_hold') {
    const holds = await api('GET', '/credit-holds?status=pending');
    const h = (Array.isArray(holds) ? holds : []).find((x) => String(x.orderId) === String(o.id));
    if (h) await api('POST', `/credit-holds/${h.id}/approve`, { note: 'B3 reject test' });
  }
  const qu = await api('POST', `/batch-queue/from-order/${o.id}`);
  const qid = (Array.isArray(qu) ? qu[0] : qu)?.id;
  let t = await api('POST', `/batch-tickets/from-queue/${qid}`, { batchQuantityM3: qty, mixDesignId: mix.id });
  await api('POST', `/batch-tickets/${t.id}/actuals`, {
    materials: t.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
  });
  t = await api('POST', `/batch-tickets/${t.id}/confirm`, {});
  return api('POST', `/dispatches/from-batch-ticket/${t.id}`, {});
}

const before = await api('GET', '/delivery-challans/report/wastage');
const beforeRejQty = Number((before.byReason ?? []).find((b) => b.label === 'Rejected load')?.quantityM3 ?? 0);
const beforeCost = Number(before.totalReturnCost);

const REJECT_QTY = 5;
const rejected = await confirmedDispatch(REJECT_QTY);
await api('POST', `/dispatches/${rejected.id}/status`, { status: 'rejected' });

const after = await api('GET', '/delivery-challans/report/wastage');
const rejBucket = (after.byReason ?? []).find((b) => b.label === 'Rejected load');
ok('rejected whole load appears as its own reason bucket', !!rejBucket);
ok('rejected load adds its full batched quantity', near(Number(rejBucket.quantityM3) - beforeRejQty, REJECT_QTY));
ok('rejected load valued at the order rate', near(Number(after.totalReturnCost) - beforeCost, REJECT_QTY * RATE)); // +5×4800 = 24000

// ---- Concurrency (Tier-A A3): one quotation → at most one order, even on a
// double-click. The quotation-row lock serializes concurrent converts. ----
let cq = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 6, ratePerM3: RATE }],
});
await api('POST', `/quotations/${cq.id}/submit`);
cq = await api('POST', `/quotations/${cq.id}/approve`);
const converts = await Promise.all([
  rawPost(`/order-drafts/from-quotation/${cq.id}`, { plantId: plant.id, orderDate: TODAY }),
  rawPost(`/order-drafts/from-quotation/${cq.id}`, { plantId: plant.id, orderDate: TODAY }),
]);
ok('exactly one of two concurrent quotation-converts succeeds', converts.filter(Boolean).length === 1);
ok('the quotation ends up converted exactly once', (await api('GET', `/quotations/${cq.id}`)).status === 'converted');

console.log(`\nRETURNED CONCRETE TEST: ${pass} passed ✓`);
process.exit(0);
