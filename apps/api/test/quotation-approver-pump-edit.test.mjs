/**
 * Approver and preparer on quotations and rate contracts, the rate contract
 * PDF, editing a planned pump job, and the material / plant filters on the
 * inventory reports.
 *
 *   - creating a quotation records who raised it (the preparer by name);
 *     approving records who approved it and when; a revision or a rejection
 *     clears the approval; the PDF endpoint answers application/pdf
 *   - the same on a rate contract, which now has a PDF of its own
 *   - a planned pump job can be moved to another order (the customer and the
 *     site follow), re-timed and re-priced; the charge is worked out again; a
 *     bad time is refused; once pumping has started the plan is frozen
 *   - the confirmed-orders list carries the site name and the pump flag the
 *     picker reads
 *   - the movement and valuation reports narrow to one material / plant and
 *     refuse an id that is not one
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_PLANT_ID, TEST_MATERIAL_ID.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) < eps;

let TOKEN = '';
async function raw(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function api(method, path, body) {
  const r = await raw(method, path, body);
  if (r.status >= 400 || !r.body?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}
/** A PDF endpoint bypasses the JSON envelope: check the status, the type and the magic bytes. */
async function pdf(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') ?? '', isPdf: buf.subarray(0, 4).toString('latin1') === '%PDF', size: buf.length };
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping quotation-approver-pump-edit — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== approver on quotations / rate contracts, pump job edit, inventory report filters ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const me = await api('GET', '/auth/me');
const MY_NAME = String(me?.name ?? me?.user?.name ?? '');
const stamp = Date.now() % 1000000;
const TODAY = new Date().toISOString().slice(0, 10);

const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present', !!(grade && plant && customer && site));

// ---- quotation: preparer, approver, PDF, revision clears the approval ----
let q = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 10, ratePerM3: 4500, transportCharge: 200, gstRate: 18 }],
});
ok('a new quotation names who prepared it', typeof q.preparedByName === 'string' && q.preparedByName.length > 0 && (!MY_NAME || q.preparedByName === MY_NAME));
ok('a draft has no approver and no approval time', q.approvedByName === null && q.approvedAt === null);
let qpdf = await pdf(`/quotations/${q.id}/pdf`);
ok('the draft quotation PDF still renders (says not yet approved)', qpdf.status === 200 && qpdf.type.startsWith('application/pdf') && qpdf.isPdf);

await api('POST', `/quotations/${q.id}/submit`);
const before = Date.now();
q = await api('POST', `/quotations/${q.id}/approve`);
ok('approving records the approver by name', q.approvalStatus === 'approved' && typeof q.approvedByName === 'string' && q.approvedByName.length > 0 && (!MY_NAME || q.approvedByName === MY_NAME));
ok('approving records when', !!q.approvedAt && Math.abs(new Date(q.approvedAt).getTime() - before) < 60_000);
const got = await api('GET', `/quotations/${q.id}`);
ok('GET /quotations/:id returns approvedByName, approvedAt and preparedByName', got.approvedByName === q.approvedByName && got.approvedAt === q.approvedAt && got.preparedByName === q.preparedByName);
qpdf = await pdf(`/quotations/${q.id}/pdf`);
ok('the approved quotation PDF is a PDF (200, application/pdf)', qpdf.status === 200 && qpdf.type.startsWith('application/pdf') && qpdf.isPdf && qpdf.size > 1000);

// The approved quotation becomes the order for the pump job below, before it is revised.
let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'approver test auto-release' });
  order = await api('GET', `/orders/${order.id}`);
}
ok('the order is confirmed', order.orderStatus === 'confirmed');

// A second order for the move: another approved quotation against the same customer.
let q2 = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 8, ratePerM3: 4600, pumpCharge: 300, pumpRequired: true }],
});
await api('POST', `/quotations/${q2.id}/submit`);
q2 = await api('POST', `/quotations/${q2.id}/approve`);
let order2 = await api('POST', `/order-drafts/from-quotation/${q2.id}`, { plantId: plant.id, orderDate: TODAY });
order2 = await api('POST', `/orders/${order2.id}/confirm`);
if (String(order2.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order2.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'approver test auto-release' });
  order2 = await api('GET', `/orders/${order2.id}`);
}

const revised = await api('POST', `/quotations/${q.id}/revisions`, { changeReason: 'approver test' });
ok('a new revision clears the approver and the time', revised.approvalStatus === 'draft' && revised.approvedByName === null && revised.approvedAt === null);
await api('POST', `/quotations/${q.id}/submit`);
const rejected = await api('POST', `/quotations/${q.id}/reject`, { reason: 'approver test' });
ok('a rejected quotation has no approver', rejected.approvalStatus === 'rejected' && rejected.approvedByName === null);

// ---- rate contract: the same, plus its own PDF ----
let rc = await api('POST', '/rate-contracts', {
  customerId: customer.id, validFrom: TODAY, paymentTerms: 'Credit — 30 days', transportTerms: 'Up to 15 km included',
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, ratePerM3: 4700, transportCharge: 150, pumpCharge: 250, gstRate: 18 }],
});
ok('a new rate contract names who prepared it', typeof rc.preparedByName === 'string' && rc.preparedByName.length > 0 && rc.approvedByName === null);
let rpdf = await pdf(`/rate-contracts/${rc.id}/pdf`);
ok('the draft rate contract PDF renders', rpdf.status === 200 && rpdf.type.startsWith('application/pdf') && rpdf.isPdf);
await api('POST', `/rate-contracts/${rc.id}/submit`);
rc = await api('POST', `/rate-contracts/${rc.id}/approve`);
ok('approving a rate contract records who and when', rc.approvalStatus === 'approved' && typeof rc.approvedByName === 'string' && !!rc.approvedAt);
const rcGot = await api('GET', `/rate-contracts/${rc.id}`);
ok('GET /rate-contracts/:id returns the names and the time', rcGot.approvedByName === rc.approvedByName && rcGot.approvedAt === rc.approvedAt && rcGot.preparedByName === rc.preparedByName);
rpdf = await pdf(`/rate-contracts/${rc.id}/pdf`);
ok('the approved rate contract PDF is a PDF (200, application/pdf)', rpdf.status === 200 && rpdf.type.startsWith('application/pdf') && rpdf.isPdf && rpdf.size > 1000);
const missing = await fetch(`${API_BASE}/rate-contracts/00000000-0000-4000-8000-000000000000/pdf`, { headers: { Authorization: `Bearer ${TOKEN}` } });
ok('an unknown rate contract PDF is a 404, not a blank file', missing.status === 404);

let rc2 = await api('POST', '/rate-contracts', { customerId: customer.id, items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, ratePerM3: 4000 }] });
await api('POST', `/rate-contracts/${rc2.id}/submit`);
rc2 = await api('POST', `/rate-contracts/${rc2.id}/reject`, { reason: 'approver test' });
ok('a rejected rate contract has no approver', rc2.approvalStatus === 'rejected' && rc2.approvedByName === null && rc2.approvedAt === null);

// ---- orders list: what the pump picker reads ----
const confirmed = await api('GET', '/orders?status=confirmed&limit=200');
const o1 = confirmed.find((o) => String(o.id) === String(order.id));
const o2 = confirmed.find((o) => String(o.id) === String(order2.id));
ok('the confirmed-orders list carries the site name', !!o1 && o1.siteName === site.siteName);
// The first order has no pump charge, so its flag is the site's; the second prices a pump on the line.
ok('the confirmed-orders list says whether a pump is wanted', !!o1 && !!o2 && o1.pumpRequired === Boolean(site.pumpRequired) && o2.pumpRequired === true);

// ---- pump job: edit while planned, frozen once pumping ----
const pump = await api('POST', '/vehicles', { vehicleNo: `TN9${String(stamp).slice(-4)}PE`, vehicleType: 'concrete_pump', capacityM3: 0 });
const operator = await api('POST', '/drivers', { driverCode: `OPE-${stamp}`, driverName: `Pump Editor ${stamp}`, mobile: '9000000031' });
let job = await api('POST', '/pump-jobs', { pumpVehicleId: pump.id, orderId: order.id, scheduledDate: TODAY, scheduledTime: '09:00', chargeBasis: 'per_m3', rate: 250 });
ok('the job is planned against the first order', job.status === 'planned' && String(job.orderId) === String(order.id));

const edited = await api('PATCH', `/pump-jobs/${job.id}`, {
  orderId: order2.id, operatorDriverId: operator.id, scheduledTime: '14:30', pipelineLengthM: 45, chargeBasis: 'fixed', rate: 6000, remarks: 'moved to the second pour',
});
ok('the job moved to the other order and the customer and site followed', String(edited.orderId) === String(order2.id) && String(edited.customerId) === String(customer.id) && String(edited.siteId) === String(site.id));
ok('the operator, time, pipeline, basis, rate and remarks were saved', String(edited.operatorDriverId) === String(operator.id) && edited.scheduledTime === '14:30' && near(edited.pipelineLengthM, 45) && edited.chargeBasis === 'fixed' && near(edited.rate, 6000) && edited.remarks === 'moved to the second pour');
ok('the charge was worked out again from the new basis', near(edited.chargeAmount, 6000));
const cleared = await api('PATCH', `/pump-jobs/${job.id}`, { orderId: null, operatorDriverId: null });
ok('a blank order and operator clear them', cleared.orderId === null && cleared.operatorDriverId === null);
const badTime = await raw('PATCH', `/pump-jobs/${job.id}`, { scheduledTime: '9 am' });
ok('a time that is not HH:MM is refused', badTime.status === 400);
const badRate = await raw('PATCH', `/pump-jobs/${job.id}`, { rate: -1 });
ok('a negative rate is refused', badRate.status === 400);
await api('PATCH', `/pump-jobs/${job.id}`, { orderId: order2.id });

job = await api('POST', `/pump-jobs/${job.id}/status`, { status: 'on_site' });
const onSite = await api('PATCH', `/pump-jobs/${job.id}`, { remarks: 'pump on site, waiting' });
ok('the plan can still change while the pump is on site', onSite.status === 'on_site' && onSite.remarks === 'pump on site, waiting');
job = await api('POST', `/pump-jobs/${job.id}/status`, { status: 'pumping' });
const frozen = await raw('PATCH', `/pump-jobs/${job.id}`, { rate: 7000 });
ok('once pumping has started the plan is refused', frozen.status === 400 && /pumping/.test(String(frozen.body?.error?.message ?? '')));
job = await api('POST', `/pump-jobs/${job.id}/status`, { status: 'completed', pumpedQuantityM3: 8, pumpHours: 1.5 });
ok('the job completed with the fixed charge', job.status === 'completed' && near(job.chargeAmount, 6000));

// ---- inventory reports: material / plant filters ----
const materials = await api('GET', '/materials');
const M = String(process.env.TEST_MATERIAL_ID || materials[0].id);
const other = materials.find((m) => String(m.id) !== M);
const P = String(process.env.TEST_PLANT_ID || plant.id);
// An opening writes an absolute quantity: add to what is there so no later
// test finds less stock than it left.
const balances = await api('GET', '/stock/balances');
const onHand = (materialId) => Number((Array.isArray(balances) ? balances : []).find((b) => String(b.materialId) === String(materialId) && String(b.plantId) === P)?.currentQuantity ?? 0);
await api('POST', '/stock/opening', { materialId: M, plantId: P, quantity: Math.max(0, onHand(M)) + 50 });
if (other) await api('POST', '/stock/opening', { materialId: other.id, plantId: P, quantity: Math.max(0, onHand(other.id)) + 20 });

const movementM = await api('GET', `/inventory-reports/movement?materialId=${M}`);
ok('movement narrowed to a material lists only that material', movementM.length >= 1 && movementM.every((r) => String(r.materialId) === M));
if (other) {
  const movementO = await api('GET', `/inventory-reports/movement?materialId=${other.id}`);
  ok('movement narrowed to another material leaves the first out', movementO.length >= 1 && movementO.every((r) => String(r.materialId) === String(other.id)));
}
// The report groups by the label the ledger row carried, so one material can
// be more than one row once an earlier suite has renamed it; every row is it.
const movementP = await api('GET', `/inventory-reports/movement?plantId=${P}&materialId=${M}`);
ok('movement narrowed to a plant and a material answers', movementP.length >= 1 && movementP.every((r) => String(r.materialId) === M));
const movementAll = await api('GET', '/inventory-reports/movement');
ok('movement without a filter is wider or equal', movementAll.length >= movementM.length);

const valuationP = await api('GET', `/inventory-reports/valuation?plantId=${P}`);
ok('valuation narrowed to a plant lists only that plant, with its name', valuationP.rows.length >= 1 && valuationP.rows.every((r) => String(r.plantId) === P && typeof r.plantName === 'string'));
const valuationM = await api('GET', `/inventory-reports/valuation?materialId=${M}&plantId=${P}`);
ok('valuation narrowed to a material and plant is the one balance', valuationM.rows.length === 1 && String(valuationM.rows[0].materialId) === M && near(valuationM.total, Number(valuationM.rows[0].value)));
const badFilter = await raw('GET', '/inventory-reports/valuation?materialId=not-an-id');
ok('a filter that is not an id is refused (400)', badFilter.status === 400);

console.log(`\nQUOTATION APPROVER / PUMP EDIT TEST: ${pass} passed`);
process.exit(0);
