/**
 * Unit tests for the tenant-usability policy. `trial` and `grace` MUST stay
 * usable (a late payment can't strand concrete in a mixer); only a deliberate
 * suspension/cancellation closes the door. This encodes that business rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTenantUsable, tenantBlockedMessage } from '../../dist/index.js';

test('active, trial and grace tenants may keep trading', () => {
  for (const s of ['active', 'trial', 'grace']) assert.equal(isTenantUsable(s), true, s);
});

test('suspended, cancelled, unknown and empty are blocked', () => {
  for (const s of ['suspended', 'cancelled', 'expired', '', null, undefined]) {
    assert.equal(isTenantUsable(s), false, String(s));
  }
});

test('blocked messages name the state and point at support', () => {
  assert.match(tenantBlockedMessage('suspended'), /suspended/i);
  assert.match(tenantBlockedMessage('cancelled'), /cancelled/i);
  assert.match(tenantBlockedMessage('whatever'), /not active/i);
});
