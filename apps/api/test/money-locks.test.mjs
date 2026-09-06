/**
 * Money-path row locks — equivalence + concurrency test (data-integrity I2/I9/I10).
 *
 * The receipt / vendor-payment header used to be read with a plain SELECT before
 * its allocations were written, so two overlapping "apply advance" calls both saw
 * the full unallocated balance and each spent it (allocations summing to 2x the
 * money). Invoice cancel / write-off and vendor-bill cancel / approve read their
 * row unlocked while the payment paths locked it, so they could commit on top of
 * a just-committed allocation. All of those now take `pessimistic_write` on the
 * header first and derive "already allocated" from the allocation rows.
 *
 * This drives the REAL API with two genuinely concurrent requests and asserts on
 * the persisted rows (owner SQL) — exactly one apply may win, and the allocation
 * rows must sum to the payment amount. It also seeds a deliberately DRIFTED
 * header (amount_paid / paid_amount = 0 with a live allocation row) to prove
 * cancel now refuses on the authoritative rows, not the denormalised copy.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID,
 * POSTGRES_* (owner, to seed and to read the persisted rows).
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PW = process.env.RMC_PASSWORD;
const TENANT = process.env.TEST_TENANT_ID;
if (!LOGIN || !PW || !TENANT) { console.log('(skipping money-locks — LOGIN/RMC_PASSWORD/TEST_TENANT_ID not set)'); process.exit(0); }

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;
const TODAY = new Date().toISOString().slice(0, 10);

const owner = new DataSource({
  type: 'postgres', host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc', username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw', synchronize: false, logging: false,
});
const one = async (sql, params) => (await owner.query(sql, params))[0];

let TOKEN = '';
async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body (e.g. empty 204) */ }
  return { status: res.status, ok: res.ok, data: json?.data, body: json };
}

(async () => {
  await owner.initialize();
  const login = await post('/auth/login', { login: LOGIN, password: PW });
  TOKEN = login.data?.access_token; ok('logged in as the tenant owner', !!TOKEN);
  const tag = randomUUID().slice(0, 8);

  // ---------- Receipts: concurrent double-apply of an advance ----------
  const C = randomUUID();
  await owner.query(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1,$2,$3,$4)`, [C, TENANT, `MLC-${tag}`, `Money Lock Co ${tag}`]);
  const inv = (id, no, date, total, paid = 0, writtenOff = 0, status = 'unpaid') => owner.query(
    `INSERT INTO invoices (id, tenant_id, invoice_no, customer_id, invoice_status, invoice_date, total_amount, amount_paid, written_off_amount, outstanding_amount, payment_status)
     VALUES ($1,$2,$3,$4,'issued',$5,$6,$7,$8,$9,$10)`,
    [id, TENANT, no, C, date, total, paid, writtenOff, total - paid - writtenOff, status]);
  const A = randomUUID(), B = randomUUID();
  await inv(A, `MLI-${tag}-A`, '2026-01-10', 1000);
  await inv(B, `MLI-${tag}-B`, '2026-01-20', 1000);

  const r = await post('/receipts', { customerId: C, amount: 1000, paymentMode: 'neft', receiptDate: TODAY });
  ok('advance receipt (no allocations) is created', r.ok && near(r.data.unallocatedAmount, 1000));
  const R = r.data.id;

  const [a1, a2] = await Promise.all([post(`/receipts/${R}/apply`), post(`/receipts/${R}/apply`)]);
  const wins = [a1, a2].filter((x) => x.ok).length;
  ok('exactly ONE of two concurrent applies succeeds (the other is refused)', wins === 1 && [a1, a2].some((x) => x.status === 400));
  const sumR = await one(`SELECT COALESCE(SUM(allocated_amount),0)::float AS s FROM payment_allocations WHERE payment_id = $1`, [R]);
  ok('allocation rows sum to the receipt amount (1000), not 2x', near(sumR.s, 1000));
  const pR = await one(`SELECT allocated_amount::float AS a, unallocated_amount::float AS u FROM payments WHERE id = $1`, [R]);
  ok('receipt header shows 1000 allocated / 0 unallocated', near(pR.a, 1000) && near(pR.u, 0));
  const iA = await one(`SELECT amount_paid::float AS p, payment_status AS s FROM invoices WHERE id = $1`, [A]);
  const iB = await one(`SELECT amount_paid::float AS p FROM invoices WHERE id = $1`, [B]);
  ok('the oldest invoice is paid once and the next untouched', near(iA.p, 1000) && iA.s === 'paid' && near(iB.p, 0));

  // ---------- Vendor payments: concurrent double-apply of an advance ----------
  const S = randomUUID();
  await owner.query(`INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name) VALUES ($1,$2,$3,$4)`, [S, TENANT, `MLS-${tag}`, `Money Lock Supplier ${tag}`]);
  const bill = (id, no, total, paid = 0) => owner.query(
    `INSERT INTO vendor_bills (id, tenant_id, bill_no, supplier_id, status, total_amount, paid_amount, outstanding_amount, payment_status)
     VALUES ($1,$2,$3,$4,'approved',$5,$6,$7,'unpaid')`, [id, TENANT, no, S, total, paid, total - paid]);
  const X = randomUUID(), Y = randomUUID();
  await bill(X, `MLB-${tag}-X`, 500); await bill(Y, `MLB-${tag}-Y`, 500);

  const vp = await post('/vendor-payments', { supplierId: S, amount: 500, paymentMode: 'neft', paymentDate: TODAY });
  ok('advance vendor payment is created', vp.ok && near(vp.data.unallocatedAmount, 500));
  const VP = vp.data.id;
  const [v1, v2] = await Promise.all([
    post(`/vendor-payments/${VP}/apply-advance`, { allocations: [{ billId: X, amount: 500 }] }),
    post(`/vendor-payments/${VP}/apply-advance`, { allocations: [{ billId: Y, amount: 500 }] }),
  ]);
  ok('exactly ONE of two concurrent vendor applies succeeds', [v1, v2].filter((x) => x.ok).length === 1);
  const sumV = await one(`SELECT COALESCE(SUM(allocated_amount),0)::float AS s FROM vendor_payment_allocations WHERE vendor_payment_id = $1`, [VP]);
  ok('vendor allocation rows sum to the payment amount (500), not 1000', near(sumV.s, 500));
  const pV = await one(`SELECT allocated_amount::float AS a, unallocated_amount::float AS u FROM vendor_payments WHERE id = $1`, [VP]);
  ok('vendor payment header shows 500 allocated / 0 unallocated', near(pV.a, 500) && near(pV.u, 0));
  const paidBills = await one(`SELECT count(*)::int AS n FROM vendor_bills WHERE id IN ($1,$2) AND paid_amount::float > 0`, [X, Y]);
  ok('exactly one bill was paid', paidBills.n === 1);

  // ---------- Invoice cancel refuses on the authoritative allocation rows ----------
  const Z = randomUUID(), P = randomUUID();
  await inv(Z, `MLI-${tag}-Z`, TODAY, 100); // amount_paid deliberately left 0 (drifted header)
  await owner.query(`INSERT INTO payments (id, tenant_id, receipt_no, customer_id, amount, status, payment_mode, clearing_status, allocated_amount, unallocated_amount)
                     VALUES ($1,$2,$3,$4,100,'posted','cash','cleared',100,0)`, [P, TENANT, `MLR-${tag}-P`, C]);
  await owner.query(`INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, allocated_amount) VALUES ($1,$2,$3,$4,100)`, [randomUUID(), TENANT, P, Z]);
  const cz = await post(`/invoices/${Z}/cancel`, { reason: 'money-locks test' });
  const zRow = await one(`SELECT invoice_status AS s FROM invoices WHERE id = $1`, [Z]);
  ok('invoice cancel is refused (400) when an allocation row exists even though amount_paid reads 0', cz.status === 400 && zRow.s === 'issued');

  // ---------- Vendor bill cancel refuses on the authoritative allocation rows ----------
  const W = randomUUID(), VQ = randomUUID();
  await bill(W, `MLB-${tag}-W`, 100); // paid_amount deliberately 0 (drifted header)
  await owner.query(`INSERT INTO vendor_payments (id, tenant_id, payment_no, supplier_id, amount, status, allocated_amount, unallocated_amount)
                     VALUES ($1,$2,$3,$4,100,'posted',100,0)`, [VQ, TENANT, `MLV-${tag}-Q`, S]);
  await owner.query(`INSERT INTO vendor_payment_allocations (id, tenant_id, vendor_payment_id, vendor_bill_id, allocated_amount) VALUES ($1,$2,$3,$4,100)`, [randomUUID(), TENANT, VQ, W]);
  const cw = await post(`/vendor-bills/${W}/cancel`);
  const wRow = await one(`SELECT status AS s FROM vendor_bills WHERE id = $1`, [W]);
  ok('vendor bill cancel is refused (400) when an allocation row exists even though paid_amount reads 0', cw.status === 400 && wRow.s === 'approved');

  // ---------- Write-off recomputes from the locked row's authoritative figures ----------
  const V = randomUUID();
  await inv(V, `MLI-${tag}-V`, TODAY, 1000, 600, 0, 'partially_paid');
  const wo = await post(`/invoices/${V}/writeoff`, { amount: 400, reason: 'bad debt' });
  const vRow = await one(`SELECT amount_paid::float AS p, written_off_amount::float AS w, outstanding_amount::float AS o, payment_status AS s FROM invoices WHERE id = $1`, [V]);
  ok('write-off of the remaining 400 leaves paid 600 / written-off 400 / outstanding 0 / written_off', wo.ok && near(vRow.p, 600) && near(vRow.w, 400) && near(vRow.o, 0) && vRow.s === 'written_off');

  await owner.destroy();
  console.log(`\nMONEY LOCKS TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
