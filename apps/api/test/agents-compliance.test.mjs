/**
 * Integration test for M5 — assisted compliance. The Automation agent PREPARES
 * India IRN / e-way payloads as approval requests; nothing is transmitted.
 * Proves:
 *   - preparing an e-invoice payload yields a pending approval (actionKind
 *     einvoice_irn) whose payload carries the INV-01 essentials;
 *   - preparing an e-way payload yields a pending approval (actionKind eway_bill)
 *     whose payload carries the computed validity (1 day / 200 km);
 *   - approving the e-invoice request does NOT change the invoice's
 *     einvoice_status — transmission is held for deployment.
 *
 * Env: POSTGRES_* (owner) + TEST_TENANT_ID, API_BASE, LOGIN, RMC_PASSWORD.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const TENANT = process.env.TEST_TENANT_ID;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  synchronize: false, logging: false,
});

let token;
async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body?.success) throw new Error(`login failed: ${JSON.stringify(body)}`);
  token = body.data.access_token;
}
async function api(method, path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => null))?.data };
}

(async () => {
  if (!TENANT) throw new Error('TEST_TENANT_ID not provided');
  await owner.initialize();

  const s = randomUUID().slice(0, 8);
  const invId = randomUUID();
  await owner.query(
    `INSERT INTO invoices (id, tenant_id, invoice_no, total_amount, taxable_amount, igst_amount,
        invoice_status, einvoice_status, eway_status, distance_km, invoice_date)
     VALUES ($1,$2,$3,295000,250000,45000,'issued','not_generated','not_generated',350,current_date)`,
    [invId, TENANT, 'CMPINV-' + s],
  );

  await login();

  console.log('=== prepare e-invoice (IRN) ===');
  const ei = await api('POST', '/agents/automation/run', { compliance: 'einvoice', invoiceId: invId });
  ok('the e-invoice prepare run completes', ei.data?.status === 'completed');
  const eiId = ei.data?.outcome?.result?.prepared?.approvalId;
  ok('it prepared a pending einvoice_irn approval', ei.data?.outcome?.result?.prepared?.actionKind === 'einvoice_irn' && typeof eiId === 'string');
  const eiReq = (await api('GET', '/agents/approvals?status=pending')).data.find((r) => r.id === eiId);
  ok('the approval payload carries the INV-01 doc number', eiReq?.payload?.docNo === 'CMPINV-' + s);
  ok('the approval records the underlying action as legal-class', eiReq?.reversibility === 'legal');

  console.log('\n=== prepare e-way bill ===');
  const ew = await api('POST', '/agents/automation/run', { compliance: 'eway', invoiceId: invId });
  const ewId = ew.data?.outcome?.result?.prepared?.approvalId;
  ok('it prepared a pending eway_bill approval', ew.data?.outcome?.result?.prepared?.actionKind === 'eway_bill');
  const ewReq = (await api('GET', '/agents/approvals?status=pending')).data.find((r) => r.id === ewId);
  ok('the e-way payload carries the computed validity (ceil 350/200 = 2)', ewReq?.payload?.validityDays === 2);

  console.log('\n=== approval does not transmit (held for deployment) ===');
  const dec = await api('POST', `/agents/approvals/${eiId}/decide`, { decision: 'approved' });
  ok('the e-invoice request can be approved', dec.data?.status === 'approved');
  const [row] = await owner.query(`SELECT einvoice_status FROM invoices WHERE id = $1`, [invId]);
  ok('the invoice einvoice_status is UNCHANGED after approval (no IRP call)', row.einvoice_status === 'not_generated');
  await owner.destroy();

  console.log(`\nAGENT COMPLIANCE TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
