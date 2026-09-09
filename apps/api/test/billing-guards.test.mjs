/**
 * Billing gap scan — items B1, B2, B3, B4.
 *
 *   B1 — invoice.issue() read the invoice WITHOUT a row lock while cancel,
 *        writeOff and reverseWriteOff all take one. issue could read 'draft',
 *        a cancel could commit (releasing the challans and deleting the links),
 *        and issue's UPDATE would then flip the row to 'issued': an issued GST
 *        invoice with no challans behind it while the same deliveries went back
 *        on the billable list.
 *   B2 — receipt.realise() read without a lock and judged only clearing_status.
 *        reverse() does not touch clearing_status, so a REVERSED cheque stayed
 *        'pending' and could be marked realised.
 *   B3 — every /billing-reports route passed `from`/`to` straight into
 *        `$1::date`, so `?from=garbage` was a 500, not a 400.
 *   B4 — cancels, write-offs, bounces and reversals were audited; issuing an
 *        invoice and recording a receipt — the originating money events — were
 *        not.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

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

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, code: json?.error?.code ?? json?.code ?? '', msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);

// A customer with a delivered, un-invoiced challan we can bill.
const customerId = randomUUID();
await q(
  `INSERT INTO customers (id, tenant_id, customer_code, customer_name, customer_type, state)
   VALUES ($1,$2,$3,$4,'company','Tamil Nadu')`,
  [customerId, TENANT, `BGC-${tag}`, `Billing Guard ${tag}`],
);
async function newChallan(suffix) {
  const id = randomUUID();
  await q(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, customer_id, quantity_m3, return_quantity_m3, challan_status, invoice_status)
     VALUES ($1,$2,$3,$4,8,0,'delivered','not_invoiced')`,
    [id, TENANT, `BGH-${tag}-${suffix}`, customerId],
  );
  return id;
}
const draftInvoice = async (challanId) => post('/invoices/from-challans', {
  customerId,
  lines: [{ challanId, rate: 5000, gstRate: 18, hsnSac: '3824' }],
});

// ---------------------------------------------------------------------------
console.log('\n[B1] issuing an invoice settles against the locked row');
{
  const inv = await draftInvoice(await newChallan('A'));
  ok(inv.ok, `draft invoice created (${inv.status} ${inv.msg})`);
  const id = inv.data?.id;

  // The race the missing lock allowed, run as far as a single client can drive
  // it: cancel and issue dispatched together. Whichever wins, the pair must end
  // consistent — never an issued invoice whose challans were released.
  const [a, b] = await Promise.all([post(`/invoices/${id}/issue`), post(`/invoices/${id}/cancel`, { reason: `race ${tag}` })]);
  ok([a.status, b.status].some((s) => s === 201 || s === 200), `at least one of issue/cancel succeeded (${a.status}/${b.status})`);
  const row = await one(`SELECT invoice_status, payment_status FROM invoices WHERE id = $1`, [id]);
  const links = await one(`SELECT count(*)::int AS n FROM invoice_challans WHERE invoice_id = $1`, [id]);
  const challan = await one(
    `SELECT invoice_status FROM delivery_challans WHERE challan_no = $1`, [`BGH-${tag}-A`],
  );
  ok(['issued', 'cancelled'].includes(row.invoice_status), `invoice ended in a real state (${row.invoice_status})`);
  if (row.invoice_status === 'issued') {
    ok(links.n === 1, 'an issued invoice still holds its challan link');
    ok(challan.invoice_status === 'invoiced', 'and its challan is still marked invoiced');
    ok(row.payment_status !== 'cancelled', `with a live payment status (${row.payment_status})`);
  } else {
    ok(links.n === 0, 'a cancelled invoice released its challan link');
    ok(challan.invoice_status === 'not_invoiced', 'and its challan is billable again');
  }
  // The plain sequential path must still behave.
  const inv2 = await draftInvoice(await newChallan('B'));
  const issued = await post(`/invoices/${inv2.data?.id}/issue`);
  ok(issued.ok && issued.data?.invoiceStatus === 'issued', `a normal issue still works (${issued.status})`);
  const again = await post(`/invoices/${inv2.data?.id}/issue`);
  ok(again.status === 400, `issuing twice is refused (${again.status})`);
}

// ---------------------------------------------------------------------------
console.log('\n[B4] the originating money events are on the audit trail');
{
  const inv = await draftInvoice(await newChallan('C'));
  const id = inv.data?.id;
  const issued = await post(`/invoices/${id}/issue`);
  ok(issued.ok, `invoice issued (${issued.status} ${issued.msg})`);
  const aud = await one(
    `SELECT action, entity_label, actor_user_id FROM audit_logs WHERE entity_id = $1 AND action = 'invoice.issue'`,
    [id],
  );
  ok(!!aud, 'issuing the invoice is audited (it used to leave no trace)');
  ok(aud?.entity_label === issued.data?.invoiceNo, `the entry names the invoice (${aud?.entity_label})`);
  ok(!!aud?.actor_user_id, 'and records who did it');

  const rc = await post('/receipts', { customerId, amount: 1000, paymentMode: 'cash' });
  ok(rc.ok, `receipt recorded (${rc.status} ${rc.msg})`);
  const raud = await one(
    `SELECT action, entity_label, actor_user_id FROM audit_logs WHERE entity_id = $1 AND action = 'receipt.create'`,
    [rc.data?.id],
  );
  ok(!!raud, 'recording a receipt is audited');
  ok(raud?.entity_label === rc.data?.receiptNo, `naming the receipt (${raud?.entity_label})`);
  ok(!!raud?.actor_user_id, 'and who keyed it');
}

// ---------------------------------------------------------------------------
console.log('\n[B2] a reversed cheque cannot be marked realised');
{
  const chq = await post('/receipts', {
    customerId, amount: 500, paymentMode: 'cheque', bankReference: `CHQ-${tag}`,
  });
  ok(chq.ok, `cheque receipt posted (${chq.status} ${chq.msg})`);
  const id = chq.data?.id;
  ok(chq.data?.clearingStatus === 'pending', `it starts pending (${chq.data?.clearingStatus})`);

  const rev = await post(`/receipts/${id}/reverse`, { reason: `wrongly keyed ${tag}` });
  ok(rev.ok, `reversed (${rev.status} ${rev.msg})`);
  const after = await one(`SELECT status, clearing_status FROM payments WHERE id = $1`, [id]);
  ok(after.status === 'reversed', 'the receipt is reversed');
  ok(after.clearing_status === 'pending', 'and reverse leaves the clearing status alone (unchanged behaviour)');

  const real = await post(`/receipts/${id}/realise`);
  ok(real.status === 400, `realising a reversed receipt is refused (${real.status}: ${real.msg})`);
  const stillPending = await one(`SELECT clearing_status FROM payments WHERE id = $1`, [id]);
  ok(stillPending.clearing_status === 'pending', 'the reversed receipt was not marked realised');

  // A live cheque still realises.
  const live = await post('/receipts', {
    customerId, amount: 400, paymentMode: 'cheque', bankReference: `CHQ2-${tag}`,
  });
  const realised = await post(`/receipts/${live.data?.id}/realise`);
  ok(realised.ok && realised.data?.clearingStatus === 'realised', `a posted cheque still realises (${realised.status})`);
}

// ---------------------------------------------------------------------------
console.log('\n[B3] a malformed report date is a 400, not a 500');
{
  const routes = [
    'sales-register', 'gst-summary', 'hsn-summary', 'receipts-register',
    'gstr-3b', 'day-book', 'sales-mis', 'grade-margin', 'collection-efficiency',
  ];
  let bad400 = 0;
  for (const r of routes) {
    const res = await call('GET', `/billing-reports/${r}?from=garbage`);
    if (res.status === 400) bad400 += 1;
    else console.log(`    (diag) ${r} answered ${res.status}`);
  }
  ok(bad400 === routes.length, `every report refuses a junk date with 400 (${bad400}/${routes.length}, they used to be 500)`);

  const stmt = await call('GET', `/billing-reports/customer-statement?customerId=${customerId}&to=31-03-2026`);
  ok(stmt.status === 400, `the customer statement too (${stmt.status})`);
  ok(/YYYY-MM-DD/.test(stmt.msg), `and the message says the expected shape (${stmt.msg})`);

  const reversed = await call('GET', '/billing-reports/sales-register?from=2026-06-01&to=2026-01-01');
  ok(reversed.status === 400 && /after/.test(reversed.msg), `a backwards range is refused (${reversed.status})`);

  // The everyday cases still work: bounded, unbounded, and an empty parameter.
  const okRange = await call('GET', '/billing-reports/sales-register?from=2026-01-01&to=2026-12-31');
  ok(okRange.ok, `a real range still works (${okRange.status})`);
  const unbounded = await call('GET', '/billing-reports/sales-register');
  ok(unbounded.ok, `no dates at all still works (${unbounded.status})`);
  const empty = await call('GET', '/billing-reports/sales-register?from=&to=');
  ok(empty.ok, `an empty ?from= means unbounded rather than a cast error (${empty.status})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
await owner.destroy();
process.exit(failed ? 1 : 0);
