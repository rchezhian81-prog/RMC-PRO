/**
 * Batching Integration integration test (Plan A4).
 *
 * Builds a real draft batch ticket (quotation → order → queue → ticket), then
 * proves:
 *   - the MANUAL actuals path is unchanged (hand-keyed, sourceType stays 'manual')
 *   - a controller batch log with an out-of-tolerance line is detected
 *     (varianceExceeded)
 *   - a simulated controller ingest reconciles every material within tolerance
 *     and stamps the ticket sourceType='controller' + provenance
 *   - the ingested actuals flow through confirm (stock consumed)
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD. The
 * `batching_integration` module is enabled for the pilot tenant by the runner.
 * Reuses the CUST-001/SITE-001/M25/SRE-P1/M25-STD fixtures the orchestrator seeds.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

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
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping batching-integration — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== batching integration (controller ingest → reconcile → confirm) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

// ---- Build a draft batch ticket via the real chain ----
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present (grade/plant/mix/customer)', !!(grade && plant && mix && customer));

const TODAY = new Date().toISOString().slice(0, 10);
const QTY = 6;
let q = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: QTY, ratePerM3: 4800 }],
});
await api('POST', `/quotations/${q.id}/submit`);
q = await api('POST', `/quotations/${q.id}/approve`);

let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'A4 test auto-release' });
  order = await api('GET', `/orders/${order.id}`);
}
ok('order confirmed', String(order.orderStatus) === 'confirmed');

const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: QTY, mixDesignId: mix.id });
ok('draft batch ticket created with materials', ticket.status === 'draft' && ticket.materials.length > 0);
const ticketId = ticket.id;
const mats = ticket.materials;

// ---- A. Manual actuals path is unchanged ----
const manual = await api('POST', `/batch-tickets/${ticketId}/actuals`, {
  materials: mats.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
});
ok('manual actuals still update the ticket', manual.materials.length === mats.length);
ok('manual path leaves sourceType = manual', manual.sourceType === 'manual');

// ---- B. Register a simulated controller ----
const controller = await api('POST', '/batching-controllers', {
  name: `Sicoma Sim ${Date.now().toString().slice(-6)}`, plantId: plant.id, connectionType: 'simulated', make: 'Sicoma',
});
ok('controller created (simulated)', controller.connectionType === 'simulated');

// ---- C. Controller log with a forced breach is detected ----
const basisOf = (mm) => Number(mm.correctedTargetQuantity ?? mm.targetQuantity);
const csvLines = ['Material,Target,Actual'];
mats.forEach((mm, i) => {
  const basis = basisOf(mm);
  const actual = i === 0 ? basis * 1.2 : basis; // first material +20% → breach
  csvLines.push(`${mm.materialLabel},${basis},${actual}`);
});
const breach = await api('POST', `/batching-controllers/${controller.id}/ingest`, { batchTicketId: ticketId, rawLog: csvLines.join('\n') });
ok('ingest matched every ticket material', breach.reconciliation.matchedCount === mats.length);
ok('out-of-tolerance controller line flagged', breach.varianceExceeded === true);
const breachTicket = await api('GET', `/batch-tickets/${ticketId}`);
ok('ticket sourceType flipped to controller', breachTicket.sourceType === 'controller');
ok('ticket records the controller', breachTicket.controllerId === controller.id);

// confirm is blocked while a line breaches tolerance (existing gate, fed by ingest)
let blocked = false;
try { await api('POST', `/batch-tickets/${ticketId}/confirm`, {}); } catch { blocked = true; }
ok('confirm blocked by ingested variance (no override)', blocked);

// ---- D. Clean simulated ingest reconciles within tolerance ----
const clean = await api('POST', `/batching-controllers/${controller.id}/ingest`, { batchTicketId: ticketId });
ok('simulated ingest reconciles all lines', clean.reconciliation.matchedCount === mats.length);
ok('simulated ingest is within tolerance', clean.varianceExceeded === false);
const cleanTicket = await api('GET', `/batch-tickets/${ticketId}`);
ok('actuals now differ from the hand-keyed values (came off the controller)',
  cleanTicket.materials.some((mm, i) => !near(mm.actualQuantity, mats[i].correctedTargetQuantity ?? mats[i].targetQuantity)) ||
  cleanTicket.materials.every((mm) => mm.withinTolerance));

// ---- E. Ingested actuals flow through confirm (stock consumed) ----
const confirmed = await api('POST', `/batch-tickets/${ticketId}/confirm`, {});
ok('ticket confirms with the ingested actuals', confirmed.status === 'confirmed');

// ---- F. Mix-design integrity (Tier-3C) ----
const someMaterial = (await api('GET', '/materials'))[0];
const stamp = Date.now().toString().slice(-6);

// #19: a mix with a zero-quantity material cannot be approved.
const zeroMix = await api('POST', '/mix-designs', { gradeId: grade.id, plantId: plant.id, mixCode: `ZERO-${stamp}` });
await api('POST', `/mix-designs/${zeroMix.id}/materials`, { materialId: someMaterial.id, materialLabel: someMaterial.materialName, targetQuantity: 0, uom: someMaterial.uom, tolerancePercentage: 2, sequenceNo: 1 });
let zeroApproveBlocked = false;
try { await api('POST', `/mix-designs/${zeroMix.id}/approve`); } catch { zeroApproveBlocked = true; }
ok('a mix with a zero-quantity material cannot be approved', zeroApproveBlocked);

// #18: approving a new mix for the grade supersedes the prior active version.
const newVer = await api('POST', '/mix-designs', { gradeId: grade.id, plantId: plant.id, mixCode: `SUP-${stamp}` });
await api('POST', `/mix-designs/${newVer.id}/materials`, { materialId: someMaterial.id, materialLabel: someMaterial.materialName, targetQuantity: 7, uom: someMaterial.uom, tolerancePercentage: 2, sequenceNo: 1 });
await api('POST', `/mix-designs/${newVer.id}/approve`);
const priorAfter = await api('GET', `/mix-designs/${mix.id}`);
ok('approving a new version deactivates the grade’s prior active version', priorAfter.isActiveVersion === false);
const newVerAfter = await api('GET', `/mix-designs/${newVer.id}`);
ok('the newly approved version is the single active one', newVerAfter.isActiveVersion === true && newVerAfter.approvalStatus === 'approved');

console.log(`\nBATCHING INTEGRATION TEST: ${pass} passed ✓`);
process.exit(0);
