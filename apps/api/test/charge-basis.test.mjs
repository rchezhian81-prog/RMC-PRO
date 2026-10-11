/**
 * A basis for each charge, from the quotation to the invoice:
 *   - a quotation line with transport per trip, pump per job and waiting per
 *     hour is estimated as the shared estimateLineValue says (trips at the
 *     tenant's truck load, the job once, waiting not until billed); a basis
 *     outside the allowed set is refused;
 *   - convert → the order items carry the three bases and the estimated
 *     order value matches the estimate; the quotation PDF says the basis;
 *   - two delivered challans invoiced → one concrete line per challan at the
 *     concrete-only rate, one transport line with 2 trips, one pump-per-job
 *     line, and a waiting line of 0.75 h for the dispatch that waited 95
 *     minutes against 60 free; the picker previewed the same charges;
 *   - a second invoice for the same order does not repeat the per-job line;
 *   - a lump-sum transport and per-hour pumping go on the first invoice that
 *     bills the order, a later invoice adds neither, and cancelling the first
 *     releases the pump hours (and the lump sum) for the next one;
 *   - the pump reconciliation reads the billed pump charge from those lines.
 *
 * Runs on a tenant of its own (provisioned through the platform API), so the
 * documents it numbers never disturb the pilot tenant's series. The challans
 * and dispatches are seeded by the owner role, like billable-challans does.
 *
 * Env (provided by run-integration.mjs): API_BASE, SUPERADMIN_EMAIL,
 * SUPERADMIN_PASSWORD, POSTGRES_* (owner, to seed the challans directly).
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pdfText, pdfTextReport } from './helpers/pdf-text.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const SU_LOGIN = process.env.SUPERADMIN_EMAIL;
const SU_PASSWORD = process.env.SUPERADMIN_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

let TOKEN = '';
async function call(method, path, body, token = TOKEN) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function api(method, path, body, token) {
  const r = await call(method, path, body, token);
  if (r.status >= 400 || !r.data?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.data;
}
async function pdf(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, text: res.status === 200 ? pdfText(buf) : '' };
}

if (!SU_LOGIN || !SU_PASSWORD) {
  console.log('(skipping charge-basis — SUPERADMIN creds not set)');
  process.exit(0);
}

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  synchronize: false,
  logging: false,
});
await owner.initialize();
const q = (sql, params) => owner.query(sql, params);

console.log('=== charge basis: per trip / per job / per hour / lump sum from quotation to invoice ===');

const SFX = Date.now().toString(36).slice(-6).toUpperCase();
const TODAY = new Date().toISOString().slice(0, 10);

// ---- own tenant on the seeded plan, with its own owner ----
const su = (await api('POST', '/auth/login', { login: SU_LOGIN, password: SU_PASSWORD }, '')).access_token;
const plans = await api('GET', '/platform/plans', undefined, su);
const plan = plans[plans.length - 1];
const tenant = await api('POST', '/platform/tenants', { tenantCode: `CHB${SFX}`.slice(0, 12), tenantName: `Charge Basis Co ${SFX}`, planId: plan.id }, su);
await api('POST', `/platform/tenants/${tenant.id}/assign-plan`, { planId: plan.id }, su).catch(() => {});
await api('PUT', `/platform/tenants/${tenant.id}/modules/fleet`, { isEnabled: true }, su).catch(() => {});
const OWNER_EMAIL = `chb.owner.${SFX.toLowerCase()}@ci.test`;
const OWNER_PW = 'ChargeOwner#12345';
await api('POST', `/platform/tenants/${tenant.id}/users`, { name: 'Charge Owner', email: OWNER_EMAIL, password: OWNER_PW }, su);
TOKEN = (await api('POST', '/auth/login', { login: OWNER_EMAIL, password: OWNER_PW }, '')).access_token;
ok('the test tenant and its owner are ready', Boolean(TOKEN));
const TENANT = tenant.id;

// ---- the billing settings are in the catalogue with their bounds ----
const settings = await api('GET', '/settings');
const truckSetting = settings.find((s) => s.key === 'billing.default_truck_m3');
const freeSetting = settings.find((s) => s.key === 'billing.waiting_free_minutes');
ok('billing.default_truck_m3 is listed, number, default 6, bounds 1–12', truckSetting?.type === 'number' && truckSetting.value === '6' && truckSetting.min === 1 && truckSetting.max === 12);
ok('billing.waiting_free_minutes is listed, number, default 60, bounds 0–240', freeSetting?.type === 'number' && freeSetting.value === '60' && freeSetting.min === 0 && freeSetting.max === 240);
const tooBig = await call('PUT', '/settings/billing.default_truck_m3', { value: '13' });
ok('a truck load over 12 m³ is refused (400)', tooBig.status === 400);
await api('PUT', '/settings/billing.default_truck_m3', { value: '6' });
await api('PUT', '/settings/billing.waiting_free_minutes', { value: '60' });

// ---- masters ----
const grade = await api('POST', '/concrete-grades', { gradeCode: `M25-${SFX}`, gradeName: `M25 ${SFX}` });
const customer = await api('POST', '/customers', { customerName: `Basis Builders ${SFX}`, state: 'Tamil Nadu' });

// ---- A. quotation: transport per trip, pump per job, waiting per hour ----
const QTY = 14, RATE = 4000, TRIP = 1500, JOB = 3500, WAIT = 400;
let quote = await api('POST', '/quotations', {
  customerId: customer.id, quotationDate: TODAY,
  items: [{
    gradeId: grade.id, gradeLabel: grade.gradeCode, estimatedQuantity: QTY, ratePerM3: RATE,
    transportCharge: TRIP, transportBasis: 'per_trip', pumpCharge: JOB, pumpBasis: 'per_job',
    waitingCharge: WAIT, waitingBasis: 'per_hour', gstRate: 18,
  }],
});
const qi = quote.items[0];
ok('the quotation line carries the three bases', qi.transportBasis === 'per_trip' && qi.pumpBasis === 'per_job' && qi.waitingBasis === 'per_hour');
ok('the quotation says the truck load it estimates with (6 m³)', near(quote.truckM3, 6));
// 14 m³ at 6 m³ a truck = 3 trips: 56,000 + 3 × 1,500 + 3,500 (waiting counts nothing until billed) = 64,000.
const EXPECTED = QTY * RATE + 3 * TRIP + JOB;
ok('the tax preview taxes the basis estimate (64,000, not 14 × all-in)', near(quote.taxSummary.taxable, EXPECTED) && near(quote.taxSummary.total, EXPECTED * 1.18));
const listed = (await api('GET', '/quotations')).find((r) => r.id === quote.id);
ok('the quotation list values it the same way', near(listed?.estimatedValue, EXPECTED));

const badBasis = await call('POST', `/quotations/${quote.id}/items`, { gradeId: grade.id, estimatedQuantity: 1, ratePerM3: 1, transportBasis: 'per_job' });
ok('a transport basis outside per_m3 / per_trip / lump_sum is refused (400)', badBasis.status === 400 && /transportBasis/.test(String(badBasis.data?.error?.message ?? '')));
const badPump = await call('PATCH', `/quotations/${quote.id}/items/${qi.id}`, { pumpBasis: 'per_trip' });
ok('a pump basis outside per_m3 / per_job / per_hour is refused (400)', badPump.status === 400);
const blankBasis = await api('PATCH', `/quotations/${quote.id}/items/${qi.id}`, { waitingBasis: '' });
ok('a blank basis falls back to per m³', blankBasis.items[0].waitingBasis === 'per_m3');
await api('PATCH', `/quotations/${quote.id}/items/${qi.id}`, { waitingBasis: 'per_hour' });

// A default-basis line (every charge per m³) still reads as qty × all-in.
const plain = await api('POST', '/quotations', {
  customerId: customer.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeCode, estimatedQuantity: 10, ratePerM3: 4500, transportCharge: 200, pumpCharge: 300, waitingCharge: 50, gstRate: 18 }],
});
ok('a line with no basis given defaults to per m³ on all three', plain.items[0].transportBasis === 'per_m3' && plain.items[0].pumpBasis === 'per_m3' && plain.items[0].waitingBasis === 'per_m3');
ok('…and is still valued as qty × (rate + transport + pump + waiting)', near(plain.taxSummary.taxable, 10 * 5050));

// ---- B. approve, PDF, convert ----
await api('POST', `/quotations/${quote.id}/submit`);
quote = await api('POST', `/quotations/${quote.id}/approve`);
const qpdf = await pdf(`/quotations/${quote.id}/pdf`);
ok('the quotation PDF renders', qpdf.status === 200);
ok('the quotation PDF says the transport is per trip', /per trip/.test(qpdf.text) || (() => { console.log(pdfTextReport(qpdf.buf)); return false; })());
ok('the quotation PDF says the pump is per job and the waiting per hour after the free period', /per job/.test(qpdf.text) && /per hour after the free period/.test(qpdf.text));

const order = await api('POST', `/order-drafts/from-quotation/${quote.id}`, { orderDate: TODAY });
const oi = order.items[0];
ok('the order item carries the three bases', oi.transportBasis === 'per_trip' && oi.pumpBasis === 'per_job' && oi.waitingBasis === 'per_hour');
ok('the estimated order value matches estimateLineValue (64,000)', near(order.estimatedOrderValue, EXPECTED));
ok('…and the GST-inclusive value the credit check counts (75,520)', near(order.estimatedOrderValueInclGst, EXPECTED * 1.18));
const orderFull = await api('GET', `/orders/${order.id}`);
ok('the order screen taxes the same estimate', near(orderFull.taxSummary.taxable, EXPECTED) && near(orderFull.truckM3, 6));

// ---- C. two delivered challans with their dispatches (seeded as the owner) ----
const t0 = new Date('2026-03-02T08:00:00Z');
const plus = (min) => new Date(t0.getTime() + min * 60_000);
async function seedDelivery(orderId, gradeId, m3, arrivalAt, pourAt, tag) {
  const dispatchId = randomUUID();
  await q(
    `INSERT INTO dispatches (id, tenant_id, dispatch_no, dispatch_status, order_id, customer_id, grade_id, quantity_m3, site_arrival_time, pour_start_time)
     VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9)`,
    [dispatchId, TENANT, `CB-DSP-${SFX}-${tag}`, orderId, customer.id, gradeId, m3, arrivalAt, pourAt],
  );
  const challanId = randomUUID();
  await q(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, dispatch_id, order_id, customer_id, grade_id, grade_label, quantity_m3, return_quantity_m3, challan_status, invoice_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'delivered', 'not_invoiced')`,
    [challanId, TENANT, `CB-DC-${SFX}-${tag}`, dispatchId, orderId, customer.id, gradeId, grade.gradeCode, m3],
  );
  return { challanId, challanNo: `CB-DC-${SFX}-${tag}` };
}
// The first truck waited 95 minutes before the pour (35 beyond the free hour → 0.75 h); the second 30 (nothing).
const c1 = await seedDelivery(order.id, grade.id, 7, plus(0), plus(95), 'A');
const c2 = await seedDelivery(order.id, grade.id, 7, plus(120), plus(150), 'B');

const picker = await api('GET', `/invoices/billable-challans?customerId=${customer.id}`);
const p1 = picker.find((r) => r.id === c1.challanId);
const p2 = picker.find((r) => r.id === c2.challanId);
ok('the picker lists both challans at the concrete-only rate (4,000, not all-in)', p1 && p2 && near(p1.suggestedRate, RATE) && near(p2.suggestedRate, RATE));
const prevTypes = (p1?.extraCharges ?? []).map((e) => e.type).sort();
ok('the picker previews the charges the order terms add: a 2-trip transport, a per-job pump, one waiting line', JSON.stringify(prevTypes) === JSON.stringify(['pump_job', 'transport', 'waiting']));
const prevTrip = p1.extraCharges.find((e) => e.type === 'transport');
const prevWait = p1.extraCharges.find((e) => e.type === 'waiting');
ok('the preview counts 2 trips at ₹1,500 over both challans', prevTrip.quantity === 2 && near(prevTrip.rate, TRIP) && near(prevTrip.amount, 2 * TRIP) && prevTrip.challanIds.length === 2);
ok('the waiting preview belongs to the challan that waited: 0.75 h × ₹400', prevWait.challanId === c1.challanId && near(prevWait.quantity, 0.75) && near(prevWait.amount, 300));
ok('the preview is the same on every challan of the order', JSON.stringify(p2.extraCharges) === JSON.stringify(p1.extraCharges));

// ---- D. the first invoice: concrete per challan + the charge lines ----
const inv1 = await api('POST', '/invoices/from-challans', { customerId: customer.id, invoiceDate: TODAY, lines: [{ challanId: c1.challanId, hsnSac: '68109990' }, { challanId: c2.challanId, hsnSac: '68109990' }] });
const byType = (inv, type) => inv.items.filter((it) => it.chargeType === type);
const concrete = byType(inv1, 'concrete');
ok('one concrete line per challan at the concrete-only rate, 7 m³ each', concrete.length === 2 && concrete.every((it) => near(it.rate, RATE) && near(it.quantity, 7) && it.uom === 'm3' && it.orderId === order.id));
const trip = byType(inv1, 'transport');
ok('one transport line: 2 trips × ₹1,500 (SAC 9965, unit trip)', trip.length === 1 && near(trip[0].quantity, 2) && near(trip[0].rate, TRIP) && near(trip[0].taxableAmount, 3000) && trip[0].uom === 'trip' && trip[0].hsnSac === '9965');
ok('…described as a person reads it', trip[0].description === 'Transport — 2 trips × ₹1,500');
const job = byType(inv1, 'pump_job');
ok('one pump-per-job line: 1 × ₹3,500 (unit job)', job.length === 1 && near(job[0].quantity, 1) && near(job[0].rate, JOB) && job[0].uom === 'job' && job[0].description === 'Pump charge (per job)');
const wait = byType(inv1, 'waiting');
ok('one waiting line for the challan that waited: 0.75 h × ₹400 = ₹300 (unit hour)', wait.length === 1 && near(wait[0].quantity, 0.75) && near(wait[0].rate, WAIT) && near(wait[0].taxableAmount, 300) && wait[0].uom === 'hour' && wait[0].challanId === c1.challanId);
ok('…named after its challan', wait[0].description === `Waiting — ${c1.challanNo}, 0.75 h × ₹400`);
ok('the charge lines are taxed at the order line\'s GST rate (18%)', [...trip, ...job, ...wait].every((it) => near(it.gstRate, 18) && near(it.cgstAmount, Number(it.taxableAmount) * 0.09)));
const TAXABLE1 = 2 * 7 * RATE + 3000 + JOB + 300;
ok('the invoice taxable is concrete + the charges (62,800)', near(inv1.taxableAmount, TAXABLE1));
ok('the invoice total is the rounded GST-inclusive figure', near(inv1.totalAmount, Math.round(TAXABLE1 * 1.18)));
const ipdf = await pdf(`/invoices/${inv1.id}/pdf`);
ok('the invoice PDF prints the charge lines', ipdf.status === 200 && /2 trips/.test(ipdf.text) && /Pump charge \(per job\)/.test(ipdf.text) && /Waiting/.test(ipdf.text));

// ---- E. a second invoice for the same order: trips again, the per-job pump not ----
const c3 = await seedDelivery(order.id, grade.id, 6, plus(300), plus(320), 'C');
const picker2 = await api('GET', `/invoices/billable-challans?customerId=${customer.id}`);
const p3 = picker2.find((r) => r.id === c3.challanId);
ok('the picker no longer previews the per-job pump once an invoice carries it', !p3.extraCharges.some((e) => e.type === 'pump_job') && p3.extraCharges.some((e) => e.type === 'transport' && e.quantity === 1));
const inv2 = await api('POST', '/invoices/from-challans', { customerId: customer.id, invoiceDate: TODAY, lines: [{ challanId: c3.challanId, hsnSac: '68109990' }] });
ok('the second invoice bills 1 trip and no per-job pump line', byType(inv2, 'transport').length === 1 && near(byType(inv2, 'transport')[0].quantity, 1) && byType(inv2, 'pump_job').length === 0 && byType(inv2, 'waiting').length === 0);
ok('its taxable is the concrete + one trip (25,500)', near(inv2.taxableAmount, 6 * RATE + TRIP));

// Cancelling the second invoice releases its challan and nothing else.
await api('POST', `/invoices/${inv2.id}/cancel`, { reason: 'test' });
const inv1Again = await api('GET', `/invoices/${inv1.id}`);
ok('cancelling the second invoice leaves the first intact (still 5 lines, draft)', inv1Again.items.length === 5 && inv1Again.invoiceStatus === 'draft');
ok('…and releases only its own challan', (await api('GET', `/delivery-challans/${c3.challanId}`)).invoiceStatus === 'not_invoiced' && (await api('GET', `/delivery-challans/${c1.challanId}`)).invoiceStatus === 'invoiced');

// ---- F. lump-sum transport + per-hour pumping: once, on the first invoice; released on cancel ----
const LUMP = 9000, HOUR = 1500;
let quote2 = await api('POST', '/quotations', {
  customerId: customer.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeCode, estimatedQuantity: 12, ratePerM3: RATE, transportCharge: LUMP, transportBasis: 'lump_sum', pumpCharge: HOUR, pumpBasis: 'per_hour', gstRate: 18 }],
});
ok('a lump sum counts once in the estimate and per-hour pumping not at all (57,000)', near(quote2.taxSummary.taxable, 12 * RATE + LUMP));
await api('POST', `/quotations/${quote2.id}/submit`);
quote2 = await api('POST', `/quotations/${quote2.id}/approve`);
const order2 = await api('POST', `/order-drafts/from-quotation/${quote2.id}`, { orderDate: TODAY });
ok('the second order carries lump_sum / per_hour', order2.items[0].transportBasis === 'lump_sum' && order2.items[0].pumpBasis === 'per_hour');

// A pump and two jobs on the order: one completed with 2.5 hours, one still planned (not billable yet).
const pump = await api('POST', '/vehicles', { vehicleNo: `TN${SFX.slice(-4)}PM`, vehicleType: 'concrete_pump', capacityM3: 0 });
const jobDone = randomUUID(), jobOpen = randomUUID();
await q(
  `INSERT INTO pump_jobs (id, tenant_id, job_no, order_id, customer_id, pump_vehicle_id, scheduled_date, pump_hours, charge_basis, rate, status)
   VALUES ($1, $2, $3, $4, $5, $6, $7, 2.5, 'per_hour', $8, 'completed'), ($9, $2, $10, $4, $5, $6, $7, 1, 'per_hour', $8, 'planned')`,
  [jobDone, TENANT, `CB-PJ-${SFX}-1`, order2.id, customer.id, pump.id, TODAY, HOUR, jobOpen, `CB-PJ-${SFX}-2`],
);
const d1 = await seedDelivery(order2.id, grade.id, 6, plus(400), plus(410), 'D');
const invA = await api('POST', '/invoices/from-challans', { customerId: customer.id, invoiceDate: TODAY, lines: [{ challanId: d1.challanId, hsnSac: '68109990' }] });
const lump = byType(invA, 'transport_lump');
ok('the first invoice on the order carries the lump-sum transport once (unit lot)', lump.length === 1 && near(lump[0].quantity, 1) && near(lump[0].rate, LUMP) && lump[0].uom === 'lot' && lump[0].description === 'Transport (lump sum)');
const hours = byType(invA, 'pump_hours');
ok('…and the completed job\'s 2.5 pump hours × ₹1,500 (unit hour), the planned job left out', hours.length === 1 && near(hours[0].quantity, 2.5) && near(hours[0].taxableAmount, 3750) && hours[0].uom === 'hour' && hours[0].description === 'Pumping — 2.5 hours × ₹1,500');
const [jobRow] = await q(`SELECT invoice_item_id AS "invoiceItemId" FROM pump_jobs WHERE id = $1`, [jobDone]);
ok('the billed pump job remembers the invoice line', jobRow.invoiceItemId === hours[0].id);
ok('the concrete line on that invoice is at the concrete-only rate', byType(invA, 'concrete').every((it) => near(it.rate, RATE)));

const d2 = await seedDelivery(order2.id, grade.id, 6, plus(500), plus(505), 'E');
const invB = await api('POST', '/invoices/from-challans', { customerId: customer.id, invoiceDate: TODAY, lines: [{ challanId: d2.challanId, hsnSac: '68109990' }] });
ok('a later invoice adds neither the lump sum nor the already-billed hours', byType(invB, 'transport_lump').length === 0 && byType(invB, 'pump_hours').length === 0 && invB.items.length === 1);

// The pump reconciliation reads "billed" from the invoice lines under a per-hour basis.
const util = await api('GET', `/pump-jobs/report/utilisation?from=${TODAY}&to=${TODAY}`);
const recon = util.reconciliation.rows.find((r) => r.orderId === order2.id);
ok('the pump reconciliation shows the per-hour order billed from its invoice line (3,750)', recon && recon.pumpBasis === 'per_hour' && near(recon.billedPumpCharge, 3750));

await api('POST', `/invoices/${invA.id}/cancel`, { reason: 'test' });
const [jobAfter] = await q(`SELECT invoice_item_id AS "invoiceItemId" FROM pump_jobs WHERE id = $1`, [jobDone]);
ok('cancelling the invoice releases the pump job it billed', jobAfter.invoiceItemId === null);
const invC = await api('POST', '/invoices/from-challans', { customerId: customer.id, invoiceDate: TODAY, lines: [{ challanId: d1.challanId, hsnSac: '68109990' }] });
ok('the next invoice on the order carries the lump sum and the pump hours again', byType(invC, 'transport_lump').length === 1 && byType(invC, 'pump_hours').length === 1 && near(byType(invC, 'pump_hours')[0].quantity, 2.5));
ok('…and the earlier invoice that added nothing is untouched', (await api('GET', `/invoices/${invB.id}`)).items.length === 1);

await owner.destroy();
console.log(`\n${pass} checks passed`);
