/**
 * The delivery challan prints the times that matter on site, on the plant's
 * clock: when the load was batched, when it left, and when it must be placed
 * by. Through the real chain (order → ticket → dispatch → challan → PDF).
 *
 * The defect this pins: the challan formatted its dispatch time with
 * toISOString() — UTC — so a load dispatched at 02:00 IST was printed as the
 * previous evening on the document the site engineer signs; and it carried no
 * batching time and no use-by at all, though ready-mix has a working life
 * from batching (IS 4926). Env: API_BASE, LOGIN, RMC_PASSWORD, PLANT_TIMEZONE.
 */

import { pdfText } from './helpers/pdf-text.mjs';

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const ZONE = process.env.PLANT_TIMEZONE || 'Asia/Kolkata';
const WORKING_LIFE_MINUTES = 120; // CONCRETE_SLA_MINUTES — the API's own constant; a drift here fails the Use-by check
let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
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
/** "14/09/2026 10:05" in the plant zone — independently of the API's helper. */
const onPlantClock = (iso) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = (t) => parts.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
};
const asUtc = (iso) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
if (!LOGIN || !PASSWORD) { console.log('(skipping challan-times — LOGIN/RMC_PASSWORD not set)'); process.exit(0); }

console.log('=== the delivery challan prints batched / dispatched / use-by on the plant clock ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const plant = await lookup('plants', 'plantCode', 'SRE-P1');
const mix = await lookup('mix-designs', 'mixCode', 'M25-STD');
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const site = await lookup('sites', 'siteCode', 'SITE-001');
ok('fixtures present (grade/plant/mix/customer)', !!(grade && plant && mix && customer));
const TODAY = new Date().toISOString().slice(0, 10);

let q = await api('POST', '/quotations', {
  customerId: customer.id, siteId: site?.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 6, ratePerM3: 4800 }],
});
await api('POST', `/quotations/${q.id}/submit`);
q = await api('POST', `/quotations/${q.id}/approve`);
let order = await api('POST', `/order-drafts/from-quotation/${q.id}`, { plantId: plant.id, orderDate: TODAY });
order = await api('POST', `/orders/${order.id}/confirm`);
if (String(order.orderStatus) === 'credit_hold') {
  const holds = await api('GET', '/credit-holds?status=pending');
  const hold = (Array.isArray(holds) ? holds : []).find((h) => String(h.orderId) === String(order.id));
  if (hold) await api('POST', `/credit-holds/${hold.id}/approve`, { note: 'challan-times test auto-release' });
  order = await api('GET', `/orders/${order.id}`);
}
const queue = await api('POST', `/batch-queue/from-order/${order.id}`);
const queueId = (Array.isArray(queue) ? queue[0] : queue)?.id;
let ticket = await api('POST', `/batch-tickets/from-queue/${queueId}`, { batchQuantityM3: 6, mixDesignId: mix.id });
await api('POST', `/batch-tickets/${ticket.id}/actuals`, {
  materials: ticket.materials.map((mm) => ({ id: mm.id, actualQuantity: Number(mm.correctedTargetQuantity ?? mm.targetQuantity) })),
});
ticket = await api('POST', `/batch-tickets/${ticket.id}/confirm`, {});
ok('batch ticket confirmed with a batch start time', ticket.status === 'confirmed' && !!ticket.batchStartTime);
const dispatch = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, {});
let challan = await api('POST', `/delivery-challans/from-dispatch/${dispatch.id}`, {});
challan = await api('POST', `/delivery-challans/${challan.id}/issue`);
ok('challan issued with a dispatch time', !!challan.dispatchTime);

const res = await fetch(`${API_BASE}/delivery-challans/${challan.id}/pdf`, { headers: { Authorization: `Bearer ${TOKEN}` } });
const buf = Buffer.from(await res.arrayBuffer());
ok('the challan renders a PDF', res.ok && buf.subarray(0, 5).toString() === '%PDF-');
const text = pdfText(buf);

const batched = onPlantClock(ticket.batchStartTime);
const useBy = onPlantClock(new Date(new Date(ticket.batchStartTime).getTime() + WORKING_LIFE_MINUTES * 60_000));
const dispatched = onPlantClock(challan.dispatchTime);
ok(`Batched: ${batched} — the batch ticket's start time, on the plant clock`, text.includes(`Batched: ${batched}`));
ok(`Dispatched: ${dispatched} — the challan's dispatch time, on the plant clock`, text.includes(`Dispatched: ${dispatched}`));
ok(`Use by: ${useBy} — batched plus the ${WORKING_LIFE_MINUTES}-minute working life`, text.includes(`Use by: ${useBy}`));
if (asUtc(challan.dispatchTime) !== dispatched) {
  ok(`the UTC rendering (${asUtc(challan.dispatchTime)}) is nowhere on the document`, !text.includes(asUtc(challan.dispatchTime)));
} else {
  console.log(`  (plant zone ${ZONE} equals UTC at this moment — the UTC-vs-plant check has nothing to distinguish)`);
}

console.log(`\nCHALLAN TIMES TEST: ${pass} passed`);
process.exit(0);
