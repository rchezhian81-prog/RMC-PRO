/**
 * QC cube-set integrity test (activate the `qc` module).
 *
 * The IS 456 acceptance verdict is a mean over the cast specimens, so it must
 * not be computable on the wrong sample. Proves:
 *   - more 28-day results than the set's specimen count are rejected
 *   - a numbered specimen recorded twice at the same age is rejected
 *   - a valid full 28-day sample is still accepted and assessed
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD. The
 * `qc` module is enabled for the pilot tenant by the runner.
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
  console.log('(skipping qc-cube-integrity — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== qc cube-set integrity (sample cap + specimen dedup) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

const TODAY = new Date().toISOString().slice(0, 10);
// fck 25, tolerance 3 → individual floor 22; 30 N/mm² passes comfortably.
const newSet = () => api('POST', '/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25, specimenCount: 3 });
const result = (specimenNo, strength = 30) => ({ specimenNo, testAgeDays: 28, compressiveStrengthMpa: strength });

// ---- A. more 28-day results than the specimen count are rejected ----
const setA = await newSet();
ok('cube set created (3 specimens)', Number(setA.specimenCount) === 3);
let capped = false;
try {
  await api('POST', `/qc/cube-sets/${setA.id}/results`, { results: [1, 2, 3, 4].map((n) => result(n)) });
} catch { capped = true; }
ok('recording 4 results on a 3-specimen set is rejected', capped);

// ---- B. the same numbered specimen at the same age is rejected ----
const setB = await newSet();
await api('POST', `/qc/cube-sets/${setB.id}/results`, { results: [result(1)] });
let dup = false;
try {
  await api('POST', `/qc/cube-sets/${setB.id}/results`, { results: [result(1, 31)] });
} catch { dup = true; }
ok('a duplicate specimen at the same age is rejected', dup);

// ---- C. a valid full 28-day sample is accepted and assessed ----
const setC = await newSet();
const assessed = await api('POST', `/qc/cube-sets/${setC.id}/results`, { results: [1, 2, 3].map((n) => result(n)) });
ok('a valid 3-cube sample is accepted', assessed.acceptanceStatus === 'accepted');

console.log(`\nQC CUBE INTEGRITY TEST: ${pass} passed ✓`);
process.exit(0);
