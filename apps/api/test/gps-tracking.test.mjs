/**
 * GPS tracking integration test (activate the `gps` module).
 *
 * Builds a real in-transit dispatch (quotation → order → queue → ticket →
 * confirm → dispatch), then proves:
 *   - a location ping is recorded and rolled onto the dispatch's latest fix
 *   - the live board lists the in-transit dispatch with its last position
 *   - the track returns the ordered pings with a non-zero path length
 *   - an out-of-range coordinate is rejected
 *   - a cancelled dispatch refuses further pings
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD. The
 * `gps` module is enabled for the pilot tenant by the runner.
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

if (!LOGIN || !PASSWORD) {
  console.log('(skipping gps-tracking — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== gps tracking (ping → live board → track) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present (grade/plant/mix/customer)', !!(grade && plant && mix && customer));

const TODAY = new Date().toISOString().slice(0, 10);
const QTY = 6;

// ---- Build a confirmed batch ticket → dispatch ----
let q = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: QTY, ratePerM3: 4800 }],
});
await api('POST', `/quotations/${q.id}/submit`);
q = await api('POST', `/quotations/${q.id}/approve`);
let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'GPS test auto-release' });
}
const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: QTY, mixDesignId: mix.id });
await api('POST', `/batch-tickets/${ticket.id}/actuals`, {
  materials: ticket.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
});
ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {});
await api('POST', `/dispatches/${dispatch.id}/status`, { status: 'left_plant' });
ok('dispatch is on the road (left_plant)', true);

// ---- A. Record location pings ----
const p1 = await api('POST', `/gps/dispatches/${dispatch.id}/ping`, { latitude: 13.0000, longitude: 80.0000, speedKmph: 40 });
ok('first ping recorded', near(p1.latitude, 13.0) && p1.source === 'device');
await api('POST', `/gps/dispatches/${dispatch.id}/ping`, { latitude: 13.0100, longitude: 80.0000, speedKmph: 45 });
const p3 = await api('POST', `/gps/dispatches/${dispatch.id}/ping`, { latitude: 13.0200, longitude: 80.0000, speedKmph: 38 });
ok('third ping recorded', near(p3.latitude, 13.02));

const fresh = await api('GET', `/dispatches/${dispatch.id}`);
ok('dispatch carries the latest fix', near(fresh.lastLatitude, 13.02) && near(fresh.lastLongitude, 80.0));
ok('dispatch carries the latest speed', near(fresh.lastSpeedKmph, 38));

// ---- B. Live board ----
const live = await api('GET', '/gps/live');
const mine = (Array.isArray(live) ? live : []).find((d) => String(d.id) === String(dispatch.id));
ok('live board lists the in-transit dispatch', !!mine && near(mine.lastLatitude, 13.02));
ok('live board reports an age in seconds', Number.isFinite(Number(mine.ageSeconds)));

// ---- C. Track ----
const track = await api('GET', `/gps/dispatches/${dispatch.id}/track`);
ok('track returns all three fixes', track.summary.pings === 3);
ok('track path length is non-zero', Number(track.summary.pathKm) > 2 && Number(track.summary.pathKm) < 3);

// ---- D. Validation + closed trip ----
let badCoord = false;
try { await api('POST', `/gps/dispatches/${dispatch.id}/ping`, { latitude: 999, longitude: 80 }); } catch { badCoord = true; }
ok('an out-of-range coordinate is rejected', badCoord);

await api('POST', `/dispatches/${dispatch.id}/status`, { status: 'cancelled' });
let closed = false;
try { await api('POST', `/gps/dispatches/${dispatch.id}/ping`, { latitude: 13.03, longitude: 80 }); } catch { closed = true; }
ok('a cancelled dispatch refuses further pings', closed);

console.log(`\nGPS TRACKING TEST: ${pass} passed ✓`);
process.exit(0);
