/**
 * Pilot-gap regression tests (found in browser UAT):
 *
 *  BUG 1 — grade dropped on the Production-Plan path. A plan item added by
 *  orderId alone (no orderItemId) used to carry a null grade, so the queued load
 *  dead-ended at "No approved mix design available". These prove:
 *    - a single-line order planned by orderId carries the grade through to the
 *      queue, and a batch ticket starts WITHOUT an explicit mixDesignId;
 *    - a multi-line order planned by orderId fails clearly (never silently
 *      picks the wrong line / a grade-less plan).
 *
 *  BUG 2 — credit exposure was ex-GST. These prove the order stores a
 *  GST-inclusive value and the credit check's requested amount is GST-inclusive
 *  (the ex-GST display value is preserved).
 *
 *  BUG 3 — the rate-contract order path never set the GST-inclusive value (only
 *  the quotation path did), so a rate-contract order's credit exposure was
 *  undercounted by the whole GST component. Same proof, via from-rate-contract.
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1;

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

if (!LOGIN || !PASSWORD) {
  console.log('(skipping pilot-gaps — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== pilot gaps: production batching grade + GST-inclusive credit ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present (grade/plant/mix/customer)', !!(grade && plant && mix && customer));

const TODAY = new Date().toISOString().slice(0, 10);
const gl = String(grade.gradeCode);

async function approveQuotation(items) {
  let q = await api('POST', '/quotations', { customerId: customer.id, siteId: site?.id, quotationDate: TODAY, items });
  await api('POST', `/quotations/${q.id}/submit`);
  return api('POST', `/quotations/${q.id}/approve`);
}
async function approveRateContract(items) {
  const rc = await api('POST', '/rate-contracts', {
    customerId: customer.id, siteId: site?.id, validFrom: TODAY, validTo: TODAY, items,
  });
  await api('POST', `/rate-contracts/${rc.id}/submit`);
  await api('POST', `/rate-contracts/${rc.id}/approve`);
  return rc;
}
async function confirmOrder(orderId) {
  const order = await api('POST', `/orders/${orderId}/confirm`);
  if (String(order.orderStatus) === 'credit_hold') {
    const holds = await api('GET', '/credit-holds?status=pending');
    const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(orderId));
    if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'pilot-gaps auto-release' });
  }
  return api('GET', `/orders/${orderId}`);
}

// ---- BUG 1a: single-line order planned by orderId carries grade → batch ok ----
const q1 = await approveQuotation([{ gradeId: grade.id, gradeLabel: gl, estimatedQuantity: 6, ratePerM3: 4800, gstRate: '18' }]);
let o1 = await api('POST', `/order-drafts/from-quotation/${q1.id}`, { plantId: plant.id, orderDate: TODAY });
o1 = await confirmOrder(o1.id);
ok('single-line order confirmed', String(o1.orderStatus) === 'confirmed');

const plan1 = await api('POST', '/production-plans', { plantId: plant.id, planDate: TODAY, shift: 'day' });
// Add by orderId ONLY — no orderItemId, no grade. The fix must backfill the grade.
const plan1b = await api('POST', `/production-plans/${plan1.id}/items`, { orderId: o1.id, plannedQuantityM3: 6 });
const pItem = (plan1b.items || []).find((x) => String(x.orderId) === String(o1.id));
ok('plan item backfills grade from the single order line', !!pItem && String(pItem.gradeLabel || '') !== '');

await api('POST', `/production-plans/${plan1.id}/enqueue`);
const queue = await api('GET', '/batch-queue');
const qe = (Array.isArray(queue) ? queue : []).find(
  (x) => String(x.orderId) === String(o1.id) && String(x.queueStatus) === 'waiting',
);
ok('queue entry carries the grade', !!qe && String(qe.gradeLabel || '') !== '');

// Start the batch WITHOUT an explicit mixDesignId — auto-resolution by grade must work.
const ticket = await api('POST', `/batch-tickets/from-queue/${qe.id}`, { batchQuantityM3: 6 });
ok('batch ticket starts without an explicit mix design', !!ticket.id && !!ticket.mixDesignId);
ok('batch ticket carries the grade', String(ticket.gradeLabel || '') !== '');

// ---- BUG 1b: multi-line order planned by orderId fails clearly ----
const q2 = await approveQuotation([
  { gradeId: grade.id, gradeLabel: gl, estimatedQuantity: 6, ratePerM3: 4800, gstRate: '18' },
  { gradeId: grade.id, gradeLabel: gl, estimatedQuantity: 4, ratePerM3: 4800, gstRate: '18' },
]);
let o2 = await api('POST', `/order-drafts/from-quotation/${q2.id}`, { plantId: plant.id, orderDate: TODAY });
o2 = await confirmOrder(o2.id);
const plan2 = await api('POST', '/production-plans', { plantId: plant.id, planDate: TODAY, shift: 'day' });
let multiFailed = false, multiMsg = '';
try {
  await api('POST', `/production-plans/${plan2.id}/items`, { orderId: o2.id, plannedQuantityM3: 10 });
} catch (e) { multiFailed = true; multiMsg = String(e.message || e); }
ok('multi-line order without a specified line fails clearly (not silently)', multiFailed && /multiple lines/i.test(multiMsg));

// ---- BUG 2: credit exposure is GST-inclusive ----
const q3 = await approveQuotation([{ gradeId: grade.id, gradeLabel: gl, estimatedQuantity: 10, ratePerM3: 5000, transportCharge: 0, gstRate: '18' }]);
const o3 = await api('POST', `/order-drafts/from-quotation/${q3.id}`, { plantId: plant.id, orderDate: TODAY });
const o3full = await api('GET', `/orders/${o3.id}`);
ok('order preserves the ex-GST value for display', near(o3full.estimatedOrderValue, 50000));
ok('order stores the GST-inclusive value (50000 + 18%)', near(o3full.estimatedOrderValueInclGst, 59000));

const assess = await api('GET', `/orders/${o3.id}/credit-check`);
ok('credit requested amount is GST-inclusive', near(assess.requestedAmount, 59000));
ok('credit requested amount is NOT the ex-GST value', Number(assess.requestedAmount) > 50000);

// ---- BUG 3: rate-contract order draft is ALSO GST-inclusive ----
const rc = await approveRateContract([{ gradeId: grade.id, gradeLabel: gl, ratePerM3: 5000, transportCharge: 0, gstRate: '18' }]);
const o4 = await api('POST', `/order-drafts/from-rate-contract/${rc.id}`, {
  plantId: plant.id, orderDate: TODAY, lines: [{ gradeId: grade.id, quantityM3: 10 }],
});
const o4full = await api('GET', `/orders/${o4.id}`);
ok('rate-contract order preserves the ex-GST value for display', near(o4full.estimatedOrderValue, 50000));
ok('rate-contract order stores the GST-inclusive value (50000 + 18%)', near(o4full.estimatedOrderValueInclGst, 59000));

const assess4 = await api('GET', `/orders/${o4.id}/credit-check`);
ok('rate-contract credit requested amount is GST-inclusive', near(assess4.requestedAmount, 59000));
ok('rate-contract credit requested amount is NOT the ex-GST value', Number(assess4.requestedAmount) > 50000);

// ---- BUG 4: list responses carry the customer name (server join, no client-side lookup) ----
const ordersList = await api('GET', '/orders');
const o1row = (Array.isArray(ordersList) ? ordersList : []).find((r) => String(r.id) === String(o1.id));
ok('orders list row carries customerName', !!o1row && String(o1row.customerName || '') === String(customer.customerName));
const draftsList = await api('GET', '/order-drafts');
const o3row = (Array.isArray(draftsList) ? draftsList : []).find((r) => String(r.id) === String(o3.id));
ok('order-drafts list row carries customerName', !!o3row && String(o3row.customerName || '') === String(customer.customerName));

console.log(`\nPILOT GAPS TEST: ${pass} passed ✓`);
process.exit(0);
