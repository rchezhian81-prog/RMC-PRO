/**
 * Pump management integration test.
 *
 * Adds a concrete pump to the vehicle master, plans a pump job against a real
 * order, walks it on_site → pumping → completed, and proves:
 *   - the pump register lists the pump with what it is doing now
 *   - a non-pump vehicle, an inactive pump, a cancelled order are refused
 *   - the job number comes from the PJ- series
 *   - hours are worked out from the start/end stamps and the charge from the basis
 *   - one pump cannot pump on two jobs at once; a finished job is frozen
 *   - the utilisation report totals the pump's hours / m³ and the reconciliation
 *     flags an order that required a pump but has no job
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) < eps;

async function call(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
let TOKEN = '';
async function api(method, path, body) {
  const r = await call(method, path, body);
  if (r.status >= 400 || !r.data?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.data;
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping pump-management — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== pump management (register → job → hours/charge → reconciliation) ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const stamp = Date.now() % 1000000;
const TODAY = new Date().toISOString().slice(0, 10);

const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present', !!(grade && plant && customer));

const pump = await api('POST', '/vehicles', { vehicleNo: `TN8${String(stamp).slice(-4)}PM`, vehicleType: 'concrete_pump', capacityM3: 0 });
const mixer = await api('POST', '/vehicles', { vehicleNo: `TN8${String(stamp).slice(-4)}TM`, vehicleType: 'transit_mixer', capacityM3: 6 });
const operator = await api('POST', '/drivers', { driverCode: `OPR-${stamp}`, driverName: `Pump Operator ${stamp}`, mobile: '9000000021' });

// An order that asks for a pump, with a pump charge on the line.
let q = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 12, ratePerM3: 4800, pumpCharge: 250, pumpRequired: true }],
});
await api('POST', `/quotations/${q.id}/submit`);
q = await api('POST', `/quotations/${q.id}/approve`);
let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'pump test auto-release' });
}

// ---- register ----
let register = await api('GET', '/pump-jobs/pumps');
const reg = register.find((p) => p.id === pump.id);
ok('the pump register lists the new pump as free', !!reg && !reg.currentJobNo && Number(reg.openJobs) === 0);
ok('a transit mixer is not in the pump register', !register.some((p) => p.id === mixer.id));

// ---- refusals ----
const notPump = await call('POST', '/pump-jobs', { pumpVehicleId: mixer.id, scheduledDate: TODAY });
ok('a non-pump vehicle is refused with the fix', notPump.status === 400 && /not a concrete pump/.test(JSON.stringify(notPump.data)));
const badBasis = await call('POST', '/pump-jobs', { pumpVehicleId: pump.id, chargeBasis: 'per_truck' });
ok('an unknown charge basis is refused', badBasis.status === 400);
const badTime = await call('POST', '/pump-jobs', { pumpVehicleId: pump.id, scheduledTime: '25:99' });
ok('a bad scheduled time is refused', badTime.status === 400);

// ---- plan + walk a job ----
const job = await api('POST', '/pump-jobs', {
  pumpVehicleId: pump.id, orderId: order.id, operatorDriverId: operator.id, scheduledDate: TODAY, scheduledTime: '09:30',
  pipelineLengthM: 60, chargeBasis: 'per_m3', rate: 250, remarks: 'Slab pour',
});
ok('job numbered from the PJ- series', /^PJ-/.test(job.jobNo) && job.status === 'planned');
ok('customer and site come from the order', job.customerId === customer.id && job.orderNo === order.orderNo && job.operatorName === operator.driverName);
ok('a planned job charges nothing yet', Number(job.chargeAmount) === 0);

register = await api('GET', '/pump-jobs/pumps');
ok('the register counts the open job', Number(register.find((p) => p.id === pump.id).openJobs) === 1);

const start = new Date(Date.now() - 2 * 3600_000 - 30 * 60_000); // 2h30 ago
let j = await api('POST', `/pump-jobs/${job.id}/status`, { status: 'on_site', at: new Date(start.getTime() - 20 * 60_000).toISOString() });
ok('on_site stamps arrivedAt', j.status === 'on_site' && !!j.arrivedAt);
register = await api('GET', '/pump-jobs/pumps');
ok('the register shows the pump on site at the job', register.find((p) => p.id === pump.id).currentJobNo === job.jobNo);

j = await api('POST', `/pump-jobs/${job.id}/status`, { status: 'pumping', at: start.toISOString() });
ok('pumping stamps pumpingStartAt', j.status === 'pumping' && new Date(j.pumpingStartAt).getTime() === start.getTime());

// A second job on the same pump cannot start pumping while this one pumps.
const job2 = await api('POST', '/pump-jobs', { pumpVehicleId: pump.id, scheduledDate: TODAY, chargeBasis: 'per_hour', rate: 1500 });
const busy = await call('POST', `/pump-jobs/${job2.id}/status`, { status: 'pumping' });
ok('one pump cannot pump on two jobs at once', busy.status === 400 && /already pumping/.test(JSON.stringify(busy.data)));
const cancelPumping = await call('POST', `/pump-jobs/${job.id}/status`, { status: 'cancelled' });
ok('a pumping job cannot be cancelled', cancelPumping.status === 400);
const editPumping = await call('PATCH', `/pump-jobs/${job.id}`, { rate: 300 });
ok('a pumping job\'s plan is frozen', editPumping.status === 400);

j = await api('POST', `/pump-jobs/${job.id}/status`, { status: 'completed', pumpedQuantityM3: 11.5 });
ok('completed records pumped m³', j.status === 'completed' && near(j.pumpedQuantityM3, 11.5));
ok('hours come from the start/end stamps (≈2.5 h)', near(j.pumpHours, 2.5, 0.05));
ok('per-m³ charge = rate × pumped m³', near(j.chargeAmount, 250 * 11.5));
const again = await call('POST', `/pump-jobs/${job.id}/status`, { status: 'pumping' });
ok('a finished job is frozen', again.status === 400);

// job2: per-hour with explicit hours
j = await api('POST', `/pump-jobs/${job2.id}/status`, { status: 'pumping' });
j = await api('POST', `/pump-jobs/${job2.id}/status`, { status: 'completed', pumpedQuantityM3: 4, pumpHours: 1.25 });
ok('per-hour charge = rate × hours', near(j.chargeAmount, 1500 * 1.25) && near(j.pumpHours, 1.25));

// Edit + cancel a planned job.
const job3 = await api('POST', '/pump-jobs', { pumpVehicleId: pump.id, scheduledDate: TODAY, chargeBasis: 'fixed', rate: 8000 });
const edited = await api('PATCH', `/pump-jobs/${job3.id}`, { rate: 9000, remarks: 'Rescheduled' });
ok('a planned job can be edited', near(edited.rate, 9000) && edited.remarks === 'Rescheduled');
const cancelled = await api('POST', `/pump-jobs/${job3.id}/status`, { status: 'cancelled' });
ok('a planned job can be cancelled', cancelled.status === 'cancelled');

// Deactivated pump refused for a new job.
await api('DELETE', `/vehicles/${pump.id}`);
const inactive = await call('POST', '/pump-jobs', { pumpVehicleId: pump.id, scheduledDate: TODAY });
ok('an inactive pump is refused', inactive.status === 400 && /inactive/.test(JSON.stringify(inactive.data)));
await api('PATCH', `/vehicles/${pump.id}/reactivate`);

// ---- list + report ----
const list = await api('GET', `/pump-jobs?vehicleId=${pump.id}`);
ok('the list filters by pump and carries the joins', list.length === 3 && list.every((x) => x.pumpVehicleNo === pump.vehicleNo));
const done = await api('GET', `/pump-jobs?status=completed&vehicleId=${pump.id}`);
ok('the list filters by status', done.length === 2);

const rep = await api('GET', `/pump-jobs/report/utilisation?from=${TODAY}&to=${TODAY}`);
const per = rep.perPump.find((p) => p.vehicleId === pump.id);
ok('utilisation: 2 done, 1 cancelled, ≈3.75 pump hours, 15.5 m³', !!per && per.jobsCompleted === 2 && per.jobsCancelled === 1 && near(per.pumpHours, 3.75, 0.06) && near(per.pumpedM3, 15.5));
ok('utilisation: charges add up', near(per.chargeAmount, 250 * 11.5 + 1500 * 1.25));
const rec = rep.reconciliation.rows.find((r) => r.orderId === order.id);
ok('reconciliation row for the order: pump ₹250/m³ on the order, 11.5 m³ pumped', !!rec && near(rec.pumpChargePerM3, 250) && near(rec.pumpedM3, 11.5));
ok('nothing delivered yet → no quantity flag, no "no job" flag', rec.flags.length === 0);

// An order that requires a pump but has no job is flagged.
let q2 = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 8, ratePerM3: 4800, pumpCharge: 200, pumpRequired: true }],
});
await api('POST', `/quotations/${q2.id}/submit`);
q2 = await api('POST', `/quotations/${q2.id}/approve`);
let order2 = await api('POST', `/order-drafts/from-quotation/${q2.id}`, { plantId: plant.id, orderDate: TODAY });
order2 = await api('POST', `/orders/${order2.id}/confirm`);
const rep2 = await api('GET', `/pump-jobs/report/utilisation?from=${TODAY}&to=${TODAY}`);
const rec2 = rep2.reconciliation.rows.find((r) => r.orderId === order2.id);
ok('an order that bills a pump charge with no job is flagged', !!rec2 && rec2.flags.some((f) => /no pump job/.test(f)));
ok('totals count the flagged order', Number(rep2.reconciliation.totals.flagged) >= 1);

console.log(`\nPUMP MANAGEMENT TEST: ${pass} passed ✓`);
process.exit(0);
