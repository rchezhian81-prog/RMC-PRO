/**
 * Driver phone screen (the `driver_app` module) integration test.
 *
 * Builds a real in-transit dispatch assigned to a driver, links that driver to a
 * login with the Driver role, then as that driver proves:
 *   - /driver/me says who they are and which vehicle is theirs
 *   - /driver/trips lists only their trips (a second driver's load is absent)
 *   - status moves go through the board's transition rules and stamp times
 *   - a location fix from the phone lands on the dispatch and the live board
 *   - another driver's trip is refused (403), a board-only move is refused (400)
 *   - a driver login has no access to the board itself (403 on /dispatches/:id/status)
 *   - an unlinked login gets linked:false with plain-words guidance
 *   - a login cannot be linked twice, or to a foreign user id
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;

async function call(method, path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
let TOKEN = '';
async function api(method, path, body, token = TOKEN) {
  const r = await call(method, path, body, token);
  if (r.status >= 400 || !r.data?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.data;
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping driver-app — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== driver app (my trips → status → location) ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const stamp = Date.now() % 1000000;
const DRIVER_PW = 'Driver#Phone2026';

// ---- fixtures: two drivers, two logins, one vehicle ----
const roles = await api('GET', '/roles');
const driverRole = roles.find((r) => r.roleKey === 'driver');
ok('the Driver role is provisioned', !!driverRole);
const perms = await api('GET', `/roles/${driverRole.id}/permissions`);
const catalog = await api('GET', '/roles/permissions-catalog');
const keyOf = new Map(catalog.map((p) => [String(p.id), String(p.permissionKey)]));
const held = (Array.isArray(perms) ? perms : perms?.permissionIds ?? []).map((x) => keyOf.get(String(x?.permissionId ?? x?.id ?? x)) ?? x?.permissionKey ?? String(x));
ok('the Driver role holds driver.trips and nothing about the board', held.includes('driver.trips') && !held.includes('dispatch.update_status'));

const u1 = await api('POST', '/users', { name: `Phone Driver ${stamp}`, email: `driver1.${stamp}@ci.test`, password: DRIVER_PW, roleId: driverRole.id });
const u2 = await api('POST', '/users', { name: `Other Driver ${stamp}`, email: `driver2.${stamp}@ci.test`, password: DRIVER_PW, roleId: driverRole.id });
const d1 = await api('POST', '/drivers', { driverCode: `DRV-P1-${stamp}`, driverName: `Phone Driver ${stamp}`, mobile: '9000000011', userId: u1.id });
ok('driver 1 created with a login link', d1.userId === u1.id);
const d2 = await api('POST', '/drivers', { driverCode: `DRV-P2-${stamp}`, driverName: `Other Driver ${stamp}`, mobile: '9000000012', userId: u2.id });

// The same login cannot stand for two drivers; a foreign user id is refused.
let dup = await call('POST', '/drivers', { driverCode: `DRV-P3-${stamp}`, driverName: 'Dup', userId: u1.id }, TOKEN);
ok('a login already linked to a driver is refused', dup.status === 400 && /already linked/.test(JSON.stringify(dup.data)));
let foreign = await call('POST', '/drivers', { driverCode: `DRV-P4-${stamp}`, driverName: 'Foreign', userId: '00000000-0000-0000-0000-000000000001' }, TOKEN);
ok('an unknown login account is refused', foreign.status === 400);

const vehicle = await api('POST', '/vehicles', { vehicleNo: `TN9${String(stamp).slice(-4)}P`, vehicleType: 'transit_mixer', capacityM3: 6, driverId: d1.id });

// ---- a dispatch for driver 1 and one for driver 2 ----
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present', !!(grade && plant && mix && customer));
const TODAY = new Date().toISOString().slice(0, 10);

async function makeDispatch(driverId, qty, vehicleId = vehicle.id) {
  let q = await api('POST', '/quotations', {
    customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
    items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: qty, ratePerM3: 4800 }],
  });
  await api('POST', `/quotations/${q.id}/submit`);
  q = await api('POST', `/quotations/${q.id}/approve`);
  let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
  order = await api('POST', `/orders/${order.id}/confirm`);
  if (String(order.orderStatus) === 'credit_hold') {
    const holds = await api('GET', '/credit-holds?status=pending');
    const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
    if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'driver test auto-release' });
  }
  const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
  const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
  let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: qty, mixDesignId: mix.id });
  await api('POST', `/batch-tickets/${ticket.id}/actuals`, {
    materials: ticket.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
  });
  ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
  return api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, { vehicleId: vehicleId ?? undefined, driverId });
}
const mine = await makeDispatch(d1.id, 6);
// The other driver's load goes on no vehicle, so the fleet row for OUR vehicle names OUR trip.
const theirs = await makeDispatch(d2.id, 5, null);
ok('two dispatches created (one per driver)', mine.driverId === d1.id && theirs.driverId === d2.id);

// ---- as driver 1 ----
const T1 = (await api('POST', '/auth/login', { login: `driver1.${stamp}@ci.test`, password: DRIVER_PW })).access_token;
const me = await api('GET', '/driver/me', undefined, T1);
ok('driver/me: linked, names the driver and the vehicle', me.linked === true && me.driver?.id === d1.id && me.vehicle?.id === vehicle.id);
ok('driver/me reports whether GPS is in the plan', typeof me.gpsEnabled === 'boolean');

let trips = await api('GET', '/driver/trips', undefined, T1);
ok('my trips lists my dispatch and not the other driver\'s', trips.some((t) => t.id === mine.id) && !trips.some((t) => t.id === theirs.id));
const trip = trips.find((t) => t.id === mine.id);
ok('a trip carries customer, site, grade, quantity and vehicle', trip.customerName && trip.gradeLabel && near(trip.quantityM3, 6) && trip.vehicleNo === vehicle.vehicleNo);
ok('a fresh trip is open', trip.open === true && trip.dispatchStatus === 'loaded');

// Board is closed to a driver login.
const board = await call('POST', `/dispatches/${mine.id}/status`, { status: 'left_plant' }, T1);
ok('a driver login cannot use the dispatch board route', board.status === 403);
const list = await call('GET', '/dispatches', undefined, T1);
ok('a driver login cannot list every dispatch', list.status === 403);

// Status moves.
let r = await api('POST', `/driver/trips/${mine.id}/status`, { status: 'left_plant' }, T1);
ok('left_plant stamps dispatchTime and records history from the phone', r.dispatchStatus === 'left_plant' && !!r.dispatchTime && r.history.some((h) => /phone/.test(String(h.note ?? ''))));
const jump = await call('POST', `/driver/trips/${mine.id}/status`, { status: 'completed' }, T1);
ok('a jump down the chain is refused with the board\'s rule', jump.status === 400 && /Cannot move a dispatch/.test(JSON.stringify(jump.data)));
const officeOnly = await call('POST', `/driver/trips/${mine.id}/status`, { status: 'cancelled' }, T1);
ok('cancelling is not a driver move', officeOnly.status === 400 && /A driver can mark/.test(JSON.stringify(officeOnly.data)));

// Location from the phone.
const loc = await api('POST', `/driver/trips/${mine.id}/location`, { latitude: 13.05, longitude: 80.25, speedKmph: 38, accuracyM: 12 }, T1);
ok('a phone fix is recorded (or the plan has no GPS)', loc.recorded === true || typeof loc.reason === 'string');
if (loc.recorded) {
  const fresh = await api('GET', `/dispatches/${mine.id}`);
  ok('the dispatch carries the phone\'s fix', near(fresh.lastLatitude, 13.05) && near(fresh.lastLongitude, 80.25));
  const live = await api('GET', '/gps/live');
  const onBoard = live.find((x) => x.id === mine.id);
  ok('the live board shows the truck', !!onBoard && near(onBoard.lastLatitude, 13.05));
  const fleet = await api('GET', '/gps/fleet');
  const veh = fleet.find((v) => v.id === vehicle.id);
  ok('the vehicle\'s last known position follows the fix', !!veh && near(veh.lastLatitude, 13.05) && veh.dispatchId === mine.id);
  const track = await api('GET', `/gps/dispatches/${mine.id}/track`);
  ok('the ping is tagged as coming from the driver phone', track.pings.some((p) => p.source === 'driver_phone'));
}

// Someone else's trip.
const other = await call('POST', `/driver/trips/${theirs.id}/status`, { status: 'left_plant' }, T1);
ok('another driver\'s trip is refused', other.status === 403 && /another driver/.test(JSON.stringify(other.data)));
const otherLoc = await call('POST', `/driver/trips/${theirs.id}/location`, { latitude: 13, longitude: 80 }, T1);
ok('a fix on another driver\'s trip is refused', otherLoc.status === 403);

// Delay + returning with a quantity, then finish.
r = await api('POST', `/driver/trips/${mine.id}/status`, { status: 'delayed', delayReason: 'Traffic at the flyover' }, T1);
ok('delayed with a reason', r.dispatchStatus === 'delayed' && r.delayReason === 'Traffic at the flyover');
r = await api('POST', `/driver/trips/${mine.id}/status`, { status: 'reached_site' }, T1);
r = await api('POST', `/driver/trips/${mine.id}/status`, { status: 'pouring' }, T1);
r = await api('POST', `/driver/trips/${mine.id}/status`, { status: 'returning', returnQuantityM3: 1.5 }, T1);
ok('returning with the quantity coming back', r.dispatchStatus === 'returning' && near(r.returnQuantityM3, 1.5));
const tooMuch = await call('POST', `/driver/trips/${theirs.id}/status`, { status: 'returning', returnQuantityM3: 99 }, (await api('POST', '/auth/login', { login: `driver2.${stamp}@ci.test`, password: DRIVER_PW })).access_token);
ok('a return above the load is refused for the other driver too', tooMuch.status === 400);
r = await api('POST', `/driver/trips/${mine.id}/status`, { status: 'completed' }, T1);
ok('completed stamps pourEndTime', r.dispatchStatus === 'completed' && !!r.pourEndTime);
trips = await api('GET', '/driver/trips', undefined, T1);
const doneTrip = trips.find((t) => t.id === mine.id);
ok('a trip finished today stays listed as done (not open)', !!doneTrip && doneTrip.open === false);

// ---- an unlinked login ----
const u3 = await api('POST', '/users', { name: `Unlinked ${stamp}`, email: `driver3.${stamp}@ci.test`, password: DRIVER_PW, roleId: driverRole.id });
const T3 = (await api('POST', '/auth/login', { login: `driver3.${stamp}@ci.test`, password: DRIVER_PW })).access_token;
const me3 = await api('GET', '/driver/me', undefined, T3);
ok('an unlinked login is told how to get linked', me3.linked === false && /Masters → Drivers/.test(me3.message ?? ''));
const t3 = await api('GET', '/driver/trips', undefined, T3);
ok('an unlinked login sees no trips', Array.isArray(t3) && t3.length === 0);
const m3 = await call('POST', `/driver/trips/${theirs.id}/status`, { status: 'left_plant' }, T3);
ok('an unlinked login cannot move any trip', m3.status === 403 && /not linked/.test(JSON.stringify(m3.data)));
// The three logins stay active: rls-users later proves the user list and the
// seat count agree, and the CI plan (run-integration) has seats to spare.
void u3;

console.log(`\nDRIVER APP TEST: ${pass} passed ✓`);
process.exit(0);
