/**
 * AR / credit-exposure core — TDD scenarios T1–T10 (design plan §7).
 *
 * These pin the TARGET behaviour of the unified exposure model BEFORE it is
 * built, so they run RED against the current code and turn GREEN when the core
 * lands. They are deliberately quarantined until then:
 *
 *   - The whole suite is a no-op UNLESS `AR_EXPOSURE_CORE=1` is set, so it is
 *     registered in run-integration.mjs but stays green in CI until the core PR
 *     flips the flag (P4). With the flag on and no creds it skips like the other
 *     integration tests.
 *
 * Contract the core must satisfy (asserted below):
 *   GET /customers/:id/exposure →
 *     { openingBalance, unInvoicedOrderValue, invoiceOutstanding,
 *       advanceCredit, exposure, creditLimit, availableCredit }
 *   where  exposure = openingBalance + unInvoicedOrderValue
 *                    + invoiceOutstanding − advanceCredit
 *   and the SAME derived exposure is read by the credit gate, the outstanding
 *   report, alerts and the dashboard (one source of truth).
 *
 * Exposure model under test:
 *   - a confirmed order counts at its incl-GST value ONLY while un-invoiced;
 *   - issuing an invoice hands the value off to the invoice's outstanding
 *     (no double count);
 *   - receipts reduce the invoice outstanding, which flows into exposure;
 *   - a fully-paid order/invoice frees credit at the booking gate;
 *   - unapplied advances AUTO-NET (reduce exposure immediately);
 *   - cancelled orders/invoices leave exposure net-neutral, never corrupt it.
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 * Reuses the seeded masters (grade M25, plant SRE-P1, mix M25-STD) exactly like
 * scripts/setup/test-order-cycle.mjs; creates its own isolated customers so the
 * shared CUST-001 fixtures are never disturbed.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const CORE_ON = process.env.AR_EXPOSURE_CORE === '1';

// ---- quarantine gate ---------------------------------------------------------
if (!CORE_ON) {
  console.log('(skipping ar-exposure — AR_EXPOSURE_CORE not set; the exposure core is not built yet)');
  process.exit(0);
}
if (!LOGIN || !PASSWORD) {
  console.log('(skipping ar-exposure — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

// ---- tiny harness: collect ALL failures so P4 sees the full red picture ------
let uid = Date.now();
const uniq = (p) => `${p}-${(uid++).toString(36)}`;
const near = (a, b, eps = 1) => Math.abs(Number(a) - Number(b)) < eps;
const failures = [];
const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push(`  PASS ${name}`); }
  catch (e) { failures.push(name); results.push(`  FAIL ${name} — ${e && e.message ? e.message : e}`); }
}
function must(cond, msg) { if (!cond) throw new Error(msg); }

// ---- API client --------------------------------------------------------------
let TOKEN = '';
async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    const err = data?.error ?? { message: res.statusText };
    throw new Error(`${method} ${path} -> ${res.status} ${err.message ?? err.code ?? JSON.stringify(err)}`);
  }
  return data.data;
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === String(value));
};

console.log('=== AR / credit-exposure — TDD scenarios T1–T10 ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

// ---- seeded masters (shared, read-only) -------------------------------------
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const vehicle = await lookup('vehicles', 'vehicleNo', 'TN00AA0000');
const driver = await lookup('drivers', 'driverCode', 'DRV-001');
must(grade && plant && mix, 'seeded masters (grade M25 / plant SRE-P1 / mix M25-STD) must exist');

const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const QTY = 8, RATE = 5000, GST = 18;
const EX_VAL = QTY * RATE;                    // 40000 ex-GST
const INCL_VAL = Math.round(EX_VAL * (1 + GST / 100)); // 47200 incl-GST

// ---- fixtures ----------------------------------------------------------------
async function freshCustomer(creditLimit = 0, openingBalance = 0) {
  const customer = await api('POST', '/customers', {
    customerCode: uniq('AREXP'), customerName: `AR Exposure ${uniq('C')}`,
    state: 'Tamil Nadu', creditLimit, openingBalance,
  });
  const site = await api('POST', '/sites', {
    customerId: customer.id, siteCode: uniq('ARST'), siteName: 'Exposure Site', state: 'Tamil Nadu',
  });
  return { customer, site };
}

async function makeDraftOrder({ customer, site }, qty = QTY, rate = RATE) {
  let q = await api('POST', '/quotations', {
    customerId: customer.id, siteId: site.id, quotationDate: TODAY, validUntil: plusDays(30),
    items: [{ gradeId: grade.id, gradeLabel: grade.gradeName ?? 'M25', estimatedQuantity: qty, ratePerM3: rate, gstRate: String(GST) }],
  });
  await api('POST', `/quotations/${q.id}/submit`);
  q = await api('POST', `/quotations/${q.id}/approve`);
  return api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
}

/** Confirm WITHOUT auto-release — returns the order as the gate decided it. */
const confirmRaw = (orderId) => api('POST', `/orders/${orderId}/confirm`);

/** Confirm and, if the gate holds it, approve the hold so it lands confirmed. */
async function confirmReleased(orderId) {
  let o = await confirmRaw(orderId);
  if (String(o.orderStatus) === 'credit_hold') {
    const holds = await api('GET', '/credit-holds?status=pending');
    const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(orderId));
    if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'ar-exposure auto-release' });
    o = await api('GET', `/orders/${orderId}`);
  }
  return o;
}

/** Drive a confirmed order all the way to an ISSUED invoice; returns { invoice, total }. */
async function deliverAndIssue({ customer }, order, qty = QTY, rate = RATE) {
  const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
  const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
  let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: qty, mixDesignId: mix.id });
  ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
  const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {
    ...(vehicle ? { vehicleId: vehicle.id } : {}), ...(driver ? { driverId: driver.id } : {}),
  });
  let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, { slump: '100' });
  await api('POST', `/delivery-challans/${challan.id}/issue`);
  challan = await api('POST', `/delivery-challans/${challan.id}/deliver`, { receiverName: 'Site Engineer', returnQuantityM3: 0 });
  let invoice = await api('POST', '/invoices/from-challans', {
    customerId: customer.id, invoiceDate: TODAY, dueDate: plusDays(30),
    lines: [{ challanId: challan.id, rate, gstRate: GST, hsnSac: '3824', uom: 'm3' }],
  });
  const total = Number(invoice.totalAmount || 0);
  invoice = await api('POST', `/invoices/${invoice.id}/issue`);
  return { invoice, total };
}

/** Produce one DELIVERED challan of `qty` m³ against a confirmed order, without
 *  invoicing — used to build a single invoice from several challans of the same
 *  order. Enqueue is idempotent (one queue entry per line), so each call reuses
 *  the order's live queue entry and batches it again for the next load. */
async function deliverOneChallan(order, qty) {
  await api('POST', `/batch-queue/from-order/${order.id}`);
  const all = await api('GET', '/batch-queue');
  const queueId = (Array.isArray(all) ? all : []).find(
    (e) => String(e.orderId) === String(order.id) && e.queueStatus !== 'cancelled' && e.queueStatus !== 'completed',
  )?.id;
  let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: qty, mixDesignId: mix.id });
  ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
  const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {
    ...(vehicle ? { vehicleId: vehicle.id } : {}), ...(driver ? { driverId: driver.id } : {}),
  });
  let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, { slump: '100' });
  await api('POST', `/delivery-challans/${challan.id}/issue`);
  challan = await api('POST', `/delivery-challans/${challan.id}/deliver`, { receiverName: 'Site Engineer', returnQuantityM3: 0 });
  return challan;
}

const exposureOf = (customerId) => api('GET', `/customers/${customerId}/exposure`);
const creditCheck = (orderId) => api('GET', `/orders/${orderId}/credit-check`);

// ============================================================================
// T1 — a confirmed order creates exposure (invariant; guards the base case).
// ============================================================================
await scenario('T1 confirmed order creates exposure (credit-check sees it)', async () => {
  const fx = await freshCustomer(0);
  const o1 = await makeDraftOrder(fx);
  await confirmReleased(o1.id);
  const o2 = await makeDraftOrder(fx);
  const a = await creditCheck(o2.id);
  must(near(a.outstandingBefore, INCL_VAL), `outstandingBefore should include the confirmed order's incl-GST value (${INCL_VAL}), got ${a.outstandingBefore}`);
});

// ============================================================================
// T2 — issuing an invoice REPLACES the order's exposure (hand-off, no double).
// ============================================================================
await scenario('T2 invoice replaces order exposure (hand-off, not double-count)', async () => {
  const fx = await freshCustomer(0);
  const o = await confirmReleased((await makeDraftOrder(fx)).id);
  const before = await exposureOf(fx.customer.id);
  must(near(before.unInvoicedOrderValue, INCL_VAL), `pre-invoice un-invoiced order value should be ${INCL_VAL}, got ${before.unInvoicedOrderValue}`);
  const { total } = await deliverAndIssue(fx, o);
  const after = await exposureOf(fx.customer.id);
  must(near(after.invoiceOutstanding, total), `invoice outstanding should be ${total}, got ${after.invoiceOutstanding}`);
  must(near(after.unInvoicedOrderValue, 0), `order should be released to the invoice (un-invoiced → 0), got ${after.unInvoicedOrderValue}`);
  must(near(after.exposure, before.exposure), `exposure must be unchanged across the hand-off (${before.exposure} → ${after.exposure})`);
});

// ============================================================================
// T3 — a receipt reduces outstanding AND exposure.
// ============================================================================
await scenario('T3 receipt reduces outstanding and exposure', async () => {
  const fx = await freshCustomer(0);
  const o = await confirmReleased((await makeDraftOrder(fx)).id);
  const { invoice, total } = await deliverAndIssue(fx, o);
  await api('POST', '/receipts', {
    customerId: fx.customer.id, amount: total, receiptDate: TODAY, paymentMode: 'cash',
    allocations: [{ invoiceId: invoice.id, amount: total }],
  });
  const after = await exposureOf(fx.customer.id);
  must(near(after.invoiceOutstanding, 0), `invoice outstanding should be 0 after full receipt, got ${after.invoiceOutstanding}`);
  must(near(after.exposure, 0), `exposure should be 0 after full payment, got ${after.exposure}`);
});

// ============================================================================
// T4 — a FULLY-PAID order no longer blocks a fresh order (the headline fix).
// ============================================================================
await scenario('T4 fully-paid order frees credit at the booking gate', async () => {
  const fx = await freshCustomer(INCL_VAL); // limit = exactly one order's incl-GST value
  const o1 = await confirmReleased((await makeDraftOrder(fx)).id);
  must(String(o1.orderStatus) === 'confirmed', `order 1 should confirm at the boundary, got ${o1.orderStatus}`);
  const { invoice, total } = await deliverAndIssue(fx, o1);
  await api('POST', '/receipts', {
    customerId: fx.customer.id, amount: total, receiptDate: TODAY, paymentMode: 'cash',
    allocations: [{ invoiceId: invoice.id, amount: total }],
  });
  // Order 2, same value: with order 1 paid off, exposure is ~0 so it must confirm.
  const o2 = await confirmRaw((await makeDraftOrder(fx)).id);
  must(String(o2.orderStatus) === 'confirmed',
    `order 2 must confirm once order 1 is paid (got ${o2.orderStatus}) — today it is wrongly held`);
});

// ============================================================================
// T5 — a PARTIAL receipt reduces exposure by exactly the amount paid.
// ============================================================================
await scenario('T5 partial receipt reduces exposure by the paid amount', async () => {
  const fx = await freshCustomer(0);
  const o = await confirmReleased((await makeDraftOrder(fx)).id);
  const { invoice, total } = await deliverAndIssue(fx, o);
  const part = Math.round(total * 0.4);
  await api('POST', '/receipts', {
    customerId: fx.customer.id, amount: part, receiptDate: TODAY, paymentMode: 'cash',
    allocations: [{ invoiceId: invoice.id, amount: part }],
  });
  const after = await exposureOf(fx.customer.id);
  must(near(after.invoiceOutstanding, total - part), `outstanding should be ${total - part}, got ${after.invoiceOutstanding}`);
  must(near(after.exposure, total - part), `exposure should drop by exactly the part paid, got ${after.exposure}`);
});

// ============================================================================
// T6 — an unapplied advance AUTO-NETS against exposure.
// ============================================================================
await scenario('T6 unapplied advance auto-nets against exposure', async () => {
  const fx = await freshCustomer(0);
  const advanceAmt = 15000;
  const adv = await api('POST', '/receipts', {
    customerId: fx.customer.id, amount: advanceAmt, receiptDate: TODAY, paymentMode: 'cash',
  });
  must(adv.isAdvance === true && near(adv.unallocatedAmount, advanceAmt), 'receipt should be a fully-unallocated advance');
  const exp = await exposureOf(fx.customer.id);
  must(near(exp.advanceCredit, advanceAmt), `advanceCredit should be ${advanceAmt}, got ${exp.advanceCredit}`);
  must(near(exp.exposure, -advanceAmt), `exposure should net down by the advance (to ${-advanceAmt}), got ${exp.exposure}`);
  // And the booking gate must see the reduced exposure.
  const a = await creditCheck((await makeDraftOrder(fx)).id);
  must(near(a.outstandingBefore, -advanceAmt), `gate outstandingBefore should reflect the advance (${-advanceAmt}), got ${a.outstandingBefore}`);
});

// ============================================================================
// T7 — cancelling an order returns exposure to its pre-order value.
// ============================================================================
await scenario('T7 cancelled order does not corrupt exposure', async () => {
  const fx = await freshCustomer(0);
  const o = await confirmReleased((await makeDraftOrder(fx)).id);
  await api('POST', `/orders/${o.id}/cancel`, { reason: 'ar-exposure T7' });
  const exp = await exposureOf(fx.customer.id);
  must(near(exp.unInvoicedOrderValue, 0), `cancelled order should leave the order sum (0), got ${exp.unInvoicedOrderValue}`);
  must(near(exp.exposure, 0), `exposure should return to 0 after cancel, got ${exp.exposure}`);
});

// ============================================================================
// T8 — cancelling an (unpaid) invoice reverts to the order, net-neutral.
// ============================================================================
await scenario('T8 cancelled invoice reverts to the order, net-neutral', async () => {
  const fx = await freshCustomer(0);
  const o = await confirmReleased((await makeDraftOrder(fx)).id);
  const { invoice } = await deliverAndIssue(fx, o);
  await api('POST', `/invoices/${invoice.id}/cancel`, { reason: 'ar-exposure T8' });
  const exp = await exposureOf(fx.customer.id);
  must(Number.isFinite(Number(exp.exposure)), `exposure must stay a finite number after invoice cancel, got ${exp.exposure}`);
  must(near(exp.invoiceOutstanding, 0), `cancelled invoice should carry no outstanding, got ${exp.invoiceOutstanding}`);
  must(near(exp.exposure, INCL_VAL), `order should re-count once its invoice is cancelled (${INCL_VAL}), got ${exp.exposure}`);
});

// ============================================================================
// T9 — reports agree with the source of truth.
// ============================================================================
await scenario('T9 outstanding report matches the exposure source of truth', async () => {
  const fx = await freshCustomer(0);
  const o = await confirmReleased((await makeDraftOrder(fx)).id);
  const { total } = await deliverAndIssue(fx, o); // one issued, unpaid invoice
  const exp = await exposureOf(fx.customer.id);
  const report = await api('GET', '/billing-reports/outstanding');
  const row = (report.rows || []).find((r) => String(r.customerName) === String(fx.customer.customerName));
  must(row, 'the customer should appear in the outstanding report');
  must(near(row.total, total), `report total should equal the invoice (${total}), got ${row.total}`);
  must(near(row.total, exp.invoiceOutstanding), `report total (${row.total}) must equal exposure's invoice outstanding (${exp.invoiceOutstanding})`);
});

// ============================================================================
// T10 — legacy rows compute a sane exposure (no null / NaN).
// ============================================================================
await scenario('T10 legacy customer computes a finite exposure', async () => {
  const legacy = await lookup('customers', 'customerCode', 'CUST-001');
  must(legacy, 'seeded CUST-001 must exist');
  const exp = await exposureOf(legacy.id);
  for (const k of ['openingBalance', 'unInvoicedOrderValue', 'invoiceOutstanding', 'advanceCredit', 'exposure']) {
    must(Number.isFinite(Number(exp[k])), `exposure.${k} must be a finite number for a legacy customer, got ${exp[k]}`);
  }
});

// ---- report ------------------------------------------------------------------
// T11 — a single invoice raised from SEVERAL challans of one order must reduce
// that order's un-invoiced value by ONE invoice total, not once per challan.
// Guards the exposure fan-out bug: SUM(invoice.total) over the invoice→challan
// join multiplied billed by the challan count and under-counted exposure.
await scenario('T11 multi-challan invoice bills once, not per challan (fan-out guard)', async () => {
  const fx = await freshCustomer(0, 0); // no limit → confirm never holds
  const order = await confirmReleased((await makeDraftOrder(fx, QTY, RATE)).id); // order for QTY (INCL_VAL)
  const orderValIncl = Number(order.estimatedOrderValueInclGst || 0);
  must(near(orderValIncl, INCL_VAL), `order incl value should be ${INCL_VAL}, got ${orderValIncl}`);

  // Partial delivery: two small challans (2 m³ each) invoiced on ONE invoice.
  const c1 = await deliverOneChallan(order, 2);
  const c2 = await deliverOneChallan(order, 2);
  let inv = await api('POST', '/invoices/from-challans', {
    customerId: fx.customer.id, invoiceDate: TODAY, dueDate: plusDays(30),
    lines: [
      { challanId: c1.id, rate: RATE, gstRate: GST, hsnSac: '3824', uom: 'm3' },
      { challanId: c2.id, rate: RATE, gstRate: GST, hsnSac: '3824', uom: 'm3' },
    ],
  });
  const invTotal = Number(inv.totalAmount || 0); // ~23600 (4 m³ incl-GST)
  inv = await api('POST', `/invoices/${inv.id}/issue`);

  const exp = await exposureOf(fx.customer.id);
  // Correct: order reduced by ONE invoice total. Fan-out bug would give
  // orderValIncl − 2×invTotal (= 0 here) and under-count exposure.
  must(near(exp.unInvoicedOrderValue, orderValIncl - invTotal),
    `un-invoiced should be ${orderValIncl - invTotal} (order − one invoice), got ${exp.unInvoicedOrderValue}`);
  must(near(exp.invoiceOutstanding, invTotal), `invoice outstanding should be ${invTotal}, got ${exp.invoiceOutstanding}`);
  must(near(exp.exposure, orderValIncl), `total exposure should stay ${orderValIncl}, got ${exp.exposure}`);
});

// T12 — rejecting a credit hold must return the order to DRAFT so it stays
// recoverable (re-confirmable once dues clear), not strand it in credit_hold
// where confirm() throws and the order can only be cancelled.
await scenario('T12 rejected credit hold returns the order to draft (re-confirmable)', async () => {
  const fx = await freshCustomer(1, 0); // ₹1 limit → any order breaches → holds
  const order = await confirmRaw((await makeDraftOrder(fx)).id);
  must(String(order.orderStatus) === 'credit_hold', `order should hold, got ${order.orderStatus}`);
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  must(hold, 'a pending hold should exist for the held order');

  await api('POST', `/credit-holds/${hold.id}/reject`, { note: 'declined for now' });
  const after = await api('GET', `/orders/${order.id}`);
  must(String(after.orderStatus) === 'draft', `rejected order should return to draft, got ${after.orderStatus}`);
  must(String(after.creditStatus) === 'rejected', `credit status should be rejected, got ${after.creditStatus}`);

  // Proves it is no longer a dead-end: the draft order re-enters the credit gate.
  const reconfirmed = await confirmRaw(order.id);
  must(['credit_hold', 'confirmed'].includes(String(reconfirmed.orderStatus)),
    `re-confirm should re-run the credit gate, got ${reconfirmed.orderStatus}`);
});

console.log(results.join('\n'));
if (failures.length) {
  console.error(`\nAR-EXPOSURE: ${results.length - failures.length}/${results.length} passed — RED (${failures.length} awaiting the core): ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\nAR-EXPOSURE: all ${results.length} scenarios passed ✓`);
process.exit(0);
