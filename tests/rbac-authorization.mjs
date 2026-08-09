import { raw, login, makeScopedUser, suite } from './lib.mjs';

/**
 * RBAC / authorization matrix (Design Addendum RBAC). Verifies route permission
 * guards deny without the permission and allow with it — per-permission, not
 * all-or-nothing. Guards run before handlers, so bogus ids still return 403.
 */
const GUARDED = [
  ['orders.confirm', 'POST', '/orders/00000000-0000-0000-0000-000000000000/confirm'],
  ['credit_hold.approve', 'POST', '/credit-holds/00000000-0000-0000-0000-000000000000/approve'],
  ['mix_design.approve', 'POST', '/mix-designs/00000000-0000-0000-0000-000000000000/approve'],
  ['batch_tickets.create', 'POST', '/batch-tickets/from-queue/00000000-0000-0000-0000-000000000000'],
  ['dispatch.update_status', 'POST', '/dispatches/from-batch-ticket/00000000-0000-0000-0000-000000000000'],
  ['delivery_challans.create', 'POST', '/delivery-challans/00000000-0000-0000-0000-000000000000/issue'],
  ['stock.adjust', 'POST', '/stock-adjustments'],
  ['negative_stock.approve', 'POST', '/negative-stock-requests/00000000-0000-0000-0000-000000000000/approve'],
  ['invoices.create', 'POST', '/invoices/from-challans'],
  ['invoice_cancellation.approve', 'POST', '/invoices/00000000-0000-0000-0000-000000000000/cancel'],
  ['receipts.create', 'POST', '/receipts'],
  ['tally_export.generate', 'GET', '/billing-reports/tally-export'],
  ['sync.manage', 'POST', '/sync/devices/register'],
];

export async function run() {
  const s = suite('RBAC / Authorization matrix');
  const admin = await login('admin@alpha.test');
  const stamp = Date.now() % 100000;

  // A view-only user: has orders.view, nothing else.
  const viewer = await makeScopedUser(admin, { roleKey: `t_view_${stamp}`, roleName: 'View Only', permissions: ['orders.view'], email: `viewonly${stamp}@alpha.test` });

  let denied = 0;
  for (const [perm, method, path] of GUARDED) {
    const r = await raw(method, path, { token: viewer, body: {} });
    const is403 = r.status === 403;
    if (is403) denied++;
    else s.ok(`view-only denied ${perm}`, is403, `got ${r.status}`);
  }
  s.ok(`view-only user gets 403 on all ${GUARDED.length} guarded endpoints`, denied === GUARDED.length, `${denied}/${GUARDED.length}`);
  s.ok('view-only user CAN read orders (orders.view)', (await raw('GET', '/orders', { token: viewer })).status === 200);

  // A per-permission user: only tally_export.generate → export allowed, receipts denied.
  const exporter = await makeScopedUser(admin, { roleKey: `t_exp_${stamp}`, roleName: 'Exporter', permissions: ['tally_export.generate', 'orders.view'], email: `exporter${stamp}@alpha.test` });
  s.ok('exporter allowed tally export (has permission)', (await raw('GET', '/billing-reports/tally-export', { token: exporter })).status === 200);
  s.ok('exporter denied receipts (lacks permission)', (await raw('POST', '/receipts', { token: exporter, body: {} })).status === 403);

  // Admin (full perms) is allowed on the export.
  s.ok('admin allowed tally export', (await raw('GET', '/billing-reports/tally-export', { token: admin })).status === 200);

  // Unauthenticated request is rejected.
  s.ok('unauthenticated → 401', (await raw('GET', '/orders', {})).status === 401);

  return s.done();
}
