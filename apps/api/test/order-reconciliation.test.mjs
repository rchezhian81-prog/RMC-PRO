/**
 * Ordered, batched, delivered — the order book and the order detail agree.
 *
 * The defect this pins: the book summed delivered challans (net of returns);
 * the detail summed confirmed batch tickets and called it "Delivered". Between
 * a ticket being confirmed and its challan being delivered — every load, for
 * an hour or two — the two screens disagreed about how much of the order was
 * left, and after a return they disagreed permanently.
 *
 * Drives the real chain (quotation → order → queue → ticket → confirm →
 * dispatch → challan → deliver with a return) and checks both screens at the
 * two moments that used to differ. Env: API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
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
if (!LOGIN || !PASSWORD) { console.log('(skipping order-reconciliation — LOGIN/RMC_PASSWORD not set)'); process.exit(0); }

console.log('=== ordered / batched / delivered: book and detail agree ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present (grade/plant/mix/customer)', !!(grade && plant && mix && customer));
const TODAY = new Date().toISOString().slice(0, 10);
const QTY = 8;
const RETURN = 1.5;
const RATE = 4800;

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
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'reconciliation test auto-release' });
  order = await api('GET', `/orders/${order.id}`);
}
ok('order confirmed', String(order.orderStatus) === 'confirmed');

const detail = () => api('GET', `/orders/${order.id}`);
const bookRow = async () => ((await api('GET', '/orders/order-book')).rows ?? []).find((r) => String(r.orderNo) === String(order.orderNo));

console.log('\n[0] nothing made yet');
{
  const d = await detail(); const b = await bookRow();
  ok('detail: ordered = QTY, nothing batched or delivered', near(d.quantities.orderedM3, QTY) && near(d.quantities.batchedM3, 0) && near(d.quantities.deliveredM3, 0));
  ok('book: same', !!b && near(b.ordered, QTY) && near(b.batched, 0) && near(b.delivered, 0) && near(b.balance, QTY));
}

const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: QTY, mixDesignId: mix.id });
await api('POST', `/batch-tickets/${ticket.id}/actuals`, {
  materials: ticket.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
});
ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
ok('batch ticket confirmed', ticket.status === 'confirmed');

console.log('\n[1] batched, on the road — the moment the two screens used to disagree');
{
  const d = await detail(); const b = await bookRow();
  ok('detail: batched = QTY, delivered = 0, balance = QTY, pending = QTY',
    near(d.quantities.batchedM3, QTY) && near(d.quantities.deliveredM3, 0) && near(d.quantities.balanceM3, QTY) && near(d.quantities.pendingDeliveryM3, QTY));
  ok('detail pour summary: Delivered is 0 (it used to show the batched figure here)', near(d.pourSummary.delivered, 0) && near(d.pourSummary.batched, QTY));
  ok('detail line: batched QTY, delivered 0, balance QTY', near(d.items[0].batchedM3, QTY) && near(d.items[0].deliveredM3, 0) && near(d.items[0].balanceM3, QTY));
  ok('book agrees with detail', !!b && near(b.batched, d.quantities.batchedM3) && near(b.delivered, d.quantities.deliveredM3) && near(b.balance, d.quantities.balanceM3) && near(b.pending, QTY));
}

const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {});
let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, {});
challan = await api('POST', `/delivery-challans/${challan.id}/issue`);
await api('POST', `/delivery-challans/${challan.id}/deliver`, { receiverName: 'Site Engineer', returnQuantityM3: RETURN, returnReason: 'excess_ordered' });

console.log('\n[2] delivered with concrete returned');
{
  const d = await detail(); const b = await bookRow();
  const net = QTY - RETURN;
  ok(`detail: delivered ${net} net, returned ${RETURN}, balance ${RETURN}, pending 0`,
    near(d.quantities.deliveredM3, net) && near(d.quantities.returnedM3, RETURN) && near(d.quantities.balanceM3, RETURN) && near(d.quantities.pendingDeliveryM3, 0));
  ok('detail pour summary: Delivered is the net delivered figure', near(d.pourSummary.delivered, net) && near(d.pourSummary.returned, RETURN));
  ok('detail line agrees', near(d.items[0].deliveredM3, net) && near(d.items[0].balanceM3, RETURN));
  ok('book agrees with detail, figure for figure',
    !!b && near(b.batched, QTY) && near(b.delivered, net) && near(b.returned, RETURN) && near(b.balance, RETURN) && near(b.pending, 0));
}

console.log(`\nORDER RECONCILIATION TEST: ${pass} passed`);
process.exit(0);
