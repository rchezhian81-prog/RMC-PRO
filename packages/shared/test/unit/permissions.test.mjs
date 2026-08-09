/**
 * Unit tests for the RBAC permission catalogue and role defaults. These encode
 * the separation-of-duties invariants the product sells on: a sales executive
 * cannot approve its own pricing, QC alone approves mix designs, an auditor
 * never writes, and a Company Owner can never hold platform keys. A change that
 * broke any of these would be a silent authorization regression.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, TENANT_PERMISSIONS, ROLE_PERMISSION_DEFAULTS, ROLE_KEYS, isPlatformPermission } from '../../dist/index.js';

test('tenant permissions exclude every platform.* key', () => {
  assert.ok(TENANT_PERMISSIONS.length > 0);
  assert.equal(TENANT_PERMISSIONS.some((k) => k.startsWith('platform.')), false);
  assert.equal(isPlatformPermission('platform.tenants.view'), true);
  assert.equal(isPlatformPermission('orders.view'), false);
});

test('sales executive drafts but cannot approve pricing (SoD)', () => {
  const exec = ROLE_PERMISSION_DEFAULTS[ROLE_KEYS.SALES_EXECUTIVE];
  assert.ok(exec.includes(PERMISSIONS.QUOTATIONS_CREATE));
  assert.equal(exec.includes(PERMISSIONS.QUOTATIONS_APPROVE), false);
  assert.equal(exec.includes(PERMISSIONS.RATE_CONTRACTS_APPROVE), false);
});

test('sales manager owns pricing approval', () => {
  const mgr = ROLE_PERMISSION_DEFAULTS[ROLE_KEYS.SALES_MANAGER];
  assert.ok(mgr.includes(PERMISSIONS.QUOTATIONS_APPROVE));
  assert.ok(mgr.includes(PERMISSIONS.RATE_CONTRACTS_APPROVE));
});

test('mix-design approval belongs to QC alone; credit-hold to the plant manager', () => {
  assert.ok(ROLE_PERMISSION_DEFAULTS[ROLE_KEYS.QC_ENGINEER].includes(PERMISSIONS.MIX_DESIGN_APPROVE));
  assert.equal(ROLE_PERMISSION_DEFAULTS[ROLE_KEYS.SALES_MANAGER].includes(PERMISSIONS.MIX_DESIGN_APPROVE), false);
  assert.ok(ROLE_PERMISSION_DEFAULTS[ROLE_KEYS.PLANT_MANAGER].includes(PERMISSIONS.CREDIT_HOLD_APPROVE));
});

test('auditor is strictly read-only', () => {
  const auditor = ROLE_PERMISSION_DEFAULTS[ROLE_KEYS.AUDITOR];
  const writeish = [
    PERMISSIONS.INVOICES_CREATE, PERMISSIONS.RECEIPTS_CREATE, PERMISSIONS.ORDERS_CONFIRM,
    PERMISSIONS.BATCH_TICKETS_CREATE, PERMISSIONS.MIX_DESIGN_APPROVE, PERMISSIONS.STOCK_ADJUST,
  ];
  for (const p of writeish) assert.equal(auditor.includes(p), false, p);
  assert.ok(auditor.includes(PERMISSIONS.AUDIT_LOGS_VIEW));
});
