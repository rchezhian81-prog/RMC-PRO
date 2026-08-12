/**
 * Document numbering + correction trail integration test (Plan F2).
 *
 * Proves:
 *   - the reserved-number pool allocates a contiguous block online (no device),
 *     stamps the current financial year, and the next block continues past it
 *   - a per-plant series is independent of the tenant-wide series (both start
 *     fresh for a new document type)
 *   - a correction can be recorded against a posted document and listed back,
 *     and a correction missing a field is rejected
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

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
  console.log('(skipping numbering-corrections — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== document numbering + correction trail ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

const sfx = String(Date.now()).slice(-6);

// ---- A. Online reserved-number pool: contiguous block + FY stamp ----
const docType = `f2_pool_${sfx}`;
const b1 = await api('POST', '/sync/number-reservations', { documentType: docType, count: 5 });
ok('first block starts at 1', Number(b1.numberFrom) === 1 && Number(b1.numberTo) === 5);
ok('block is stamped with a financial year', /^\d{4}-\d{2}$/.test(String(b1.financialYear)));
ok('sample formats the padded number', String(b1.sampleFrom).endsWith('0001'));

const b2 = await api('POST', '/sync/number-reservations', { documentType: docType, count: 3 });
ok('second block continues past the first (no gap, no overlap)', Number(b2.numberFrom) === Number(b1.numberTo) + 1);
ok('second block spans the requested count', Number(b2.numberTo) - Number(b2.numberFrom) === 2);

// ---- B. Per-plant series is independent of the tenant-wide series ----
const plants = await api('GET', '/plants');
const plant = Array.isArray(plants) ? plants[0] : null;
ok('a plant exists', !!plant);
const perPlantType = `f2_plant_${sfx}`;
const tenantWide = await api('POST', '/sync/number-reservations', { documentType: perPlantType, count: 2 });
const plantScoped = await api('POST', '/sync/number-reservations', { documentType: perPlantType, count: 2, plantId: plant.id });
ok('tenant-wide series starts at 1', Number(tenantWide.numberFrom) === 1);
ok('the plant series is independent and also starts at 1', Number(plantScoped.numberFrom) === 1 && String(plantScoped.plantId) === String(plant.id));

const reservations = await api('GET', '/sync/number-reservations');
ok('reservations are listed', Array.isArray(reservations) && reservations.length >= 3);

// ---- C. Correction trail ----
const docId = (globalThis.crypto?.randomUUID?.() ?? '00000000-0000-0000-0000-000000000001');
const correction = await api('POST', '/document-corrections', {
  documentType: 'invoice', documentId: docId, documentLabel: `INV-${sfx}`,
  field: 'vehicle_no', oldValue: 'TN01AA0001', newValue: 'TN01AA0002', reason: 'wrong vehicle keyed',
});
ok('correction recorded with an id', !!correction.id && correction.field === 'vehicle_no');

const trail = await api('GET', `/document-corrections?documentType=invoice&documentId=${docId}`);
ok('correction is listed for the document', Array.isArray(trail) && trail.length === 1);
ok('the trail carries old → new + reason', trail[0].oldValue === 'TN01AA0001' && trail[0].newValue === 'TN01AA0002' && trail[0].reason === 'wrong vehicle keyed');

let rejected = false;
try { await api('POST', '/document-corrections', { documentType: 'invoice', documentId: docId }); } catch { rejected = true; }
ok('a correction with no field is rejected', rejected);

console.log(`\nNUMBERING + CORRECTIONS TEST: ${pass} passed ✓`);
process.exit(0);
