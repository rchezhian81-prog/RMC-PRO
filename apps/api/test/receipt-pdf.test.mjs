/**
 * The printed receipt, through the real API: a delivered challan is invoiced
 * and issued, a cheque receipt is recorded against the invoice, and the
 * receipt PDF is fetched over HTTP and read back.
 *
 * What it pins: the receipt can be printed at all (it could not be); it
 * carries the amount in words; it names the invoice it was set against; a
 * cheque still clearing says "subject to realisation" and stops saying so
 * once realised; a bounced cheque's receipt says in red that it discharges
 * nothing. And the tax invoice now carries its total in words.
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pdfText } from './helpers/pdf-text.mjs';

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

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}
const pdf = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, isPdf: buf.subarray(0, 5).toString() === '%PDF-', text: pdfText(buf) };
};

console.log('=== the receipt can be printed, and says the right thing at each step of a cheque ===');
const tag = Date.now().toString(36);
const customerId = randomUUID();
await q(
  `INSERT INTO customers (id, tenant_id, customer_code, customer_name, customer_type, state, gstin)
   VALUES ($1,$2,$3,$4,'company','Tamil Nadu','33AAACB1234C1Z5')`,
  [customerId, TENANT, `RPC-${tag}`, `Receipt Print ${tag}`],
);
const challanId = randomUUID();
await q(
  `INSERT INTO delivery_challans (id, tenant_id, challan_no, customer_id, quantity_m3, return_quantity_m3, challan_status, invoice_status)
   VALUES ($1,$2,$3,$4,8,0,'delivered','not_invoiced')`,
  [challanId, TENANT, `RPH-${tag}`, customerId],
);
let invoice = await api('POST', '/invoices/from-challans', { customerId, lines: [{ challanId, rate: 5000, gstRate: 18, hsnSac: '3824' }] });
invoice = await api('POST', `/invoices/${invoice.id}/issue`);
ok(`invoice issued: ${invoice.invoiceNo} for ${invoice.totalAmount}`, !!invoice.invoiceNo && Number(invoice.totalAmount) > 0);

console.log('\n[0] the invoice carries its total in words');
{
  const inv = await pdf(`/invoices/${invoice.id}/pdf`);
  ok('invoice PDF renders', inv.ok && inv.isPdf);
  ok('and prints "Amount in words: Rupees … Only"', /Amount in words: Rupees .+ Only/.test(inv.text));
}

console.log('\n[1] a cheque receipt set against the invoice');
const receipt = await api('POST', '/receipts', {
  customerId, amount: 10000, paymentMode: 'cheque', bankReference: `CHQ-${tag}`,
  allocations: [{ invoiceId: invoice.id, amount: 10000 }],
});
ok(`receipt recorded ${receipt.receiptNo}, clearing ${receipt.clearingStatus}`, receipt.clearingStatus === 'pending');
{
  const r = await pdf(`/receipts/${receipt.id}/pdf`);
  ok(`GET /receipts/:id/pdf is a PDF (${r.status})`, r.ok && r.isPdf);
  for (const s of ['RECEIPT', `No: ${receipt.receiptNo}`, `Receipt Print ${tag}`, 'GSTIN: 33AAACB1234C1Z5', 'INR 10,000.00',
    'Amount in words: Rupees Ten Thousand Only', 'Mode: cheque', `Ref: CHQ-${tag}`, 'Set against', invoice.invoiceNo,
    'Subject to realisation of the cheque / instrument.']) {
    ok(`prints "${s}"`, r.text.includes(s));
  }
  ok('and nothing about a reversal', !r.text.includes('REVERSED') && !r.text.includes('INSTRUMENT RETURNED'));
}

console.log('\n[2] once the cheque is realised the caveat goes');
await api('POST', `/receipts/${receipt.id}/realise`);
{
  const r = await pdf(`/receipts/${receipt.id}/pdf`);
  ok('Status: posted (realised)', r.text.includes('Status: posted (realised)'));
  ok('no longer subject to realisation', !r.text.includes('Subject to realisation'));
}

console.log('\n[3] a bounced cheque\'s receipt says it discharges nothing');
await api('POST', `/receipts/${receipt.id}/bounce`, { reason: `returned ${tag}` });
{
  const r = await pdf(`/receipts/${receipt.id}/pdf`);
  ok('still renders', r.ok && r.isPdf);
  ok('INSTRUMENT RETURNED on the document', r.text.includes('INSTRUMENT RETURNED'));
  ok('the amount is still shown, so the customer knows which receipt this is', r.text.includes('INR 10,000.00'));
}

console.log('\n[4] a receipt that does not exist is refused with a reason, not a broken PDF');
{
  const res = await fetch(`${BASE}/receipts/${randomUUID()}/pdf`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const j = await res.json().catch(() => null);
  ok(`404 with a message (${res.status}: ${j?.error?.message ?? j?.message ?? ''})`, res.status === 404 && /not found/i.test(j?.error?.message ?? j?.message ?? ''));
}

console.log(`\nRECEIPT PDF TEST: ${pass} passed`);
await owner.destroy();
process.exit(0);
