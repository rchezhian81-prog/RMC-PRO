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

// ---- D3: a QC sample tied to a batch ticket must be for that ticket's grade ----
// Recording, say, an M25 cube against an M40 batch would assess acceptance
// against the wrong fck. Build a real confirmed M25 ticket, then prove a cube
// set / slump test naming a DIFFERENT grade for that ticket is rejected, and the
// matching grade is accepted.
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const otherGrade = await lookup('concrete-grades', 'gradeCode', 'M30');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('D3 fixtures present (M25 + a second grade)', !!(grade && otherGrade && plant && mix && customer));

let bq = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 6, ratePerM3: 4800 }],
});
await api('POST', `/quotations/${bq.id}/submit`);
bq = await api('POST', `/quotations/${bq.id}/approve`);
let bo = await api('POST', `/order-drafts/from-quotation/${bq.id}`, { plantId: plant.id, orderDate: TODAY });
bo = await api('POST', `/orders/${bo.id}/confirm`);
if (String(bo.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const h = (Array.isArray(holds) ? holds : []).find((x) => String(x.orderId) === String(bo.id));
  if (h) await api('POST', `/credit-holds/${h.id}/approve`, { note: 'D3 test auto-release' });
}
const bqu = await api('POST', `/batch-queue/from-order/${bo.id}`);
const bqid = (Array.isArray(bqu) ? bqu[0] : bqu)?.id;
let bt = await api('POST', `/batch-tickets/from-queue/${bqid}`, { batchQuantityM3: 6, mixDesignId: mix.id });
await api('POST', `/batch-tickets/${bt.id}/actuals`, {
  materials: bt.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
});
bt = await api('POST', `/batch-tickets/${bt.id}/confirm`, {});
ok('D3: confirmed M25 batch ticket built', bt.status === 'confirmed');

let cubeMismatch = false, cubeMsg = '';
try {
  await api('POST', '/qc/cube-sets', { castDate: TODAY, batchTicketId: bt.id, gradeId: otherGrade.id, specimenCount: 3 });
} catch (e) { cubeMismatch = true; cubeMsg = String(e.message || e); }
ok('a cube set whose grade differs from its batch ticket is rejected', cubeMismatch && /does not match batch ticket/i.test(cubeMsg));

const matchSet = await api('POST', '/qc/cube-sets', { castDate: TODAY, batchTicketId: bt.id, gradeId: grade.id, specimenCount: 3 });
ok('a cube set with the matching grade is accepted', !!matchSet.id);

let slumpMismatch = false;
try {
  await api('POST', '/qc/slump-tests', { batchTicketId: bt.id, gradeId: otherGrade.id, measuredSlumpMm: 100 });
} catch { slumpMismatch = true; }
ok('a slump test whose grade differs from its batch ticket is rejected', slumpMismatch);

console.log(`\nQC CUBE INTEGRITY TEST: ${pass} passed ✓`);
process.exit(0);
