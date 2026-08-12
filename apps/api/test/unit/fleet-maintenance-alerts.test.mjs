/**
 * Unit tests for the Fleet maintenance-due alert formatting (Plan D3) — the pure
 * grouping of active service schedules into overdue (danger) and due-soon
 * (warning) dashboard alerts.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetMaintenanceAlerts } from '../../dist/alerts/fleet-maintenance.util.js';

const TODAY = new Date('2026-08-12T00:00:00Z');

test('a clean fleet produces no maintenance alerts', () => {
  const alerts = fleetMaintenanceAlerts(
    [{ vehicle: 'TN01AB1234', serviceType: 'engine_oil', nextDueDate: '2027-01-01', nextDueOdometer: 90000, currentOdometer: 50000 }],
    TODAY,
  );
  assert.equal(alerts.length, 0);
});

test('an overdue service raises a single danger alert', () => {
  const alerts = fleetMaintenanceAlerts(
    [{ vehicle: 'TN01AB1234', serviceType: 'engine_oil', nextDueDate: '2026-08-01', currentOdometer: null }],
    TODAY,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'danger');
  assert.equal(alerts[0].key, 'fleet_service_overdue');
  assert.equal(alerts[0].count, 1);
  assert.match(alerts[0].detail, /TN01AB1234 — engine_oil/);
});

test('a due-soon service raises a warning alert', () => {
  const alerts = fleetMaintenanceAlerts(
    [{ vehicle: 'TN01AB1234', serviceType: 'general', nextDueDate: '2026-08-20', currentOdometer: null }],
    TODAY,
    14,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'warning');
  assert.equal(alerts[0].key, 'fleet_service_due_soon');
});

test('overdue and due-soon are split across two alerts with correct counts', () => {
  const alerts = fleetMaintenanceAlerts(
    [
      { vehicle: 'V1', serviceType: 'engine_oil', nextDueDate: '2026-07-01', currentOdometer: null }, // overdue
      { vehicle: 'V2', serviceType: 'tyre', nextDueOdometer: 60000, currentOdometer: 60500 },          // overdue by km
      { vehicle: 'V3', serviceType: 'general', nextDueDate: '2026-08-22', currentOdometer: null },     // due soon
    ],
    TODAY,
  );
  const danger = alerts.find((a) => a.severity === 'danger');
  const warning = alerts.find((a) => a.severity === 'warning');
  assert.equal(danger.count, 2);
  assert.equal(warning.count, 1);
});

test('the detail truncates a long overdue list with an ellipsis', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    vehicle: `V${i}`, serviceType: 'engine_oil', nextDueDate: '2026-01-01', currentOdometer: null,
  }));
  const alerts = fleetMaintenanceAlerts(rows, TODAY);
  assert.equal(alerts[0].count, 6);
  assert.match(alerts[0].detail, /…/);
});
