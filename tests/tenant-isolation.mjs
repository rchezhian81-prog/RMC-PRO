import { api, raw, login, suite } from './lib.mjs';

/**
 * Mandatory tenant-isolation suite (Design Doc 11 §21.2). This is the CI gate:
 * any failure here must block a release.
 * Case 5 (WebSocket) is adapted to the sync-pull channel — the realtime gateway
 * is a later sprint; the offline sync channel is the Phase-1 equivalent.
 */
export async function run() {
  const s = suite('Tenant Isolation (Doc 11 §21.2)');
  const alpha = await login('admin@alpha.test');
  const beta = await login('admin@beta.test');

  // Alpha reference records to probe from Beta.
  const aCustomer = (await api('GET', '/customers', { token: alpha }))[0];
  const aOrder = (await api('GET', '/orders?status=confirmed', { token: alpha }))[0];
  const aInvoices = await api('GET', '/invoices?status=issued', { token: alpha });
  const aInvoice = aInvoices[0];

  // 1) Tenant A user cannot access Tenant B customer.
  const bCustomers = await api('GET', '/customers', { token: beta });
  s.ok('1. Beta cannot see any Alpha customer in list', !bCustomers.some((c) => c.id === aCustomer?.id));
  const c1 = await raw('GET', `/customers/${aCustomer?.id}`, { token: beta });
  s.ok('1. Beta GET Alpha customer by id → 404', c1.status === 404, `status=${c1.status}`);

  // 2) Tenant A user cannot open Tenant B invoice file (PDF).
  const pdf = aInvoice ? await raw('GET', `/invoices/${aInvoice.id}/pdf`, { token: beta }) : { status: 404 };
  s.ok('2. Beta GET Alpha invoice PDF → 404', pdf.status === 404, `status=${pdf.status}`);

  // 3) Tenant A user cannot query Tenant B order by ID.
  const o3 = aOrder ? await raw('GET', `/orders/${aOrder.id}`, { token: beta }) : { status: 404 };
  s.ok('3. Beta GET Alpha order by id → 404', o3.status === 404, `status=${o3.status}`);

  // 4) Tenant A export does not contain Tenant B data (Tally CSV).
  const exp = await raw('GET', '/billing-reports/tally-export', { token: beta });
  const csv = await exp.res.text().catch(() => '');
  const leaked = aInvoices.filter((i) => csv.includes(i.invoiceNo));
  s.ok('4. Beta Tally export contains no Alpha invoices', leaked.length === 0, `leaked=${leaked.length}`);

  // 5) Sync channel isolation (WebSocket N/A in Phase 1): Beta bootstrap has no Alpha data.
  const bDevice = await api('POST', '/sync/devices/register', { token: beta, body: { deviceIdentifier: `ISO-BETA-${Date.now() % 100000}`, deviceName: 'Beta Iso Device' } });
  const boot = await api('GET', `/sync/bootstrap?deviceId=${bDevice.id}`, { token: beta });
  const bootCustomerIds = boot.reference.customers.map((c) => c.id);
  s.ok('5. Beta bootstrap contains no Alpha customer', !bootCustomerIds.includes(aCustomer?.id));

  // 6) Offline sync device from Tenant A cannot push Tenant B data (writes land in own tenant only).
  await api('POST', '/sync/number-reservations', { token: beta, body: { deviceId: bDevice.id, documentType: 'delivery_challan', count: 3 } });
  const betaChallanNo = `BETA-ISO-${Date.now() % 100000}`;
  const push = await api('POST', '/sync/push', { token: beta, body: { deviceId: bDevice.id, records: [
    { entityName: 'delivery_challan', localId: 'L1', operation: 'create', payload: { challanNo: betaChallanNo, gradeLabel: 'M25', quantityM3: 5 } },
  ] } });
  s.ok('6. Beta device push applied under Beta tenant', push.applied === 1);
  const alphaChallans = await api('GET', '/delivery-challans', { token: alpha });
  s.ok('6. Beta-pushed challan is NOT visible to Alpha (RLS)', !alphaChallans.some((c) => c.challanNo === betaChallanNo));

  return s.done();
}
