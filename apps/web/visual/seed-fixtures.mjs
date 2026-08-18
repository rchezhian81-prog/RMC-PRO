/**
 * Visual-harness fixture seeder — closes the 8 detail ([id]) routes.
 *
 * Creates ONE deterministic synthetic order-to-cash chain (+ rate-contract +
 * QC cube-set) through the REAL authenticated API, in the local throwaway VISUAL
 * test tenant only, then writes the created ids to visual/.fixtures.json for
 * evidence.spec to render the detail pages against.
 *
 * DATA SAFETY (never violated):
 *   • test tenant + throwaway local DB only — never production.
 *   • synthetic data; reuses the seeded CUST-001 sample customer; no real PII.
 *   • records carry a VISUAL-TEST marker where a free-text field allows.
 *   • idempotent per fresh DB (serve-stack resets the DB each run) and fully
 *     removable (the whole cluster is ephemeral).
 *   • goes through existing domain endpoints only — no API/business-rule change,
 *     no auth/RBAC/tenant-isolation weakening, no ids hard-coded into the app.
 *
 * Recipe verified against scripts/setup/test-order-cycle.mjs + the services.
 * Usage (API already up, tenant seeded):
 *   API_URL=http://localhost:4000 LOGIN=owner@visual.test RMC_PASSWORD=... \
 *     node apps/web/visual/seed-fixtures.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
const LOGIN = process.env.LOGIN ?? 'owner@visual.test';
const PASSWORD = process.env.RMC_PASSWORD ?? process.env.PASSWORD ?? 'OwnerVis#12345';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.fixtures.json');

// Fixed synthetic dates (FY 2026-27) so numbers/dates are deterministic.
const D = { quote: '2026-04-01', validQ: '2026-06-30', contract: '2026-04-01', validCFrom: '2026-04-01', validCTo: '2027-03-31', order: '2026-04-01', invoice: '2026-04-01', due: '2026-05-01', cast: '2026-04-01' };
const MARK = 'VISUAL-TEST';

let TOKEN = '';
async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)?.slice(0, 300)}`);
  return data.data;
}
const find = (rows, field, val) => (Array.isArray(rows) ? rows : rows?.rows ?? []).find((r) => String(r[field]) === val);
const log = (m) => console.log(`  fixtures: ${m}`);

async function main() {
  // 0) auth (owner) — capture tenant id for the /admin/tenants/[id] route.
  const auth = await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD });
  TOKEN = auth.access_token;
  const tenantId = auth.tenant?.id ?? auth.tenantId ?? '';

  // 0.5) existing master ids
  const customer = find(await api('GET', '/customers'), 'customerCode', 'CUST-001');
  const site = find(await api('GET', '/sites'), 'siteCode', 'SITE-001');
  const grade = find(await api('GET', '/concrete-grades'), 'gradeCode', 'M25');
  const plants = await api('GET', '/plants');
  const plant = (Array.isArray(plants) ? plants : plants.rows)[0];
  const mixes = await api('GET', '/mix-designs');
  const mix = find(mixes, 'mixCode', 'M25-STD');
  if (!customer || !site || !grade || !plant || !mix) throw new Error('missing seeded masters (customer/site/grade/plant/mix)');

  // 1) quotation → submit → approve
  let q = await api('POST', '/quotations', {
    customerId: customer.id, siteId: site.id, quotationDate: D.quote, validUntil: D.validQ,
    paymentTerms: `${MARK} net 30`,
    items: [{ gradeId: grade.id, gradeLabel: 'M25', estimatedQuantity: 50, ratePerM3: 5000 }],
  });
  await api('POST', `/quotations/${q.id}/submit`);
  await api('POST', `/quotations/${q.id}/approve`);
  log(`quotation ${q.quotationNo}`);

  // 2) rate contract → submit → approve (side branch)
  const rc = await api('POST', '/rate-contracts', {
    customerId: customer.id, siteId: site.id, contractDate: D.contract, validFrom: D.validCFrom, validUntil: D.validCTo,
    notes: `${MARK} fixture`,
    items: [{ gradeId: grade.id, gradeLabel: 'M25', ratePerM3: 5000, gstApplicable: true, gstRate: 18 }],
  });
  await api('POST', `/rate-contracts/${rc.id}/submit`).catch(() => {});
  await api('POST', `/rate-contracts/${rc.id}/approve`).catch(() => {});
  log(`rate-contract ${rc.rateContractNo}`);

  // 3) order from quotation → confirm (release credit hold if needed)
  let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: D.order });
  order = await api('POST', `/orders/${order.id}/confirm`);
  if (order.orderStatus === 'credit_hold') {
    const holds = await api('GET', '/credit-holds?status=pending');
    const hold = (Array.isArray(holds) ? holds : holds.rows ?? []).find((h) => String(h.orderId) === String(order.id));
    if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: `${MARK} auto-release` });
    order = await api('GET', `/orders/${order.id}`);
  }
  log(`order ${order.orderNo} (${order.orderStatus})`);

  // 4-5) batch queue → batch ticket → confirm
  const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
  const queueId = (Array.isArray(queue) ? queue[0] : queue).id;
  let bt = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: 50, mixDesignId: mix.id });
  await api('POST', `/batch-tickets/${bt.id}/confirm`, {}).catch(async () => {
    await api('POST', `/batch-tickets/${bt.id}/confirm`, { overrideVariance: true });
  });
  log(`batch-ticket ${bt.batchTicketNo}`);

  // 6-7) dispatch → challan → issue → deliver
  const dispatch = await api('POST', `/dispatches/from-batch-ticket/${bt.id}`, {});
  let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, { slump: '100' });
  await api('POST', `/delivery-challans/${challan.id}/issue`);
  await api('POST', `/delivery-challans/${challan.id}/deliver`, { receiverName: `${MARK} Site Engineer`, returnQuantityM3: 0 });
  log(`challan ${challan.challanNo}`);

  // 8) QC cube-set (attaches to batch ticket)
  const cube = await api('POST', '/qc/cube-sets', {
    castDate: D.cast, gradeId: grade.id, gradeLabel: 'M25', batchTicketId: bt.id, plantId: plant.id,
    mixDesignId: mix.id, specimenCount: 3, cubeSizeMm: 150, samplingRef: `${MARK}-SR1`,
  });
  log(`cube-set ${cube.setNo}`);

  // 9) invoice from delivered challan → issue
  let invoice = await api('POST', '/invoices/from-challans', {
    customerId: customer.id, invoiceDate: D.invoice, dueDate: D.due,
    lines: [{ challanId: challan.id, rate: 5000, gstRate: 18, hsnSac: '3824', uom: 'm3' }],
  });
  await api('POST', `/invoices/${invoice.id}/issue`);
  log(`invoice ${invoice.invoiceNo}`);

  const fixtures = {
    _marker: MARK, tenantId,
    quotationId: q.id, rateContractId: rc.id, orderId: order.id,
    batchTicketId: bt.id, challanId: challan.id, invoiceId: invoice.id, cubeSetId: cube.id,
  };
  writeFileSync(OUT, JSON.stringify(fixtures, null, 2));
  log(`wrote ${OUT}`);
}

main().catch((e) => { console.error('SEED-FIXTURES FAILED:', e.message); process.exit(1); });
