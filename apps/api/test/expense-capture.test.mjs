/**
 * Expense-capture integration test (Plan D4).
 *
 * Proves the voucher lifecycle and cost allocation end to end:
 *   - expense group + heads masters
 *   - a voucher with lines allocated to a plant, a vehicle and general — total
 *     rolled up, cost-object labels resolved server-side
 *   - posting commits it (audited); a posted voucher cannot be cancelled
 *   - the allocation report reconciles by cost object and by head
 *   - a draft voucher can be cancelled
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD. The
 * `expenses` module is enabled for the pilot tenant by the runner.
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

if (!LOGIN || !PASSWORD) {
  console.log('(skipping expense-capture — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== expense capture (masters → voucher → post → allocation report) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

const sfx = String(Date.now()).slice(-5);
const plants = await api('GET', '/plants');
const plant = Array.isArray(plants) ? plants[0] : null;
ok('a booking plant exists', !!plant);

// A vehicle to allocate a line to (seeded by the plant-master fixture).
let vehicle = await lookup('vehicles', 'vehicleNo', 'TN00AA0000');
if (!vehicle) vehicle = await api('POST', '/vehicles', { vehicleNo: `TN10EX${sfx.slice(-4)}`, vehicleType: 'Transit Mixer', capacityM3: 6, ownershipType: 'own' });
ok('a vehicle exists to allocate to', !!vehicle);

// ---- A. Masters ----
const group = await api('POST', '/expense-groups', { groupCode: `FUEL-${sfx}`, groupName: 'Fuel & Lubricants' });
ok('expense group created', group.groupName === 'Fuel & Lubricants');
const diesel = await api('POST', '/expense-heads', { headCode: `DSL-${sfx}`, headName: 'Diesel', groupId: group.id, defaultCostType: 'vehicle' });
const bata = await api('POST', '/expense-heads', { headCode: `BATA-${sfx}`, headName: 'Driver Bata', groupId: group.id, defaultCostType: 'vehicle' });
ok('expense heads created under the group', !!diesel.id && !!bata.id);
const heads = await api('GET', '/expense-heads');
const dieselRow = heads.find((h) => String(h.id) === String(diesel.id));
ok('head list resolves the group label', dieselRow && dieselRow.groupLabel === 'Fuel & Lubricants');

// ---- B. Voucher with allocated lines ----
const voucher = await api('POST', '/expense-vouchers', {
  payee: 'IOCL Pump', paymentMode: 'cash', plantId: plant.id,
  lines: [
    { expenseHeadId: diesel.id, amount: 6000, allocationType: 'plant', allocationId: plant.id, description: 'Genset diesel' },
    { expenseHeadId: bata.id, amount: 3000, allocationType: 'vehicle', allocationId: vehicle.id, description: 'Trip bata' },
    { expenseHeadId: diesel.id, amount: 1000, allocationType: 'general' },
  ],
});
ok('voucher total rolled up from lines', near(voucher.totalAmount, 10000));
ok('voucher opens in draft with three lines', voucher.status === 'draft' && voucher.lines.length === 3);
const plantLine = voucher.lines.find((l) => l.allocationType === 'plant');
ok('cost-object label resolved server-side', plantLine.allocationLabel === plant.plantName);
ok('expense head label denormalised onto the line', plantLine.expenseHeadLabel === 'Diesel');

// ---- C. Post commits it; a posted voucher cannot be cancelled ----
const posted = await api('POST', `/expense-vouchers/${voucher.id}/post`);
ok('voucher posts', posted.status === 'posted');
let blocked = false;
try { await api('POST', `/expense-vouchers/${voucher.id}/cancel`); } catch { blocked = true; }
ok('a posted voucher cannot be cancelled', blocked);

// ---- D. Allocation report reconciles ----
const report = await api('GET', '/expense-vouchers/report/allocation');
ok('report by-cost-object total matches the voucher', near(report.byCostObject.total, 10000));
const plantBucket = report.byCostObject.buckets.find((b) => b.type === 'plant');
ok('plant cost object rolled up to 6000 (60%)', near(plantBucket.amount, 6000) && near(plantBucket.share, 60));
const generalBucket = report.byCostObject.buckets.find((b) => b.type === 'general');
ok('general (unallocated) bucket present at 1000', near(generalBucket.amount, 1000));
const dieselBucket = report.byHead.buckets.find((b) => b.label === 'Diesel');
ok('by-head rolls both diesel lines to 7000', near(dieselBucket.amount, 7000));

// ---- E. A draft voucher can be cancelled ----
const draft2 = await api('POST', '/expense-vouchers', { payee: 'Misc', lines: [{ expenseHeadId: bata.id, amount: 500, allocationType: 'general' }] });
const cancelled = await api('POST', `/expense-vouchers/${draft2.id}/cancel`);
ok('a draft voucher cancels', cancelled.status === 'cancelled');
ok('cancelling a draft leaves the posted report unchanged', near((await api('GET', '/expense-vouchers/report/allocation')).byCostObject.total, 10000));

console.log(`\nEXPENSE CAPTURE TEST: ${pass} passed ✓`);
process.exit(0);
