/**
 * Integration test for the GST execution scaffold (GW-2/3/4), driven end to end
 * with the deterministic FAKE provider (GST_PROVIDER=fake in the suite env — no
 * credentials, no government portal). Proves the full pipeline that a live
 * deployment will run:
 *   - GET /agents/gst reports the fake provider is configured;
 *   - prepare (M5) → approve → EXECUTE an IRN action writes irn/ack/QR onto the
 *     invoice and flips einvoice_status to 'generated';
 *   - Path A: because that invoice also warrants an e-way, the preparer flags
 *     includeEway and the IRN call files the e-way in the same response;
 *   - re-executing is idempotent ('already_generated', no second call);
 *   - a standalone e-way bill on a fresh invoice (eway_bill_no + validity persisted);
 *   - a pre-flight failure (missing HSN) fails cleanly with einvoice_status
 *     'failed' and NO IRN — nothing was transmitted;
 *   - executing an approval that is not approved is refused.
 *
 * The live NIC/GSP adapter is held; this proves everything around it.
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

/** Insert a fully-formed, clean invoice + one line item (owner role). */
async function seedInvoice({ hsn = '38245010' } = {}) {
  const s = randomUUID().slice(0, 8);
  const invId = randomUUID();
  await owner.query(
    `INSERT INTO invoices (id, tenant_id, invoice_no, invoice_date, place_of_supply, gstin,
        taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, total_amount,
        distance_km, transport_mode, vehicle_no, invoice_status, einvoice_status, eway_status)
     VALUES ($1,$2,$3,current_date,'33','33XYZAB6789K1Z2',
        250000,22500,22500,0,0,0,295000,350,'road','TN01AB1234','issued','not_generated','not_generated')`,
    [invId, TENANT, 'GSTINV-' + s],
  );
  await owner.query(
    `INSERT INTO invoice_items (tenant_id, invoice_id, hsn_sac, uom, quantity, rate,
        taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, cess_amount, line_total)
     VALUES ($1,$2,$3,'CUM',50,5000,250000,18,22500,22500,0,0,295000)`,
    [TENANT, invId, hsn],
  );
  return { invId, docNo: 'GSTINV-' + s };
}

async function prepareApproveExecute(compliance, invId, extra = {}) {
  const run = await api('POST', '/agents/automation/run', { compliance, invoiceId: invId, ...extra });
  const approvalId = run.data?.outcome?.result?.prepared?.approvalId;
  await api('POST', `/agents/approvals/${approvalId}/decide`, { decision: 'approved' });
  const exec = await api('POST', `/agents/approvals/${approvalId}/execute`);
  return { approvalId, exec };
}

(async () => {
  if (!TENANT) throw new Error('TEST_TENANT_ID not provided');
  await owner.initialize();

  // Ensure a seller company with a valid GSTIN exists for this tenant.
  const [company] = await owner.query(`SELECT id FROM companies WHERE tenant_id = $1 LIMIT 1`, [TENANT]);
  if (company) {
    await owner.query(
      `UPDATE companies SET gstin='33ABCDE1234F1Z5', legal_name='CI Seller', address_line1='Plant Rd', city='Chennai', pincode='600001' WHERE id=$1`,
      [company.id],
    );
  } else {
    await owner.query(
      `INSERT INTO companies (tenant_id, company_name, legal_name, gstin, address_line1, city, pincode)
       VALUES ($1,'CI Seller','CI Seller','33ABCDE1234F1Z5','Plant Rd','Chennai','600001')`,
      [TENANT],
    );
  }

  await login();

  console.log('=== provider status ===');
  const status = await api('GET', '/agents/gst');
  ok('the GST provider is configured (fake) in this suite', status.data?.configured === true);
  ok('the provider is the deterministic fake', status.data?.provider === 'fake');

  console.log('\n=== IRN: prepare → approve → execute ===');
  const { invId } = await seedInvoice();
  const { approvalId, exec } = await prepareApproveExecute('einvoice', invId);
  ok('the IRN execution reports generated', exec.data?.status === 'generated');
  ok('it returns a 64-char IRN reference', typeof exec.data?.reference === 'string' && exec.data.reference.length === 64);
  const [row] = await owner.query(`SELECT irn, ack_number, signed_qr_code, einvoice_status FROM invoices WHERE id=$1`, [invId]);
  ok('the invoice now carries the IRN + ack + QR', !!row.irn && !!row.ack_number && !!row.signed_qr_code);
  ok('einvoice_status flipped to generated', row.einvoice_status === 'generated');

  // Tier-3: an invoice with a LIVE IRN cannot be cancelled locally — that would
  // make the challans re-billable while the government IRN stays active.
  const cancelLive = await api('POST', `/invoices/${invId}/cancel`, { reason: 'test' });
  ok('an invoice with a live IRN cannot be cancelled locally', cancelLive.status === 400);

  console.log('\n=== IRN execution is idempotent ===');
  const again = await api('POST', `/agents/approvals/${approvalId}/execute`);
  ok('re-executing an already-generated IRN is a no-op', again.data?.status === 'already_generated');

  console.log('\n=== Path A: the IRN call also filed the e-way ===');
  // This invoice qualifies for Path A (₹2,95,000 over 350 km), so the compliance
  // preparer set includeEway on the IRN approval and the IRN execution above filed
  // the e-way in the SAME call. Assert it landed — in the response and on the row.
  ok('the IRN response also carried a 12-digit e-way (Path A)',
    typeof exec.data?.detail?.ewayBillNo === 'string' && exec.data.detail.ewayBillNo.length === 12);
  const [pathA] = await owner.query(`SELECT eway_bill_no, eway_valid_until, eway_status FROM invoices WHERE id=$1`, [invId]);
  ok('Path A persisted the e-way onto the invoice',
    !!pathA.eway_bill_no && pathA.eway_bill_no.length === 12 && !!pathA.eway_valid_until && pathA.eway_status === 'generated');

  console.log('\n=== e-way (standalone): prepare → approve → execute ===');
  // A fresh invoice that has NOT been through an IRN — exercises the standalone
  // eway_bill execution path (the non-Path-A route).
  const { invId: ewayInvId } = await seedInvoice();
  const ewExec = await prepareApproveExecute('eway', ewayInvId);
  ok('the e-way execution reports generated', ewExec.exec.data?.status === 'generated');
  const [ew] = await owner.query(`SELECT eway_bill_no, eway_valid_until, eway_status FROM invoices WHERE id=$1`, [ewayInvId]);
  ok('the invoice carries a 12-digit e-way number + validity', !!ew.eway_bill_no && ew.eway_bill_no.length === 12 && !!ew.eway_valid_until);
  ok('eway_status flipped to generated', ew.eway_status === 'generated');

  console.log('\n=== IRN cancel: prepare → approve → execute (24h window) ===');
  const irnCancel = await prepareApproveExecute('einvoice_cancel', invId, { reasonCode: '3', remarks: 'order cancelled' });
  ok('the IRN cancel reports cancelled', irnCancel.exec.data?.status === 'cancelled');
  const [irnCancelled] = await owner.query(`SELECT einvoice_status FROM invoices WHERE id=$1`, [invId]);
  ok('einvoice_status flipped to cancelled', irnCancelled.einvoice_status === 'cancelled');
  const irnCancelAgain = await api('POST', `/agents/approvals/${irnCancel.approvalId}/execute`);
  ok('re-cancelling an already-cancelled IRN is a no-op', irnCancelAgain.data?.status === 'already_cancelled');

  console.log('\n=== e-way cancel: prepare → approve → execute ===');
  const ewayCancel = await prepareApproveExecute('eway_cancel', ewayInvId, { reasonCode: '2' });
  ok('the e-way cancel reports cancelled', ewayCancel.exec.data?.status === 'cancelled');
  const [ewCancelled] = await owner.query(`SELECT eway_status FROM invoices WHERE id=$1`, [ewayInvId]);
  ok('eway_status flipped to cancelled', ewCancelled.eway_status === 'cancelled');

  console.log('\n=== cancel guardrails ===');
  // An invalid reason code is rejected at the API boundary (before any approval).
  const badReasonRun = await api('POST', '/agents/automation/run', { compliance: 'einvoice_cancel', invoiceId: invId, reasonCode: '9' });
  ok('an invalid cancel reason code is a 400', badReasonRun.status === 400);
  // Cancelling something never generated is refused in the execute pre-flight.
  const notGen = await seedInvoice();
  const cancelUngenerated = await prepareApproveExecute('eway_cancel', notGen.invId, { reasonCode: '1' });
  ok('cancelling a not-generated e-way fails', cancelUngenerated.exec.data?.status === 'failed');
  ok('the failure explains it was not generated', JSON.stringify(cancelUngenerated.exec.data?.errors ?? []).match(/generated/i) !== null);

  console.log('\n=== e-way vehicle update + extend (live e-way) ===');
  // A fresh invoice with a freshly generated (not cancelled) e-way to modify.
  const modInv = await seedInvoice();
  await prepareApproveExecute('eway', modInv.invId);
  const upd = await prepareApproveExecute('eway_update_vehicle', modInv.invId, { vehicleNo: 'TN09XY9999', reasonCode: '1', remarks: 'breakdown' });
  ok('the vehicle update reports updated', upd.exec.data?.status === 'updated');
  const [uv] = await owner.query(`SELECT vehicle_no, eway_status FROM invoices WHERE id=$1`, [modInv.invId]);
  ok('the invoice carries the new vehicle', uv.vehicle_no === 'TN09XY9999');
  ok('eway_status stays generated after a vehicle update', uv.eway_status === 'generated');

  const ext = await prepareApproveExecute('eway_extend', modInv.invId, { remainingDistanceKm: 120, reasonCode: '4', remarks: 'accident detour' });
  ok('the extend reports extended', ext.exec.data?.status === 'extended');
  const [ev] = await owner.query(`SELECT eway_valid_until, eway_status FROM invoices WHERE id=$1`, [modInv.invId]);
  ok('the invoice validity is set + still generated', !!ev.eway_valid_until && ev.eway_status === 'generated');

  console.log('\n=== e-way modify guardrails ===');
  // Modifying a not-generated e-way is refused in the execute pre-flight.
  const noEway = await seedInvoice();
  const badModify = await prepareApproveExecute('eway_extend', noEway.invId, { remainingDistanceKm: 50, reasonCode: '1' });
  ok('extending a not-generated e-way fails', badModify.exec.data?.status === 'failed');
  ok('the failure explains it was not generated', JSON.stringify(badModify.exec.data?.errors ?? []).match(/generated/i) !== null);
  // An out-of-set extension reason code is rejected at the API boundary.
  const badExtendReason = await api('POST', '/agents/automation/run', { compliance: 'eway_extend', invoiceId: modInv.invId, remainingDistanceKm: 50, reasonCode: '7' });
  ok('an invalid extension reason code is a 400', badExtendReason.status === 400);

  console.log('\n=== pre-flight failure transmits nothing ===');
  const bad = await seedInvoice({ hsn: null });
  const badExec = await prepareApproveExecute('einvoice', bad.invId);
  ok('a missing-HSN invoice fails pre-flight', badExec.exec.data?.status === 'failed');
  ok('the failure cites HSN', JSON.stringify(badExec.exec.data?.errors ?? []).match(/HSN/i) !== null);
  const [badRow] = await owner.query(`SELECT irn, einvoice_status FROM invoices WHERE id=$1`, [bad.invId]);
  ok('no IRN was written and status is failed (nothing transmitted)', badRow.irn === null && badRow.einvoice_status === 'failed');

  console.log('\n=== executing a non-approved approval is refused ===');
  const run = await api('POST', '/agents/automation/run', { compliance: 'einvoice', invoiceId: (await seedInvoice()).invId });
  const pendingId = run.data?.outcome?.result?.prepared?.approvalId;
  const refused = await api('POST', `/agents/approvals/${pendingId}/execute`);
  ok('executing a still-pending approval is a 409', refused.status === 409);

  console.log('\n=== durable execution queue (GW-1): approve → enqueue → drain ===');
  const qInv = await seedInvoice();
  const qRun = await api('POST', '/agents/automation/run', { compliance: 'einvoice', invoiceId: qInv.invId });
  const qApprovalId = qRun.data?.outcome?.result?.prepared?.approvalId;
  // Approve — but do NOT call execute; the durable queue is the processor here.
  await api('POST', `/agents/approvals/${qApprovalId}/decide`, { decision: 'approved' });
  const jobsBefore = await api('GET', '/agents/gst/jobs');
  const queuedJob = (jobsBefore.data ?? []).find((j) => j.approvalId === qApprovalId);
  ok('approving a GST action enqueues a durable job', !!queuedJob && queuedJob.status === 'queued');
  const [preRow] = await owner.query(`SELECT irn, einvoice_status FROM invoices WHERE id=$1`, [qInv.invId]);
  ok('the invoice is not run inline on approval (still not_generated)', preRow.irn === null && preRow.einvoice_status === 'not_generated');
  // Drain the queue (operator trigger) — exercises the worker path deterministically.
  const drain = await api('POST', '/agents/gst/jobs/drain');
  ok('draining processes the queued job', (drain.data?.processed ?? 0) >= 1);
  const [postRow] = await owner.query(`SELECT irn, einvoice_status FROM invoices WHERE id=$1`, [qInv.invId]);
  ok('the queue generated the IRN', !!postRow.irn && postRow.einvoice_status === 'generated');
  const jobsAfter = await api('GET', '/agents/gst/jobs');
  const doneJob = (jobsAfter.data ?? []).find((j) => j.approvalId === qApprovalId);
  ok('the job is marked done after draining', doneJob?.status === 'done');
  // Idempotency: a second drain finds nothing queued (the job is already done).
  const drain2 = await api('POST', '/agents/gst/jobs/drain');
  ok('a second drain re-runs nothing', (drain2.data?.processed ?? -1) === 0);

  console.log('\n=== GST metrics exposed on /metrics ===');
  const ROOT = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
  const metricsRes = await fetch(`${ROOT}/metrics`, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
  const metricsBody = await metricsRes.text();
  ok('metrics scrape is 200', metricsRes.status === 200);
  ok('gst_transmissions_total records generated results', /gst_transmissions_total\{[^}]*result="generated"[^}]*\} \d+/.test(metricsBody));
  ok('gst_execution_seconds histogram is exposed', metricsBody.includes('gst_execution_seconds_bucket'));
  ok('gst_jobs_total records enqueued + done events',
    /gst_jobs_total\{event="enqueued"\} \d+/.test(metricsBody) && /gst_jobs_total\{event="done"\} \d+/.test(metricsBody));

  await owner.destroy();
  console.log(`\nAGENT GST EXECUTION TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
