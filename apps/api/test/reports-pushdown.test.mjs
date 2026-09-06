/**
 * Financial-report SQL-pushdown equivalence test.
 *
 * Five money reports used to load the whole issued-invoice (or payments/bills)
 * table and filter the date range in JS; the range filter now runs in the DB.
 * This pins the behaviour that could regress — the exact rows/totals a
 * [from, to] range admits, and that a NULL date and an out-of-range row are
 * excluded — so the pushdown is provably equivalent, not just faster.
 *
 * The trick that lets us assert EXACT totals against a shared tenant: seed in a
 * far-future window (2099-06) that no fixture row falls in, and query that
 * window. Only the rows this test seeds are in range, so the aggregate is ours
 * alone. Rows seeded just OUTSIDE the window, and one with a NULL date, must be
 * excluded — proving the boundary and the null handling.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID,
 * POSTGRES_* (owner, to seed rows with controlled dates).
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PW = process.env.RMC_PASSWORD;
const TENANT = process.env.TEST_TENANT_ID;

if (!LOGIN || !PW || !TENANT) {
  console.log('(skipping reports-pushdown — LOGIN/RMC_PASSWORD/TEST_TENANT_ID not set)');
  process.exit(0);
}

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  synchronize: false,
  logging: false,
});

let TOKEN = '';
async function api(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, body: await res.json() };
}
async function apiText(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, text: await res.text() };
}

// Far-future window nothing else lives in, plus out-of-range / null probes.
const FROM = '2099-06-01';
const TO = '2099-06-30';
const IN_A = '2099-06-10';
const IN_B = '2099-06-20';
const OUT = '2099-07-15';

(async () => {
  await owner.initialize();

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PW }),
  });
  TOKEN = (await loginRes.json())?.data?.access_token;
  ok('logged in as the tenant owner', typeof TOKEN === 'string' && TOKEN.length > 0);

  const tag = randomUUID().slice(0, 8);
  const inv = (no, date, gstin, taxable, cgst, sgst, igst, cess, total) =>
    owner.query(
      `INSERT INTO invoices (id, tenant_id, invoice_no, invoice_status, invoice_date, gstin,
                             taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount, round_off)
       VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,$8,$9,$10,$11,0)`,
      [randomUUID(), TENANT, no, date, gstin, taxable, cgst, sgst, igst, cess, total],
    );

  // Two in-range invoices (one B2B with GSTIN, one B2C without), one out of
  // range, one with a NULL invoice_date — the last two must be excluded.
  await inv(`RPI-${tag}-A`, IN_A, '29ABCDE1234F1Z5', 1000, 90, 90, 0, 0, 1180);
  await inv(`RPI-${tag}-B`, IN_B, null, 2000, 0, 0, 360, 10, 2370);
  await inv(`RPI-${tag}-OUT`, OUT, null, 5000, 0, 0, 900, 0, 5900);
  await inv(`RPI-${tag}-NULL`, null, null, 7000, 0, 0, 1260, 0, 8260);

  // Payments: two in-range with controlled created_at (B later than A → B first
  // under created_at DESC), one out of range, one NULL receipt_date.
  const pay = (no, date, createdAt, amount) =>
    owner.query(
      `INSERT INTO payments (id, tenant_id, receipt_no, receipt_date, created_at, amount, status)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6,'posted')`,
      [randomUUID(), TENANT, no, date, createdAt, amount],
    );
  await pay(`RPP-${tag}-A`, IN_A, '2099-06-10T09:00:00Z', 500);
  await pay(`RPP-${tag}-B`, IN_B, '2099-06-20T09:00:00Z', 700);
  await pay(`RPP-${tag}-OUT`, OUT, '2099-07-15T09:00:00Z', 900);
  await pay(`RPP-${tag}-NULL`, null, '2099-06-15T09:00:00Z', 1100);

  // Vendor bills for the GSTR-3B ITC side: one approved+ITC-eligible in range,
  // one out of range (must be excluded from claimable ITC).
  const bill = (no, date, taxable, tax) =>
    owner.query(
      `INSERT INTO vendor_bills (id, tenant_id, bill_no, status, itc_eligible, bill_date, taxable_amount, tax_amount)
       VALUES ($1,$2,$3,'approved',true,$4,$5,$6)`,
      [randomUUID(), TENANT, no, date, taxable, tax],
    );
  await bill(`RPB-${tag}-A`, IN_A, 4000, 720);
  await bill(`RPB-${tag}-OUT`, OUT, 8000, 1440);

  const q = `?from=${FROM}&to=${TO}`;

  // --- gst-summary: exact tax-head totals over ONLY the two in-range invoices.
  const gst = await api(`/billing-reports/gst-summary${q}`);
  ok('gst-summary responds 200', gst.status === 200);
  const g = gst.body.data;
  ok('gst-summary taxable = 3000 (in-range only; NULL + out excluded)', near(g.taxable, 3000));
  ok('gst-summary cgst = 90', near(g.cgst, 90));
  ok('gst-summary sgst = 90', near(g.sgst, 90));
  ok('gst-summary igst = 360', near(g.igst, 360));
  ok('gst-summary cess = 10', near(g.cess, 10));
  ok('gst-summary total = 3550', near(g.total, 3550));

  // --- sales-register: exactly the two in-range rows, invoice_date ASC, with
  // the B2B/B2C split.
  const sr = await api(`/billing-reports/sales-register${q}`);
  ok('sales-register responds 200', sr.status === 200);
  const s = sr.body.data;
  ok('sales-register count = 2 (NULL + out excluded)', s.count === 2);
  ok('sales-register total = 3550', near(s.total, 3550));
  ok('sales-register taxable = 3000', near(s.taxable, 3000));
  ok('sales-register rows are ordered invoice_date ASC', s.rows[0].invoiceNo === `RPI-${tag}-A` && s.rows[1].invoiceNo === `RPI-${tag}-B`);
  ok('sales-register B2B bucket = the 1 GSTIN invoice', s.summary.b2b.count === 1 && near(s.summary.b2b.total, 1180));
  ok('sales-register B2C bucket = the 1 no-GSTIN invoice', s.summary.b2c.count === 1 && near(s.summary.b2c.total, 2370));

  // --- receipts-register: exactly the two in-range receipts, created_at DESC.
  const rr = await api(`/billing-reports/receipts-register${q}`);
  ok('receipts-register responds 200', rr.status === 200);
  const rows = rr.body.data;
  const mine = rows.filter((p) => String(p.receiptNo).startsWith(`RPP-${tag}`));
  ok('receipts-register returns exactly the 2 in-range receipts', mine.length === 2);
  ok('receipts-register excludes the out-of-range and NULL-date receipts', !rows.some((p) => p.receiptNo === `RPP-${tag}-OUT` || p.receiptNo === `RPP-${tag}-NULL`));
  ok('receipts-register orders by created_at DESC (B before A)', mine[0].receiptNo === `RPP-${tag}-B` && mine[1].receiptNo === `RPP-${tag}-A`);

  // --- gstr-3b: output side = the in-range invoice heads; ITC taxable = the
  // in-range bill only.
  const g3 = await api(`/billing-reports/gstr-3b${q}`);
  ok('gstr-3b responds 200', g3.status === 200);
  const d = g3.body.data;
  ok('gstr-3b output taxable = 3000', near(d.output.taxable, 3000));
  ok('gstr-3b output total = 3550', near(d.output.total, 3550));
  ok('gstr-3b ITC taxable = 4000 (out-of-range bill excluded)', near(d.itc.taxable, 4000));

  // --- tally-export: CSV carries exactly the two in-range invoices.
  const tally = await apiText(`/billing-reports/tally-export${q}`);
  ok('tally-export responds 200', tally.status === 200);
  const dataLines = tally.text.trim().split('\n').slice(1); // drop header
  ok('tally-export has exactly 2 data rows', dataLines.length === 2);
  ok('tally-export contains both in-range invoices', tally.text.includes(`RPI-${tag}-A`) && tally.text.includes(`RPI-${tag}-B`));
  ok('tally-export excludes the out-of-range and NULL-date invoices', !tally.text.includes(`RPI-${tag}-OUT`) && !tally.text.includes(`RPI-${tag}-NULL`));

  await owner.destroy();
  console.log(`\nREPORTS PUSHDOWN TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
