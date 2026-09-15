/**
 * GST credit / debit notes through the real API (CGST Rule 53).
 *
 * A delivered challan is invoiced and issued; a credit note for a rate
 * difference is drafted against it, printed as a draft, issued (number
 * drawn, invoice balance down), shared, seen on the statement, the GST and
 * HSN summaries (net), the sales register's notes list and the Tally export;
 * cancelling it restores the invoice and keeps the number. A note over the
 * invoice's headroom is refused, a note on a draft invoice is refused, the
 * invoice cannot be cancelled while a note is live, a credit that would
 * leave the customer overpaid is refused, and a debit note raises what is
 * owed and stays when a receipt settles it.
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pdfText, pdfTextReport } from './helpers/pdf-text.mjs';

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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function raw(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, message: String(json?.error?.message ?? json?.message ?? '') };
}
async function api(method, path, body) {
  const r = await raw(method, path, body);
  if (r.status >= 400 || !r.json?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}
const refused = async (label, method, path, body, re) => {
  const r = await raw(method, path, body);
  ok(`${label} → ${r.status} "${r.message.slice(0, 110)}"`, r.status === 400 && re.test(r.message));
};
const pdf = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, isPdf: buf.subarray(0, 5).toString() === '%PDF-', text: pdfText(buf), disposition: res.headers.get('content-disposition'), report: () => pdfTextReport(buf) };
};
const prints = (label, r, s) => ok(`${label} "${s}"${r.text.includes(s) ? '' : ` — reader saw: ${r.report()}`}`, r.text.includes(s));
const today = new Date().toISOString().slice(0, 10);
const range = `from=${today}&to=${today}`;
const invoiceOf = (id) => api('GET', `/invoices/${id}`);

console.log('=== credit / debit notes against an issued invoice ===');
const tag = Date.now().toString(36);
const customerId = randomUUID();
await q(
  `INSERT INTO customers (id, tenant_id, customer_code, customer_name, customer_type, state, gstin, billing_address, city, pincode, mobile)
   VALUES ($1,$2,$3,$4,'company','Tamil Nadu','33AAACB1234C1Z5','12 Anna Salai','Chennai','600002','9876543210')`,
  [customerId, TENANT, `CNC-${tag}`, `Credit Note Co ${tag}`],
);
const challan = async () => {
  const id = randomUUID();
  await q(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, customer_id, quantity_m3, return_quantity_m3, challan_status, invoice_status)
     VALUES ($1,$2,$3,$4,8,0,'delivered','not_invoiced')`,
    [id, TENANT, `CNH-${tag}-${Math.random().toString(36).slice(2, 6)}`, customerId],
  );
  return id;
};
let invoice = await api('POST', '/invoices/from-challans', { customerId, lines: [{ challanId: await challan(), rate: 5000, gstRate: 18, hsnSac: '3824' }] });
const draftInvoice = await api('POST', '/invoices/from-challans', { customerId, lines: [{ challanId: await challan(), rate: 5000, gstRate: 18, hsnSac: '3824' }] });
invoice = await api('POST', `/invoices/${invoice.id}/issue`);
ok(`invoice issued: ${invoice.invoiceNo} for ${invoice.totalAmount}, outstanding ${invoice.outstandingAmount}`, near(invoice.totalAmount, 47200) && near(invoice.outstandingAmount, 47200));
const gstBefore = await api('GET', `/billing-reports/gst-summary?${range}`);
const hsnBefore = await api('GET', `/billing-reports/hsn-summary?${range}`);
const hsnRow = (rows) => (Array.isArray(rows) ? rows : rows?.rows ?? []).find((r) => String(r.hsn) === '3824' && Number(r.gstRate) === 18) ?? { taxable: 0, quantity: 0, total: 0 };

console.log('\n[1] what a note needs, and what it refuses');
{
  const reasons = await api('GET', '/credit-notes/reasons');
  ok(`reasons listed (${reasons.length}), rate_difference among them`, reasons.some((r) => r.value === 'rate_difference' && r.label === 'Rate difference'));
  const lines = await api('GET', `/credit-notes/invoice-lines/${invoice.id}`);
  ok(`the invoice's lines are offered for prefilling (${lines.length}, HSN ${lines[0]?.hsnSac})`, lines.length === 1 && lines[0].hsnSac === '3824' && near(lines[0].quantity, 8));
  const line = { description: 'M25 rate difference', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 500, gstRate: 18 };
  await refused('a note on a DRAFT invoice', 'POST', '/credit-notes', { invoiceId: draftInvoice.id, noteType: 'credit', reason: 'rate_difference', lines: [line] }, /only be raised against an issued invoice/);
  await refused('a note without a reason', 'POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'credit', lines: [line] }, /reason is required/);
  await refused('a note without lines', 'POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'credit', reason: 'other', lines: [] }, /At least one line/);
  await refused('a credit note above what the invoice was billed for', 'POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'credit', reason: 'rate_difference', lines: [{ ...line, rate: 6000 }] }, /cannot exceed/);
  await refused('a note of a kind that does not exist', 'POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'refund', reason: 'other', lines: [line] }, /credit or debit/);
}

console.log('\n[2] a credit note for a rate difference: drafted, printed as a draft, blocks cancelling the invoice');
const line = { description: 'M25 rate difference', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 500, gstRate: 18 };
let cn = await api('POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'credit', reason: 'rate_difference', remarks: `agreed rate 4,500 ${tag}`, lines: [line] });
ok(`draft: status ${cn.status}, no number yet, total ${cn.totalAmount} (4,000 + 18%)`, cn.status === 'draft' && !cn.noteNo && near(cn.totalAmount, 4720) && near(cn.cgstAmount, 360) && near(cn.sgstAmount, 360));
ok('the draft carries the invoice\'s party, GSTIN and place of supply', cn.customerId === customerId && cn.gstin === '33AAACB1234C1Z5' && cn.placeOfSupply === 'Tamil Nadu' && cn.isInterstate === false);
ok(`reason label rides on it (${cn.reasonLabel})`, cn.reasonLabel === 'Rate difference');
{
  const inv = await invoiceOf(invoice.id);
  ok(`a draft note changes nothing on the invoice yet (outstanding ${inv.outstandingAmount})`, near(inv.outstandingAmount, 47200) && near(inv.creditNoteAmount, 0));
  const r = await pdf(`/credit-notes/${cn.id}/pdf`);
  ok(`GET /credit-notes/:id/pdf is a PDF (${r.status})`, r.ok && r.isPdf);
  for (const s of ['CREDIT NOTE', 'No: DRAFT', 'DRAFT', 'not yet issued', `Against invoice: ${invoice.invoiceNo}`, `Credit Note Co ${tag}`]) prints('draft prints', r, s);
  await refused('sharing a draft', 'POST', `/credit-notes/${cn.id}/share`, { mobile: '9876543210' }, /Issue the note before sharing/);
  await refused('cancelling the invoice while a note is live', 'POST', `/invoices/${invoice.id}/cancel`, { reason: 'test' }, /note/i);
  const forInvoice = await api('GET', `/credit-notes/for-invoice/${invoice.id}`);
  ok('the invoice lists its note', forInvoice.length === 1 && forInvoice[0].id === cn.id);
}

console.log('\n[3] issuing: the number is drawn and the invoice comes down through the balance formula');
cn = await api('POST', `/credit-notes/${cn.id}/issue`);
ok(`issued as ${cn.noteNo}`, cn.status === 'issued' && /^CN-/.test(String(cn.noteNo)));
{
  const inv = await invoiceOf(invoice.id);
  ok(`invoice: credited ${inv.creditNoteAmount}, outstanding ${inv.outstandingAmount}, ${inv.paymentStatus}`, near(inv.creditNoteAmount, 4720) && near(inv.outstandingAmount, 42480) && inv.paymentStatus === 'unpaid');
  await refused('issuing it twice', 'POST', `/credit-notes/${cn.id}/issue`, {}, /already issued/);
  const [audit] = await q(`SELECT action, entity_label FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'credit_note.issue'`, [TENANT, cn.id]);
  ok(`audited: ${audit?.action} ${audit?.entity_label}`, audit?.entity_label === cn.noteNo);
  const r = await pdf(`/credit-notes/${cn.id}/pdf`);
  for (const s of ['CREDIT NOTE', `No: ${cn.noteNo}`, `Against invoice: ${invoice.invoiceNo}`, 'Status: issued', 'Rate difference', 'M25 rate difference', '3824',
    'Total credited   INR 4,720.00', 'Amount in words: Rupees Four Thousand Seven Hundred Twenty Only', `agreed rate 4,500 ${tag}`, 'Authorised Signatory', '12 Anna Salai, Chennai, Tamil Nadu, 600002', 'Place of supply: Tamil Nadu (33)']) {
    prints('issued note prints', r, s);
  }
  ok('no DRAFT banner once issued', !r.text.includes('DRAFT'));
  ok(`the file is named after the note (${r.disposition})`, new RegExp(`filename="${cn.noteNo}`).test(String(r.disposition)));
  const log = await api('POST', `/credit-notes/${cn.id}/share`, { mobile: '9876543210' });
  const body = String(log?.messageBody ?? log?.message ?? JSON.stringify(log));
  ok(`share text: ${body.slice(0, 130)}`, body.includes(`Credit note ${cn.noteNo}`) && body.includes(`against invoice ${invoice.invoiceNo}`) && body.includes('₹4,720.00') && body.includes('(Rate difference)') && body.includes('credited to your account'));
  const list = await api('GET', '/credit-notes?status=issued');
  ok('the issued list has it', list.some((n) => n.id === cn.id));
}

console.log('\n[4] the reports: statement, GST summary (net, with the parts), HSN summary (net), sales register notes, Tally');
{
  const st = await api('GET', `/billing-reports/customer-statement?customerId=${customerId}`);
  const row = st.rows.find((r) => r.type === 'credit_note');
  ok(`statement row: ${row?.particulars} credit ${row?.credit}`, !!row && near(row.credit, 4720) && row.particulars.includes(cn.noteNo) && row.particulars.includes(invoice.invoiceNo));
  ok(`statement closes at ${st.closing} (47,200 invoiced less 4,720 credited)`, near(st.closing, 42480));
  const sp = await pdf(`/billing-reports/customer-statement/pdf?customerId=${customerId}`);
  prints('the printed statement carries the note', sp, `Credit note ${cn.noteNo}`);

  const gst = await api('GET', `/billing-reports/gst-summary?${range}`);
  ok(`GST summary has the parts: invoices ${gst.invoices?.total}, credit notes ${gst.creditNotes?.total} (${gst.creditNotes?.count}), debit notes ${gst.debitNotes?.total}`, gst.invoices && gst.creditNotes && gst.debitNotes && gst.creditNotes.count >= 1);
  ok('net = invoices − credit + debit, head by head', ['taxable', 'cgst', 'sgst', 'igst', 'total'].every((h) => near(gst[h], gst.invoices[h] - gst.creditNotes[h] + gst.debitNotes[h])));
  ok(`the period's total fell by the note (${gstBefore.total} → ${gst.total})`, near(gstBefore.total - gst.total, 4720) && near(gstBefore.taxable - gst.taxable, 4000));

  const hsn = await api('GET', `/billing-reports/hsn-summary?${range}`);
  const b = hsnRow(hsnBefore); const a = hsnRow(hsn);
  ok(`HSN 3824 @18 taxable fell by 4,000 (${b.taxable} → ${a.taxable}); quantity unchanged (${b.quantity} → ${a.quantity}) — a rate difference moves money, not concrete`, near(b.taxable - a.taxable, 4000) && near(b.quantity, a.quantity));

  const sales = await api('GET', `/billing-reports/sales-register?${range}`);
  const note = (sales.notes ?? []).find((n) => n.id === cn.id);
  ok(`sales register lists the note for Table 9B: ${note?.noteNo} against ${note?.invoiceNo} for ${note?.customerName}`, !!note && note.invoiceNo === invoice.invoiceNo && note.customerName === `Credit Note Co ${tag}`);
  const invRow = sales.rows.find((r) => r.id === invoice.id);
  ok(`sales register rows carry the customer name (${invRow?.customerName})`, invRow?.customerName === `Credit Note Co ${tag}`);

  const res = await fetch(`${BASE}/billing-reports/tally-export?${range}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const csv = await res.text();
  const tallyRow = csv.split('\n').find((l) => l.includes(cn.noteNo));
  ok(`Tally CSV: ${tallyRow}`, !!tallyRow && tallyRow.includes('Credit Note') && tallyRow.includes(invoice.invoiceNo) && csv.split('\n')[0].includes('AgainstInvoice'));
}

console.log('\n[5] cancelling an issued note gives the invoice its balance back and keeps the number');
{
  const cancelled = await api('POST', `/credit-notes/${cn.id}/cancel`, { reason: `raised in error ${tag}` });
  ok(`cancelled, number kept (${cancelled.noteNo})`, cancelled.status === 'cancelled' && cancelled.noteNo === cn.noteNo && cancelled.cancelReason === `raised in error ${tag}`);
  const inv = await invoiceOf(invoice.id);
  ok(`invoice restored: credited ${inv.creditNoteAmount}, outstanding ${inv.outstandingAmount}`, near(inv.creditNoteAmount, 0) && near(inv.outstandingAmount, 47200));
  const r = await pdf(`/credit-notes/${cn.id}/pdf`);
  prints('the cancelled note prints', r, 'CANCELLED');
  const gst = await api('GET', `/billing-reports/gst-summary?${range}`);
  ok('and is out of the GST summary again', near(gst.total, gstBefore.total));
  const [audit] = await q(`SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 AND action = 'credit_note.cancel'`, [TENANT, cn.id]);
  ok('the cancellation is audited', audit?.action === 'credit_note.cancel');
  await refused('cancelling it again', 'POST', `/credit-notes/${cn.id}/cancel`, { reason: 'x' }, /already cancelled/);
}

console.log('\n[6] a credit that would leave the customer overpaid is refused; a draft can be discarded');
{
  cn = await api('POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'credit', reason: 'rate_difference', lines: [line] });
  cn = await api('POST', `/credit-notes/${cn.id}/issue`);
  ok(`a fresh credit note ${cn.noteNo} issued (the cancelled one's number is not reused)`, cn.status === 'issued' && cn.noteNo !== null);
  const receipt = await api('POST', '/receipts', { customerId, amount: 42480, paymentMode: 'cash', allocations: [{ invoiceId: invoice.id, amount: 42480 }] });
  let inv = await invoiceOf(invoice.id);
  ok(`the customer pays the net 42,480 (${receipt.receiptNo}): invoice ${inv.paymentStatus}, outstanding ${inv.outstandingAmount}, credit still ${inv.creditNoteAmount}`, inv.paymentStatus === 'paid' && near(inv.outstandingAmount, 0) && near(inv.creditNoteAmount, 4720));
  const extra = await api('POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'credit', reason: 'discount', lines: [{ ...line, quantity: 1, rate: 1000 }] });
  await refused('issuing a further credit on a paid invoice', 'POST', `/credit-notes/${extra.id}/issue`, {}, /overpaid/);
  const gone = await api('POST', `/credit-notes/${extra.id}/cancel`, {});
  ok('the draft is discarded without a number', gone.status === 'cancelled' && !gone.noteNo);
  inv = await invoiceOf(invoice.id);
  ok('and the invoice is untouched', near(inv.outstandingAmount, 0) && near(inv.creditNoteAmount, 4720));
}

console.log('\n[7] a debit note raises what is owed; a receipt settles it and the debit stays');
{
  let dn = await api('POST', '/credit-notes', { invoiceId: invoice.id, noteType: 'debit', reason: 'additional_charge', remarks: 'pump hire', lines: [{ description: 'Pump hire', hsnSac: '9973', uom: 'hr', quantity: 1, rate: 1000, gstRate: 18 }] });
  ok(`debit draft for ${dn.totalAmount}`, dn.noteType === 'debit' && near(dn.totalAmount, 1180));
  dn = await api('POST', `/credit-notes/${dn.id}/issue`);
  ok(`issued as ${dn.noteNo}`, /^DN-/.test(String(dn.noteNo)));
  let inv = await invoiceOf(invoice.id);
  ok(`invoice owes the debit: outstanding ${inv.outstandingAmount}, ${inv.paymentStatus}, debited ${inv.debitNoteAmount}`, near(inv.outstandingAmount, 1180) && inv.paymentStatus === 'partially_paid' && near(inv.debitNoteAmount, 1180));
  const r = await pdf(`/credit-notes/${dn.id}/pdf`);
  for (const s of ['DEBIT NOTE', `No: ${dn.noteNo}`, 'Total debited   INR 1,180.00', 'Additional charge', 'Pump hire']) prints('debit note prints', r, s);
  const log = await api('POST', `/credit-notes/${dn.id}/share`, { mobile: '9876543210' });
  const body = String(log?.messageBody ?? log?.message ?? '');
  ok(`share text: ${body.slice(0, 120)}`, body.includes(`Debit note ${dn.noteNo}`) && body.includes('added to your account'));
  const st = await api('GET', `/billing-reports/customer-statement?customerId=${customerId}`);
  const row = st.rows.find((x) => x.type === 'debit_note');
  ok(`statement: ${row?.particulars} debit ${row?.debit}; closing ${st.closing}`, !!row && near(row.debit, 1180) && near(st.closing, 1180));
  await api('POST', '/receipts', { customerId, amount: 1180, paymentMode: 'cash', allocations: [{ invoiceId: invoice.id, amount: 1180 }] });
  inv = await invoiceOf(invoice.id);
  ok(`paid off: outstanding ${inv.outstandingAmount}, ${inv.paymentStatus}, debit still ${inv.debitNoteAmount}`, near(inv.outstandingAmount, 0) && inv.paymentStatus === 'paid' && near(inv.debitNoteAmount, 1180));
  await refused('cancelling the debit note once money was taken against it', 'POST', `/credit-notes/${dn.id}/cancel`, { reason: 'x' }, /reverse them before cancelling/);
  const gst = await api('GET', `/billing-reports/gst-summary?${range}`);
  ok(`GST summary: debit notes ${gst.debitNotes.total} (${gst.debitNotes.count}); net total ${gst.total} = before − 4,720 + 1,180`, gst.debitNotes.count >= 1 && near(gst.total, gstBefore.total - 4720 + 1180));
  await refused('cancelling the invoice with live notes on it', 'POST', `/invoices/${invoice.id}/cancel`, { reason: 'x' }, /./);
}

console.log('\n[7b] a short-supply credit note nets the HSN quantity as well as the value');
{
  const inv2 = await api('POST', `/invoices/${(await api('POST', '/invoices/from-challans', { customerId, lines: [{ challanId: await challan(), rate: 5000, gstRate: 18, hsnSac: '3824' }] })).id}/issue`);
  const before = hsnRow(await api('GET', `/billing-reports/hsn-summary?${range}`));
  let short = await api('POST', '/credit-notes', { invoiceId: inv2.id, noteType: 'credit', reason: 'quantity_shortfall', lines: [{ description: 'Short supplied', hsnSac: '3824', uom: 'm3', quantity: 1, rate: 5000, gstRate: 18 }] });
  short = await api('POST', `/credit-notes/${short.id}/issue`);
  const after = hsnRow(await api('GET', `/billing-reports/hsn-summary?${range}`));
  ok(`${short.noteNo} for 1 m3 short: HSN quantity ${before.quantity} → ${after.quantity}, taxable down ${before.taxable - after.taxable}`, near(before.quantity - after.quantity, 1) && near(before.taxable - after.taxable, 5000));
}

console.log('\n[8] an unknown note is a 404 with a message');
{
  const r = await raw('GET', `/credit-notes/${randomUUID()}`);
  ok(`${r.status}: ${r.message}`, r.status === 404 && /not found/i.test(r.message));
}

console.log(`\nCREDIT NOTES TEST: ${pass} passed`);
await owner.destroy();
