/**
 * Weighbridge hardware bridge integration test (Plan E1).
 *
 * Drives the real API to prove:
 *   - a simulated indicator device can be registered and gives a live read
 *     (the DoD "simulated-indicator read path tested")
 *   - the local-agent path: raw frames POSTed by the plant app are parsed
 *   - a device-captured entry records weightSource='device' + the indicator
 *   - the manual entry path is UNCHANGED (weightSource defaults to 'manual',
 *     net = gross − tare) — the DoD "manual path unchanged"
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD,
 * TEST_PLANT_ID. The `weighbridge` module is phase-1, on by default.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const PLANT_ID = process.env.TEST_PLANT_ID;

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
  console.log('(skipping weighbridge-hardware — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== weighbridge hardware bridge (indicator read + manual path) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

// ---- A. Register a simulated indicator device ----
const NOMINAL = 24680;
const device = await api('POST', '/weighbridge-indicators', {
  name: `Sim Scale ${Date.now().toString().slice(-6)}`,
  plantId: PLANT_ID, connectionType: 'simulated', simulatedWeightKg: NOMINAL,
});
ok('indicator device created', !!device.id);
ok('device is simulated', device.connectionType === 'simulated');

const list = await api('GET', '/weighbridge-indicators');
ok('device appears in the list', list.some((d) => d.id === device.id));

// ---- B. Live read off the simulated indicator (the tested read path) ----
const reading = await api('POST', `/weighbridge-indicators/${device.id}/read`, {});
ok('live read is stable', reading.stable === true);
ok(`live read returns the nominal weight (${NOMINAL} kg)`, near(reading.weightKg, NOMINAL));
ok('live read carries the raw frame for audit', typeof reading.raw === 'string' && reading.raw.length > 0);

// ---- C. Local-agent path: raw frames posted by the plant app are parsed ----
const agentRead = await api('POST', `/weighbridge-indicators/${device.id}/read`, {
  rawFrames: ['US,GS,+0012000 kg', 'ST,GS,+0018500 kg'],
});
ok('agent-supplied frames parse to the stable reading (18500 kg)', near(agentRead.weightKg, 18500));

// ---- D. Device-captured entry records its provenance ----
const deviceEntry = await api('POST', '/weighbridge', {
  plantId: PLANT_ID, vehicleNo: 'TN01AB1234',
  grossWeight: reading.weightKg, tareWeight: 8000,
  weightSource: 'device', indicatorId: device.id,
});
ok('device entry stamped weightSource=device', deviceEntry.weightSource === 'device');
ok('device entry references the indicator', deviceEntry.indicatorId === device.id);
ok('device entry net = gross − tare', near(deviceEntry.netWeight, Number(reading.weightKg) - 8000));

// ---- E. Manual path is UNCHANGED ----
const manualEntry = await api('POST', '/weighbridge', {
  plantId: PLANT_ID, vehicleNo: 'TN09XY7777', grossWeight: 30000, tareWeight: 12000,
});
ok('manual entry defaults weightSource=manual', manualEntry.weightSource === 'manual');
ok('manual entry has no indicator', !manualEntry.indicatorId);
ok('manual entry net = gross − tare (18000)', near(manualEntry.netWeight, 18000));
ok('manual entry is not flagged as an override', manualEntry.manualOverride === false);

console.log(`\nWEIGHBRIDGE HARDWARE TEST: ${pass} passed ✓`);
process.exit(0);
