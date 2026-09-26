/**
 * GPS vendor feed integration test.
 *
 * Issues an ingest key from Settings, then posts positions the way a tracking
 * vendor would (no login, the key in a header) and proves:
 *   - a wrong / missing / revoked key is refused (401) and never touches data
 *   - a batch with mixed spellings updates each vehicle's last known position
 *     (matched by registration number or by the GPS device id) and reports
 *     what was ignored and why
 *   - a fix for a vehicle on a live trip is recorded on the dispatch and shows
 *     on the live board with source 'vendor'
 *   - an older fix never overwrites a newer position
 *   - the fleet endpoint lists idle vehicles with their position
 *   - issuing a new key retires the old one; the status never shows the key
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...headers },
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
/** A vendor post: no JWT, only the key. */
async function vendor(key, body, viaQuery = false) {
  const res = await fetch(`${API_BASE}/gps/ingest${viaQuery ? `?key=${encodeURIComponent(key)}` : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(viaQuery ? {} : { 'x-rmc-gps-key': key }) }, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping gps-vendor-feed — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== gps vendor feed (key → positions → fleet + live board) ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const stamp = Date.now() % 1000000;

// ---- key ----
let ks = await api('GET', '/gps/ingest-key');
const hadKey = ks.configured;
const issued = await api('POST', '/gps/ingest-key', { label: 'Test vendor' });
const KEY = issued.key;
ok('a key is issued once, with a hint and label', /^rmcgps_/.test(KEY) && issued.keyHint === KEY.slice(-4) && issued.label === 'Test vendor');
ks = await api('GET', '/gps/ingest-key');
ok('status shows the hint, never the key', ks.configured === true && ks.keyHint === KEY.slice(-4) && !JSON.stringify(ks).includes(KEY));
void hadKey;

// ---- vehicles ----
const v1 = await api('POST', '/vehicles', { vehicleNo: `KA7${String(stamp).slice(-4)}A`, vehicleType: 'transit_mixer', capacityM3: 7 });
const v2 = await api('POST', '/vehicles', { vehicleNo: `KA7${String(stamp).slice(-4)}B`, vehicleType: 'transit_mixer', capacityM3: 7, gpsDeviceId: `IMEI${stamp}` });

// ---- refusals ----
let r = await vendor('', [{ vehicleNo: v1.vehicleNo, lat: 13, lng: 80 }]);
ok('no key → 401', r.status === 401);
r = await vendor('rmcgps_wrongwrongwrongwrongwrongwrongwrongwr', [{ vehicleNo: v1.vehicleNo, lat: 13, lng: 80 }]);
ok('wrong key → 401', r.status === 401 && /not valid/.test(JSON.stringify(r.data)));
let fleet = await api('GET', '/gps/fleet');
ok('a refused post touched nothing', !fleet.find((v) => v.id === v1.id)?.lastLocationAt);

// ---- a mixed batch ----
const t0 = new Date(Date.now() - 60_000);
r = await vendor(KEY, [
  { vehicleNo: v1.vehicleNo.replace(/^(..)(..)/, '$1 $2-'), lat: 13.01, lng: 80.01, speed: 35, timestamp: t0.toISOString() },
  { imei: `imei${stamp}`, latitude: 12.99, longitude: 79.99, course: 180, time: Math.floor(t0.getTime() / 1000) },
  { vehicleNo: 'ZZ99NOPE0000', lat: 13, lng: 80 },
  { vehicleNo: v1.vehicleNo, lat: 999, lng: 80 },
]);
ok('the batch is accepted with a summary', r.status === 201 || r.status === 200);
const out = r.data.data;
ok('two accepted, two rejected with reasons', out.accepted === 2 && out.rejected.length === 2 && out.rejected.some((x) => /no vehicle matches/.test(x.reason)) && out.rejected.some((x) => /latitude/.test(x.reason)));
ok('two vehicles updated, no trip was live', out.vehiclesUpdated === 2 && out.tripsUpdated === 0);
fleet = await api('GET', '/gps/fleet');
const f1 = fleet.find((v) => v.id === v1.id);
const f2 = fleet.find((v) => v.id === v2.id);
ok('vehicle matched by (spaced, hyphenated) number carries the fix', !!f1 && near(f1.lastLatitude, 13.01) && near(f1.lastSpeedKmph, 35) && !f1.dispatchId);
ok('vehicle matched by device id carries the fix', !!f2 && near(f2.lastLatitude, 12.99));
ks = await api('GET', '/gps/ingest-key');
ok('the key records when it was last used', !!ks.lastUsedAt);

// An OLDER fix must not overwrite the newer one.
r = await vendor(KEY, { vehicleNo: v1.vehicleNo, lat: 10, lng: 70, timestamp: new Date(t0.getTime() - 3600_000).toISOString() }, true);
ok('a single object via ?key= is accepted', r.data?.data?.accepted === 1);
fleet = await api('GET', '/gps/fleet');
ok('an older fix does not move the vehicle back', near(fleet.find((v) => v.id === v1.id).lastLatitude, 13.01));

// ---- a live trip on v1 ----
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
const TODAY = new Date().toISOString().slice(0, 10);
let q = await api('POST', '/quotations', { customerId: customer.id, siteId: site?.id, quotationDate: TODAY, items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 6, ratePerM3: 4800 }] });
await api('POST', `/quotations/${q.id}/submit`);
q = await api('POST', `/quotations/${q.id}/approve`);
let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'gps vendor test auto-release' });
}
const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: 6, mixDesignId: mix.id });
await api('POST', `/batch-tickets/${ticket.id}/actuals`, { materials: ticket.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })) });
ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, { vehicleId: v1.id });
await api('POST', `/dispatches/${dispatch.id}/status`, { status: 'left_plant' });

r = await vendor(KEY, [{ vehicleNo: v1.vehicleNo, lat: 13.05, lng: 80.05, speed: 41 }, { vehicleNo: v1.vehicleNo, lat: 13.06, lng: 80.06, speed: 43 }]);
ok('fixes for a vehicle on the road update the trip', r.data.data.accepted === 2 && r.data.data.tripsUpdated === 2);
const fresh = await api('GET', `/dispatches/${dispatch.id}`);
ok('the dispatch carries the vendor fix', near(fresh.lastLatitude, 13.06) && near(fresh.lastSpeedKmph, 43));
const live = await api('GET', '/gps/live');
ok('the live board shows the truck', !!live.find((x) => x.id === dispatch.id && near(x.lastLatitude, 13.06)));
const track = await api('GET', `/gps/dispatches/${dispatch.id}/track`);
ok('the track holds the two vendor pings tagged vendor', track.pings.filter((p) => p.source === 'vendor').length === 2);
fleet = await api('GET', '/gps/fleet');
ok('the fleet row names the trip the vehicle is on', fleet.find((v) => v.id === v1.id).dispatchNo === dispatch.dispatchNo);

// ---- rotate + revoke ----
const rotated = await api('POST', '/gps/ingest-key', {});
r = await vendor(KEY, [{ vehicleNo: v1.vehicleNo, lat: 13, lng: 80 }]);
ok('the old key stops working the moment a new one is issued', r.status === 401);
r = await vendor(rotated.key, [{ vehicleNo: v1.vehicleNo, lat: 13.07, lng: 80.07 }]);
ok('the new key works', r.data?.data?.accepted === 1);
const rev = await api('DELETE', '/gps/ingest-key');
ok('revoke reports it did something', rev.revoked === true);
r = await vendor(rotated.key, [{ vehicleNo: v1.vehicleNo, lat: 13, lng: 80 }]);
ok('a revoked key is refused', r.status === 401);
ks = await api('GET', '/gps/ingest-key');
ok('status reads no key after revoke', ks.configured === false);

console.log(`\nGPS VENDOR FEED TEST: ${pass} passed ✓`);
process.exit(0);
