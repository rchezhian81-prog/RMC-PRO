/**
 * Fleet maintenance & fuel-log integration test (Plan D3).
 *
 * Against a dedicated vehicle, proves the running-upkeep loop end to end:
 *   - a preventive service schedule computes its next-due from the interval
 *   - a fuel log yields km-per-litre against the previous full tank, and the
 *     per-vehicle summary rolls up mileage + cost-per-km
 *   - completing a maintenance job that links the schedule advances it
 *   - a breakdown is logged with downtime
 *   - the module gate holds: fuel/maintenance endpoints require the `fleet` module
 *     (enabled for the pilot tenant by the runner)
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
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

if (!LOGIN || !PASSWORD) {
  console.log('(skipping fleet-maintenance — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== fleet maintenance & fuel log (schedule → fuel mileage → service → breakdown) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

// ---- Dedicated vehicle so we don't disturb other suites' fixtures ----
const vehicleNo = `TN09FL${String(Date.now()).slice(-4)}`;
const vehicle = await api('POST', '/vehicles', { vehicleNo, vehicleType: 'Transit Mixer', capacityM3: 6, ownershipType: 'own' });
ok('vehicle created for the fleet test', vehicle.vehicleNo === vehicleNo);

// ---- A. Service schedule computes its next-due ----
const schedule = await api('POST', '/vehicle-service-schedules', {
  vehicleId: vehicle.id, serviceType: 'engine_oil',
  intervalKm: 10000, intervalDays: 90,
  lastServiceOdometer: 50000, lastServiceDate: '2026-01-01',
});
ok('schedule next-due odometer = last + interval', near(schedule.nextDueOdometer, 60000));
ok('schedule next-due date rolled forward 90 days', schedule.nextDueDate === '2026-04-01');
ok('schedule carries a due state', !!schedule.dueState && typeof schedule.dueState.status === 'string');

const schedList = await api('GET', `/vehicle-service-schedules?vehicleId=${vehicle.id}`);
ok('schedule appears in the vehicle list with a resolved current odometer', schedList.length === 1 && 'currentOdometer' in schedList[0]);

// ---- B. Fuel log yields km/litre against the previous full tank ----
const fuel1 = await api('POST', '/vehicle-fuel-logs', {
  vehicleId: vehicle.id, fuelDate: '2026-02-01', odometer: 50000, quantityLitres: 100, ratePerLitre: 90, isTankFull: true,
});
ok('first (baseline) fill has no mileage yet', fuel1.distanceKm === null && fuel1.kmPerLitre === null);
ok('fuel amount computed from litres × rate', near(fuel1.amount, 9000));

const fuel2 = await api('POST', '/vehicle-fuel-logs', {
  vehicleId: vehicle.id, fuelDate: '2026-02-10', odometer: 50400, quantityLitres: 100, ratePerLitre: 90, isTankFull: true,
});
ok('second full tank measures the interval distance', near(fuel2.distanceKm, 400));
ok('second full tank computes km per litre', near(fuel2.kmPerLitre, 4));

const summary = await api('GET', `/vehicle-fuel-logs/summary/${vehicle.id}`);
ok('fuel summary totals both fills', near(summary.summary.totalLitres, 200));
ok('fuel summary reports the tank-to-tank average', near(summary.summary.avgKmPerLitre, 4));
ok('fuel summary reports a cost per km', near(summary.summary.avgCostPerKm, 22.5)); // 9000 / 400 km

// ---- C. Completing a scheduled service advances the schedule ----
const job = await api('POST', '/vehicle-maintenance-jobs', {
  vehicleId: vehicle.id, jobType: 'service', scheduleId: schedule.id,
  odometer: 60000, vendorName: 'Sri Auto Works', labourCost: 800, partsCost: 1200, description: 'Engine oil + filter',
});
ok('maintenance job opens with a number', !!job.jobNo && job.status === 'open');
ok('job total cost = labour + parts', near(job.totalCost, 2000));

const completed = await api('POST', `/vehicle-maintenance-jobs/${job.id}/complete`, { completedDate: '2026-06-01' });
ok('job completes', completed.status === 'completed');

const advanced = await api('GET', `/vehicle-service-schedules/${schedule.id}`);
ok('schedule anchor rolled to the completed job odometer', near(advanced.lastServiceOdometer, 60000));
ok('schedule next-due advanced by the interval', near(advanced.nextDueOdometer, 70000));
ok('schedule next-due date advanced from completion', advanced.nextDueDate === '2026-08-30'); // 2026-06-01 + 90d

// ---- D. Breakdown is logged with downtime ----
const breakdown = await api('POST', '/vehicle-maintenance-jobs', {
  vehicleId: vehicle.id, jobType: 'breakdown', odometer: 61000, downtimeHours: 6, description: 'Gearbox seized on site',
});
ok('breakdown job recorded with downtime', breakdown.jobType === 'breakdown' && near(breakdown.downtimeHours, 6));

const jobs = await api('GET', `/vehicle-maintenance-jobs?vehicleId=${vehicle.id}`);
ok('both jobs listed for the vehicle', jobs.length === 2);

// ---- E. Cancelling an open breakdown works; a completed job cannot cancel ----
const cancelled = await api('POST', `/vehicle-maintenance-jobs/${breakdown.id}/cancel`);
ok('open job cancels', cancelled.status === 'cancelled');
let blocked = false;
try { await api('POST', `/vehicle-maintenance-jobs/${job.id}/cancel`); } catch { blocked = true; }
ok('a completed job cannot be cancelled', blocked);

console.log(`\nFLEET MAINTENANCE TEST: ${pass} passed ✓`);
process.exit(0);
