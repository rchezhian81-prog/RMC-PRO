#!/usr/bin/env node
// RMC Plant SaaS — end-to-end order-to-cash test cycle.
//
// Drives the LIVE API through a full business cycle so you can watch the whole
// flow work before real customers go in:
//
//   Quotation → (approve) → Order → (confirm / release credit hold) →
//   Batch queue → Batch ticket (consumes stock) → Dispatch →
//   Delivery challan (issue → deliver) → Invoice (issue) → Receipt (paid)
//
// It reuses the master data the seeder created (customer CUST-001, site
// SITE-001, grade M25, plant SRE-P1, approved mix M25-STD, opening stock). Run
// the seeder first if those don't exist. Each run creates a NEW set of test
// documents (quotation, order, invoice…) — safe to run repeatedly; delete the
// test documents later from the app if you don't want them.
//
// Usage (run ON the VPS, where the API is reachable):
//   read -rsp "Password: " RMC_PASSWORD; export RMC_PASSWORD; echo
//   API_URL=https://api.mixnovas.com LOGIN='<tenant owner login>' \
//     node scripts/setup/test-order-cycle.mjs
//
// RMC_PASSWORD is read from the environment only — never printed or stored.
// Log in as the company owner (bypasses per-permission checks).

const API_URL = (process.env.API_URL || 'https://api.mixnovas.com').replace(/\/+$/, '');
const BASE = `${API_URL}/api/v1`;
const LOGIN = process.env.LOGIN || process.env.RMC_LOGIN || '';
const PASSWORD = process.env.RMC_PASSWORD || process.env.PASSWORD || '';

// ---- Test parameters (edit freely) ----
const QTY_M3 = Number(process.env.QTY || 50);
const RATE = Number(process.env.RATE || 5000);
const GST_RATE = Number(process.env.GST || 18);
const TODAY = process.env.CYCLE_DATE || new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let TOKEN = '';
const log = (...a) => console.log(...a);
const step = (n, s) => console.log(`\n[${n}] ${s}`);
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok || (json && typeof json === 'object' && json.success === false)) {
    const err = json && typeof json === 'object' ? (json.error ?? json) : { message: String(json || res.statusText) };
    const detail = err.message ?? err.code ?? JSON.stringify(err);
    throw new Error(`${method} ${path} → HTTP ${res.status} ${Array.isArray(detail) ? detail.join('; ') : detail}`);
  }
  if (json && typeof json === 'object' && json.success === true && 'data' in json) return json.data;
  return json;
}

async function login() {
  if (!LOGIN) die('Set LOGIN=<tenant owner email/mobile>.');
  if (!PASSWORD) die('Set RMC_PASSWORD in the environment (never printed).');
  let out;
  try { out = await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD }); }
  catch (e) { die(`Login failed for "${LOGIN}". (${e.message})`); }
  TOKEN = out.access_token;
  if (!TOKEN || !out.tenant) die('Login did not return a tenant token — use a tenant owner login, not the super-admin.');
  log(`✓ Logged in as ${out.user?.name || LOGIN} · tenant: ${out.tenant.name} (${out.tenant.code})`);
}

// Find a seeded master by a code field; die with guidance if missing.
async function lookup(path, field, value, label, required = true) {
  const list = await api('GET', `/${path}`);
  const rows = Array.isArray(list) ? list : (list?.data ?? []);
  const hit = rows.find((r) => String(r[field]) === String(value));
  if (!hit && required) die(`${label} "${value}" not found. Run the seeder (seed-plant-master.mjs) first.`);
  return hit || null;
}

async function main() {
  log(`\nMix Nova RMC — order-to-cash test cycle`);
  log(`API: ${BASE}\n`);
  await login();

  // ---- Look up seeded masters (need ids, not codes) ----
  step('0/8', 'Looking up seeded masters');
  const customer = await lookup('customers', 'customerCode', 'CUST-001', 'Customer');
  const site = await lookup('sites', 'siteCode', 'SITE-001', 'Site');
  const grade = await lookup('concrete-grades', 'gradeCode', 'M25', 'Grade M25');
  const plant = await lookup('plants', 'plantCode', 'SRE-P1', 'Plant');
  const mix = await lookup('mix-designs', 'mixCode', 'M25-STD', 'Mix design M25-STD');
  const vehicle = await lookup('vehicles', 'vehicleNo', 'TN00AA0000', 'Vehicle', false);
  const driver = await lookup('drivers', 'driverCode', 'DRV-001', 'Driver', false);
  if (String(mix.approvalStatus) !== 'approved') die('Mix M25-STD is not approved — approve it before running the cycle.');
  if (String(mix.gradeId) !== String(grade.id)) die('Mix M25-STD grade does not match M25 — cannot auto-resolve the batch recipe.');
  log(`  customer ${customer.customerName} · site ${site.siteName} · grade ${grade.gradeCode} · plant ${plant.plantCode} · mix ${mix.mixCode}`);

  // ---- A. Quotation ----
  step('1/8', 'Quotation');
  let q = await api('POST', '/quotations', {
    customerId: customer.id, siteId: site.id,
    quotationDate: TODAY, validUntil: plusDays(30), paymentTerms: '30 days',
    items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: QTY_M3, ratePerM3: RATE }],
  });
  log(`  + created ${q.quotationNo}`);
  await api('POST', `/quotations/${q.id}/submit`);
  q = await api('POST', `/quotations/${q.id}/approve`);
  log(`  ✓ approved ${q.quotationNo}`);

  // ---- B. Order ----
  step('2/8', 'Order');
  let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
  log(`  + order draft ${order.orderNo}`);
  order = await api('POST', `/orders/${order.id}/confirm`);
  if (String(order.orderStatus) === 'credit_hold') {
    log('  · order hit credit hold — releasing…');
    const holds = await api('GET', '/credit-holds?status=pending');
    const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
    if (!hold) die('Order is on credit hold but no pending hold request was found to approve.');
    await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'test cycle auto-release' });
    order = await api('GET', `/orders/${order.id}`);
  }
  if (String(order.orderStatus) !== 'confirmed') die(`Order did not confirm (status: ${order.orderStatus}).`);
  log(`  ✓ confirmed ${order.orderNo}`);

  // ---- C. Batch ----
  step('3/8', 'Batch');
  const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
  const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
  if (!queueId) die('Batch queue returned no entry.');
  let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: QTY_M3, mixDesignId: mix.id });
  log(`  + batch ticket ${ticket.batchTicketNo || ticket.ticketNo || ticket.id}`);
  ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
  log(`  ✓ confirmed (stock consumed)`);

  // ---- D. Dispatch ----
  step('4/8', 'Dispatch');
  const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {
    ...(vehicle ? { vehicleId: vehicle.id } : {}),
    ...(driver ? { driverId: driver.id } : {}),
  });
  log(`  + dispatch ${dispatch.dispatchNo || dispatch.id}`);

  // ---- E. Delivery challan ----
  step('5/8', 'Delivery challan');
  let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, { slump: '100' });
  log(`  + challan ${challan.challanNo || challan.id}`);
  await api('POST', `/delivery-challans/${challan.id}/issue`);
  challan = await api('POST', `/delivery-challans/${challan.id}/deliver`, { receiverName: 'Site Engineer', returnQuantityM3: 0 });
  log(`  ✓ delivered ${challan.challanNo || challan.id}`);

  // ---- F. Invoice ----
  step('6/8', 'Invoice');
  let invoice = await api('POST', '/invoices/from-challans', {
    customerId: customer.id, invoiceDate: TODAY, dueDate: plusDays(30),
    lines: [{ challanId: challan.id, rate: RATE, gstRate: GST_RATE, hsnSac: '3824', uom: 'm3' }],
  });
  const total = Number(invoice.totalAmount || 0);
  log(`  + invoice ${invoice.invoiceNo || invoice.id} · total ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  invoice = await api('POST', `/invoices/${invoice.id}/issue`);
  log(`  ✓ issued ${invoice.invoiceNo || invoice.id}`);

  // ---- G. Receipt (full payment) ----
  step('7/8', 'Receipt');
  const receipt = await api('POST', '/receipts', {
    customerId: customer.id, amount: total, receiptDate: TODAY, paymentMode: 'neft', bankReference: 'TEST-UTR',
    allocations: [{ invoiceId: invoice.id, amount: total }],
  });
  log(`  ✓ receipt ${receipt.receiptNo || receipt.id} · ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })} allocated`);

  // ---- Summary ----
  step('8/8', 'Cycle complete');
  log(`────────────────────────────────────────`);
  log(`Quotation : ${q.quotationNo}`);
  log(`Order     : ${order.orderNo} (confirmed)`);
  log(`Batch     : ${ticket.batchTicketNo || ticket.ticketNo || ticket.id} (stock consumed)`);
  log(`Dispatch  : ${dispatch.dispatchNo || dispatch.id}`);
  log(`Challan   : ${challan.challanNo || challan.id} (delivered)`);
  log(`Invoice   : ${invoice.invoiceNo || invoice.id} · ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (issued, paid)`);
  log(`\n✓ Full order-to-cash cycle worked end to end for ${QTY_M3} m³ of ${grade.gradeCode}.`);
  log(`Check it in the app: Sales → Quotations, Orders, Dispatch, Billing → Invoices / Receipts.`);
}

main().catch((e) => die(e.message));
