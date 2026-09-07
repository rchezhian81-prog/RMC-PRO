/**
 * Receipt corrections (data-integrity items I4, I5).
 *
 * I4 — POST /receipts/:id/reverse unwinds a posted receipt of ANY mode (bounce
 *      stays cheque-only), restoring each invoice and freeing the receipt's
 *      bank reference; a reversed receipt cannot be reversed again.
 * I5 — one live receipt per (customer, bank reference) for non-cash modes:
 *      the service answers 409 and the partial unique index backstops it;
 *      blank references never collide; cash is exempt; reversal frees the key.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
if (!TENANT) { console.error('TEST_TENANT_ID required'); process.exit(1); }

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  database: process.env.POSTGRES_DB ?? 'rmc',
});
await owner.initialize();
const q = (sql, params) => owner.query(sql, params);
const one = async (sql, params) => (await owner.query(sql, params))[0];

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, code: json?.error?.code ?? json?.code ?? '', msg: json?.error?.message ?? json?.message ?? '' };
}
const tag = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);

const C = randomUUID(); const D = randomUUID();
await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, 'Reverse Co')`, [C, TENANT, `RC-${tag}`]);
await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, 'Other Co')`, [D, TENANT, `RD-${tag}`]);
const inv = async (customerId, no, total) => {
  const id = randomUUID();
  await q(`INSERT INTO invoices (id, tenant_id, invoice_no, customer_id, invoice_status, invoice_date, total_amount, amount_paid, written_off_amount, outstanding_amount, payment_status)
           VALUES ($1, $2, $3, $4, 'issued', $5, $6, 0, 0, $6, 'unpaid')`, [id, TENANT, no, customerId, TODAY, total]);
  return id;
};
const A = await inv(C, `RCI-A-${tag}`, 1000);
const B = await inv(C, `RCI-B-${tag}`, 1000);
const invoice = (id) => one(`SELECT amount_paid::float AS paid, outstanding_amount::float AS o, payment_status AS s FROM invoices WHERE id = $1`, [id]);
const payment = (id) => one(`SELECT status, allocated_amount::float AS al, unallocated_amount::float AS un, remarks, bank_reference FROM payments WHERE id = $1`, [id]);
const allocs = async (id) => Number((await one(`SELECT count(*)::int AS n FROM payment_allocations WHERE payment_id = $1`, [id])).n);

// ───────────────────────── I4 — reverse a NEFT receipt ─────────────────────────
console.log('\n[I4] a wrongly keyed NEFT receipt can be reversed');
{
  const r1 = await post('/receipts', { customerId: C, amount: 400, paymentMode: 'neft', receiptDate: TODAY, bankReference: `UTR-A-${tag}`, allocations: [{ invoiceId: A, amount: 400 }] });
  ok(r1.ok, `NEFT receipt posted (${r1.status} ${r1.msg})`);
  const R1 = r1.data?.id;
  let a = await invoice(A);
  ok(near(a.paid, 400) && a.s === 'partially_paid', `invoice A paid 400 (${a.paid}/${a.s})`);
  const bounce = await post(`/receipts/${R1}/bounce`, { reason: 'try' });
  ok(bounce.status === 400 && /cheque/i.test(bounce.msg), `bounce is still cheque-only (${bounce.status}: ${bounce.msg})`);
  const rev = await post(`/receipts/${R1}/reverse`, { reason: 'wrong invoice' });
  ok(rev.ok, `reverse accepted (${rev.status} ${rev.msg})`);
  a = await invoice(A);
  ok(near(a.paid, 0) && near(a.o, 1000) && a.s === 'unpaid', `invoice A restored: paid 0, outstanding 1000, unpaid (${a.paid}/${a.o}/${a.s})`);
  const p = await payment(R1);
  ok(p.status === 'reversed' && near(p.al, 0) && near(p.un, 400), `receipt is reversed with 0 allocated / 400 unallocated (${p.status} ${p.al}/${p.un})`);
  ok(/Reversed: wrong invoice/.test(p.remarks ?? ''), 'the reason is kept on the receipt');
  ok((await allocs(R1)) === 0, 'allocation rows are gone');
  const again = await post(`/receipts/${R1}/reverse`, { reason: 'twice' });
  ok(again.status === 400, `reversing a reversed receipt is refused (${again.status})`);
  const apply = await post(`/receipts/${R1}/apply`);
  ok(apply.status === 400, `a reversed receipt cannot be applied (${apply.status})`);
  // The genuine receipt can now be recorded against the same invoice with the same reference.
  const r2 = await post('/receipts', { customerId: C, amount: 400, paymentMode: 'neft', receiptDate: TODAY, bankReference: `UTR-A-${tag}`, allocations: [{ invoiceId: A, amount: 400 }] });
  ok(r2.ok, `the corrected receipt with the same reference posts after the reversal (${r2.status} ${r2.msg})`);
  a = await invoice(A);
  ok(near(a.paid, 400), 'invoice A is paid 400 once, not twice');

  console.log('\n[I4] a realised cheque can be reversed too');
  const c1 = await post('/receipts', { customerId: C, amount: 300, paymentMode: 'cheque', receiptDate: TODAY, bankReference: `CHQ-${tag}`, allocations: [{ invoiceId: B, amount: 300 }] });
  ok(c1.ok && c1.data?.clearingStatus === 'pending', `cheque receipt is pending (${c1.data?.clearingStatus})`);
  const realise = await post(`/receipts/${c1.data?.id}/realise`);
  ok(realise.ok, 'cheque realised');
  const crev = await post(`/receipts/${c1.data?.id}/reverse`, { reason: 'wrong customer' });
  ok(crev.ok, `realised cheque reversed (${crev.status} ${crev.msg})`);
  const b = await invoice(B);
  ok(near(b.paid, 0) && b.s === 'unpaid', `invoice B restored (${b.paid}/${b.s})`);
}

// ───────────────────────── I5 — one live receipt per bank reference ─────────────────────────
console.log('\n[I5] a repeated bank reference for the same customer is refused');
{
  const ref = `UTR-DUP-${tag}`;
  const first = await post('/receipts', { customerId: C, amount: 100, paymentMode: 'neft', receiptDate: TODAY, bankReference: ref });
  ok(first.ok, `first receipt with the reference posts (${first.status})`);
  const dup = await post('/receipts', { customerId: C, amount: 100, paymentMode: 'neft', receiptDate: TODAY, bankReference: ref });
  ok(dup.status === 409 && dup.code === 'DUPLICATE_RECORD', `exact repeat is a 409 DUPLICATE_RECORD (${dup.status} ${dup.code})`);
  ok(new RegExp(String(first.data?.receiptNo)).test(dup.msg), `the refusal names the existing receipt (${dup.msg})`);
  const spaced = await post('/receipts', { customerId: C, amount: 100, paymentMode: 'rtgs', receiptDate: TODAY, bankReference: `  ${ref.toLowerCase()} ` });
  ok(spaced.status === 409, `case/whitespace variant is a 409 too (${spaced.status})`);
  const cash = await post('/receipts', { customerId: C, amount: 100, paymentMode: 'cash', receiptDate: TODAY, bankReference: ref });
  ok(cash.ok, `cash with the same text is allowed — cash has no instrument (${cash.status})`);
  const other = await post('/receipts', { customerId: D, amount: 100, paymentMode: 'neft', receiptDate: TODAY, bankReference: ref });
  ok(other.ok, `another customer with the same reference is allowed (${other.status})`);
  const e1 = await post('/receipts', { customerId: C, amount: 50, paymentMode: 'neft', receiptDate: TODAY, bankReference: '' });
  const e2 = await post('/receipts', { customerId: C, amount: 50, paymentMode: 'neft', receiptDate: TODAY, bankReference: '   ' });
  ok(e1.ok && e2.ok, `blank references never collide (${e1.status}/${e2.status})`);
  const stored = await one(`SELECT bank_reference FROM payments WHERE id = $1`, [e2.data?.id]);
  ok(stored.bank_reference === null, 'a blank reference is stored as NULL');
  const live = await one(`SELECT count(*)::int AS n FROM payments WHERE customer_id = $1 AND lower(btrim(bank_reference)) = lower($2) AND status <> 'reversed' AND COALESCE(payment_mode,'') <> 'cash'`, [C, ref]);
  ok(live.n === 1, `exactly one live non-cash receipt carries the reference (${live.n})`);

  console.log('\n[I5] the database backstops the guard');
  const idx = await one(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'uq_payments_customer_bank_reference'`);
  ok(idx.n === 1, 'partial unique index exists');
  let state = 'ok';
  try {
    await q(`INSERT INTO payments (id, tenant_id, receipt_no, customer_id, payment_mode, amount, bank_reference, status) VALUES ($1, $2, $3, $4, 'neft', 1, $5, 'posted')`, [randomUUID(), TENANT, `RC-RAW-${tag}`, C, ref.toUpperCase()]);
  } catch (e) { state = e?.driverError?.code ?? e?.code ?? 'error'; }
  ok(state === '23505', `a raw duplicate insert is refused by the index (${state})`);
  const rev = await post(`/receipts/${first.data?.id}/reverse`, { reason: 'keyed twice' });
  ok(rev.ok, 'reversing the first receipt frees the reference');
  const after = await post('/receipts', { customerId: C, amount: 100, paymentMode: 'neft', receiptDate: TODAY, bankReference: ref });
  ok(after.ok, `the reference can be used again after the reversal (${after.status})`);

  const here = dirname(fileURLToPath(import.meta.url));
  const r = spawnSync('node', ['dist/core/database/migration-preflight.js'], { cwd: resolve(here, '..'), env: process.env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  ok(r.status === 0 && /ok\s+payments\.uq_payments_customer_bank_reference/.test(out), `preflight passes and covers the new index (${r.status})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
