/**
 * Unit tests for the fleet-compliance alert rule (Plan D1) — the date-window
 * logic behind vehicle FC/insurance/PUC/permit/road-tax + driver-licence
 * renewal warnings.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first
 * (the test turbo task depends on build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetComplianceAlerts } from '../../dist/alerts/fleet-compliance.util.js';

const TODAY = new Date('2026-08-12T10:00:00Z');
const doc = (expiry, asset = 'TN01AB1234', d = 'Insurance') => ({ asset, doc: d, expiry });

test('a clean fleet produces no alerts', () => {
  assert.deepEqual(fleetComplianceAlerts([], TODAY), []);
  // Well beyond the 30-day window.
  assert.deepEqual(fleetComplianceAlerts([doc('2026-12-31')], TODAY), []);
});

test('an already-expired document raises one danger alert', () => {
  const out = fleetComplianceAlerts([doc('2026-08-01')], TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'fleet_docs_expired');
  assert.equal(out[0].severity, 'danger');
  assert.equal(out[0].count, 1);
});

test('a document due within the window raises one warning alert', () => {
  const out = fleetComplianceAlerts([doc('2026-08-20')], TODAY); // 8 days out
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'fleet_docs_expiring');
  assert.equal(out[0].severity, 'warning');
});

test('a document expiring exactly today is expiring, not expired', () => {
  const out = fleetComplianceAlerts([doc('2026-08-12')], TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'warning');
});

test('the warning window is inclusive at its edge and excludes the day after', () => {
  assert.equal(fleetComplianceAlerts([doc('2026-09-11')], TODAY).length, 1); // +30 days → included
  assert.deepEqual(fleetComplianceAlerts([doc('2026-09-12')], TODAY), []); // +31 days → excluded
});

test('expired and expiring produce two alerts, danger first', () => {
  const out = fleetComplianceAlerts(
    [doc('2026-08-01', 'TN01AB1234', 'Insurance'), doc('2026-08-20', 'TN09XY7777', 'Fitness (FC)')],
    TODAY,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].severity, 'danger');
  assert.equal(out[1].severity, 'warning');
});

test('a custom warning window is honoured', () => {
  // 8 days out, but only warn within 7 → nothing.
  assert.deepEqual(fleetComplianceAlerts([doc('2026-08-20')], TODAY, 7), []);
});

test('unparseable dates are ignored, not crashed on', () => {
  assert.deepEqual(fleetComplianceAlerts([doc('not-a-date')], TODAY), []);
});
