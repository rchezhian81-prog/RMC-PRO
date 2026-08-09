/**
 * Unit tests for the module catalogue. Guards the phase-1 module set the product
 * depends on end-to-end: the demo seed provisions these for a tenant and the UAT
 * drives production + offline sync through them, so a change that dropped one
 * from phase-1 would silently break onboarding. Also locks the key/list
 * invariants the API and web both rely on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_CATALOG, MODULE_KEYS } from '../../dist/index.js';

test('MODULE_KEYS are unique and mirror the catalogue order', () => {
  assert.equal(new Set(MODULE_KEYS).size, MODULE_KEYS.length);
  assert.deepEqual(MODULE_KEYS, MODULE_CATALOG.map((m) => m.key));
});

test('every module has a key, a name, and a phase in 1..5', () => {
  for (const m of MODULE_CATALOG) {
    assert.ok(m.key && m.name, `module missing key/name: ${JSON.stringify(m)}`);
    assert.ok(Number.isInteger(m.phase) && m.phase >= 1 && m.phase <= 5, `bad phase for ${m.key}`);
  }
});

test('phase-1 includes the full order-to-cash + offline set the app relies on', () => {
  const phase1 = new Set(MODULE_CATALOG.filter((m) => m.phase === 1).map((m) => m.key));
  for (const k of [
    'masters', 'sales', 'orders', 'production', 'dispatch', 'inventory',
    'weighbridge', 'billing', 'reports', 'offline_sync',
  ]) {
    assert.ok(phase1.has(k), `phase-1 must include "${k}"`);
  }
});
