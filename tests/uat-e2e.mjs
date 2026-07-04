import { api, raw, login, suite, BASE } from './lib.mjs';
import { SyncEngine } from '../apps/plant-app/src/sync/engine.js';

/**
 * End-to-end UAT: the full Phase-1 order-to-cash journey plus offline sync and
 * dashboards, exercised as one user flow against the live API.
 */
export async function run() {
  const s = suite('UAT end-to-end (order-to-cash + offline + dashboards)');
  const admin = await login('admin@alpha.test');
  const t = { token: admin };
  const stamp = Date.now() % 100000;

  // 1. Tenant setup present
  const company = await api('GET', '/company', t);
  const plantId = (await api('GET', '/plants', t))[0].id;
  s.ok('tenant setup: company + plant present', !!company?.companyName && !!plantId);

  // 2. Master setup
  const grade = (await api('GET', '/concrete-grades', t)).find((g) => g.gradeCode === 'M25');
  const customer = await api('POST', '/customers', { ...t, body: { customerCode: `UAT-${stamp}`, customerName: `UAT Customer ${stamp}`, state: company?.state ?? 'TN', gstin: '33UATCD1234F1Z5', creditLimit: 5000000, billingAddress: 'Chennai', mobile: '9800099999' } });
  const mats = {};
  for (const [k, code, name] of [['cem', `UATC-${stamp}`, 'UAT Cement'], ['sand', `UATS-${stamp}`, 'UAT Sand'], ['agg', `UATA-${stamp}`, 'UAT Aggregate']]) {
    mats[k] = await api('POST', '/materials', { ...t, body: { materialCode: code, materialName: name, uom: 'kg', reorderLevel: 100, standardRate: 6 } });
    await api('POST', '/stock/opening', { ...t, body: { plantId, materialId: mats[k].id, quantity: 100000 } });
  }
  const mix = await api('POST', '/mix-designs', { ...t, body: { gradeId: grade.id, mixCode: `UAT-MIX-${stamp}`, materials: [
    { materialId: mats.cem.id, materialLabel: 'UAT Cement', targetQuantity: 350, uom: 'kg', tolerancePercentage: 2 },
    { materialId: mats.sand.id, materialLabel: 'UAT Sand', targetQuantity: 700, uom: 'kg', tolerancePercentage: 3 },
    { materialId: mats.agg.id, materialLabel: 'UAT Aggregate', targetQuantity: 1200, uom: 'kg', tolerancePercentage: 3 },
  ] } });
  await api('POST', `/mix-designs/${mix.id}/approve`, t);
  s.ok('master setup: customer, materials, approved mix design', !!customer.id && !!mix.id);

  // 3. Quotation
  const q = await api('POST', '/quotations', { ...t, body: { customerId: customer.id, quotationDate: '2026-07-04', items: [{ gradeId: grade.id, gradeLabel: 'M25', estimatedQuantity: 10, ratePerM3: 4500 }] } });
  await api('POST', `/quotations/${q.id}/submit`, t);
  await api('POST', `/quotations/${q.id}/approve`, t);
  const qpdf = await raw('GET', `/quotations/${q.id}/pdf`, t);
  s.ok('quotation created → approved → PDF', qpdf.status === 200 && (await qpdf.res.text()).startsWith('%PDF-'));

  // 4. Order + credit check
  const od = await api('POST', `/order-drafts/from-quotation/${q.id}`, { ...t, body: { plantId } });
  const order = await api('POST', `/orders/${od.id}/confirm`, t);
  s.ok('order confirmed within credit limit', order.orderStatus === 'confirmed' && order.creditStatus === 'approved');

  // 5/6. Production + batching → inventory reduced
  const cemBefore = Number((await api('GET', '/stock/balances', t)).find((b) => b.materialId === mats.cem.id).currentQuantity);
  const qe = await api('POST', `/batch-queue/from-order/${od.id}`, t);
  const ticket = await api('POST', `/batch-tickets/from-queue/${qe[0].id}`, { ...t, body: { batchQuantityM3: 10 } });
  const confirmed = await api('POST', `/batch-tickets/${ticket.id}/confirm`, { ...t, body: {} });
  const cemAfter = Number((await api('GET', '/stock/balances', t)).find((b) => b.materialId === mats.cem.id).currentQuantity);
  s.ok('batch confirmed → inventory reduced (cement -3500)', confirmed.status === 'confirmed' && cemAfter === cemBefore - 3500, `${cemBefore}->${cemAfter}`);

  // 7. Dispatch + challan
  const disp = await api('POST', `/dispatches/from-batch-ticket/${ticket.id}`, { ...t, body: {} });
  for (const st of ['left_plant', 'reached_site', 'pouring', 'completed']) await api('POST', `/dispatches/${disp.id}/status`, { ...t, body: { status: st } });
  const challan = await api('POST', `/delivery-challans/from-dispatch/${disp.id}`, { ...t, body: { slump: '120mm' } });
  await api('POST', `/delivery-challans/${challan.id}/issue`, t);
  const delivered = await api('POST', `/delivery-challans/${challan.id}/deliver`, { ...t, body: { receiverName: 'UAT Receiver' } });
  s.ok('dispatch board → challan issued → delivered', delivered.challanStatus === 'delivered');

  // 8. Inventory: material inward → post → stock up
  const inward = await api('POST', '/material-inwards', { ...t, body: { plantId, materialId: mats.cem.id, quantityReceived: 5000, quantityAccepted: 5000, rate: 6 } });
  await api('POST', `/material-inwards/${inward.id}/post`, t);
  const cemInward = Number((await api('GET', '/stock/balances', t)).find((b) => b.materialId === mats.cem.id).currentQuantity);
  s.ok('material inward posted → stock +5000', cemInward === cemAfter + 5000, `${cemAfter}->${cemInward}`);

  // 9. Billing: invoice from challan (flips to invoiced)
  const invoice = await api('POST', '/invoices/from-challans', { ...t, body: { customerId: customer.id, invoiceDate: '2026-07-04', lines: [{ challanId: challan.id, hsnSac: '68109990', uom: 'm3', rate: 4500, gstRate: 18 }] } });
  await api('POST', `/invoices/${invoice.id}/issue`, t);
  const challanAfter = await api('GET', `/delivery-challans/${challan.id}`, t);
  s.ok('invoice from challan → challan invoiced, GST computed', challanAfter.invoiceStatus === 'invoiced' && Number(invoice.cgstAmount) === 4050 && Number(invoice.totalAmount) === 53100, `total=${invoice.totalAmount}`);

  // 10. Receipt + outstanding
  await api('POST', '/receipts', { ...t, body: { customerId: customer.id, amount: 30000, paymentMode: 'neft', receiptDate: '2026-07-05', allocations: [{ invoiceId: invoice.id, amount: 30000 }] } });
  const invPaid = await api('GET', `/invoices/${invoice.id}`, t);
  s.ok('receipt allocated → outstanding 23100', invPaid.paymentStatus === 'partially_paid' && Number(invPaid.outstandingAmount) === 23100, `=${invPaid.outstandingAmount}`);

  // 11. Offline challan/batch sync (plant app engine)
  const engine = new SyncEngine({ dbPath: ':memory:', baseUrl: BASE, token: admin });
  await engine.registerAndBootstrap({ deviceIdentifier: `UAT-DEV-${stamp}`, deviceName: 'UAT Plant PC' });
  await engine.reserve('delivery_challan', 10);
  const offline = engine.createOfflineChallan({ gradeLabel: 'M25', quantityM3: 6, slump: '100mm', receiverName: 'Offline Recv' });
  const push = await engine.pushPending();
  const cloudChallan = await api('GET', `/delivery-challans/${engine.localDocs('delivery_challan')[0].cloud_id}`, t);
  s.ok('offline challan synced to cloud with reserved no', push.applied === 1 && cloudChallan.challanNo === offline.challanNo);
  engine.close();

  // 12. Dashboards / reports
  const summary = await api('GET', '/dashboard/summary', t);
  const funnel = await api('GET', '/dashboard/operations-funnel', t);
  const catalog = await api('GET', '/reports/catalog', t);
  s.ok('dashboard summary + funnel + reports catalog populated', summary.orders.confirmed > 0 && funnel.invoicesIssued > 0 && catalog.groups.length >= 4);

  return s.done();
}
