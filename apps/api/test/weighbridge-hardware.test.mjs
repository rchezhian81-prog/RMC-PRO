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

// A hand-keyed net that contradicts gross − tare is rejected — the slip's
// integrity (this net becomes stock). A consistent net still saves.
const reconcile = async (body) => {
  try { await api('POST', '/weighbridge', body); return true; } catch { return false; }
};
ok('a net that does not reconcile with gross − tare is rejected',
  !(await reconcile({ plantId: PLANT_ID, vehicleNo: 'TN09ZZ0001', grossWeight: 30000, tareWeight: 12000, netWeight: 25000 })));
ok('a tare above the gross is rejected',
  !(await reconcile({ plantId: PLANT_ID, vehicleNo: 'TN09ZZ0002', grossWeight: 10000, tareWeight: 12000 })));
ok('a reconciling net override still saves',
  await reconcile({ plantId: PLANT_ID, vehicleNo: 'TN09ZZ0003', grossWeight: 30000, tareWeight: 12000, netWeight: 18000 }));

// ---- F. Indicator-only weighing: a weight must be one the indicator gave ----
const refused = async (method, path, body) => { try { await api(method, path, body); return false; } catch { return true; } };
await api('PUT', '/settings/weighbridge.indicator_only', { value: 'true' });
const policyOn = await api('GET', '/weighbridge/policy');
ok('policy reports indicator-only on', policyOn.indicatorOnly === true && policyOn.readingWindowMinutes > 0);
ok('a hand-keyed slip is refused', await refused('POST', '/weighbridge', { plantId: PLANT_ID, vehicleNo: 'TN10IO0001', grossWeight: 30000, tareWeight: 0 }));
ok('a "device" slip with a weight the indicator never gave is refused',
  await refused('POST', '/weighbridge', { plantId: PLANT_ID, vehicleNo: 'TN10IO0002', grossWeight: NOMINAL + 500, tareWeight: 0, weightSource: 'device', indicatorId: device.id }));
const fresh = await api('POST', `/weighbridge-indicators/${device.id}/read`, {});
const ioSlip = await api('POST', '/weighbridge', { plantId: PLANT_ID, vehicleNo: 'TN10IO0003', grossWeight: fresh.weightKg, tareWeight: 0, weightSource: 'device', indicatorId: device.id });
ok('the weight the indicator just gave is accepted', ioSlip.status === 'draft' && near(ioSlip.grossWeight, fresh.weightKg));
ok('an edited reading is refused',
  await refused('POST', '/weighbridge', { plantId: PLANT_ID, vehicleNo: 'TN10IO0004', grossWeight: fresh.weightKg, tareWeight: 0, weightSource: 'device', indicatorId: device.id, manualOverride: true }));
ok('a hand-keyed second weight is refused', await refused('POST', `/weighbridge/${ioSlip.id}/second-weight`, { weight: 8000 }));
await api('POST', `/weighbridge-indicators/${device.id}`, { simulatedWeightKg: 8000 });
const empty = await api('POST', `/weighbridge-indicators/${device.id}/read`, {});
const ioDone = await api('POST', `/weighbridge/${ioSlip.id}/second-weight`, { weight: empty.weightKg, weightSource: 'device', indicatorId: device.id });
ok('the indicator\'s second reading completes the slip with the right net',
  ioDone.status === 'completed' && near(ioDone.netWeight, Number(fresh.weightKg) - Number(empty.weightKg)));
await api('PUT', '/settings/weighbridge.indicator_only', { value: 'false' });
const policyOff = await api('GET', '/weighbridge/policy');
ok('policy reports indicator-only off again', policyOff.indicatorOnly === false);
const typedAgain = await api('POST', '/weighbridge', { plantId: PLANT_ID, vehicleNo: 'TN10IO0005', grossWeight: 30000, tareWeight: 12000 });
ok('with the setting off a hand-keyed slip saves again', near(typedAgain.netWeight, 18000));

console.log(`\nWEIGHBRIDGE HARDWARE TEST: ${pass} passed ✓`);
process.exit(0);
