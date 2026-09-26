/**
 * Unit tests for the pump-management helpers: which vehicles are pumps, the job
 * state machine, hours from stamps, the charge from the basis, and the
 * pump-charge reconciliation flags.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPumpVehicle, canPumpTransition, pumpHoursBetween, pumpCharge, reconcilePumpJobs,
} from '../../dist/pump/pump.util.js';

test('isPumpVehicle: any type naming a pump', () => {
  assert.equal(isPumpVehicle('concrete_pump'), true);
  assert.equal(isPumpVehicle('Boom Pump'), true);
  assert.equal(isPumpVehicle('transit_mixer'), false);
  assert.equal(isPumpVehicle(null), false);
});

test('state machine: planned → on_site → pumping → completed; cancel only before pumping', () => {
  assert.equal(canPumpTransition('planned', 'on_site'), true);
  assert.equal(canPumpTransition('planned', 'pumping'), true);
  assert.equal(canPumpTransition('on_site', 'pumping'), true);
  assert.equal(canPumpTransition('pumping', 'completed'), true);
  assert.equal(canPumpTransition('planned', 'cancelled'), true);
  assert.equal(canPumpTransition('pumping', 'cancelled'), false);
  assert.equal(canPumpTransition('completed', 'pumping'), false);
  assert.equal(canPumpTransition('planned', 'completed'), false);
  assert.equal(canPumpTransition('bogus', 'completed'), false);
});

test('pumpHoursBetween: 2 dp, null when missing or reversed', () => {
  assert.equal(pumpHoursBetween('2026-01-01T08:00:00Z', '2026-01-01T10:45:00Z'), 2.75);
  assert.equal(pumpHoursBetween('2026-01-01T08:00:00Z', '2026-01-01T08:10:00Z'), 0.17);
  assert.equal(pumpHoursBetween(null, '2026-01-01T10:45:00Z'), null);
  assert.equal(pumpHoursBetween('2026-01-01T10:45:00Z', '2026-01-01T08:00:00Z'), null);
});

test('pumpCharge follows the basis', () => {
  assert.equal(pumpCharge('per_m3', 250, 40, 3), 10000);
  assert.equal(pumpCharge('per_hour', 1500, 40, 2.5), 3750);
  assert.equal(pumpCharge('fixed', 8000, 40, 2.5), 8000);
  assert.equal(pumpCharge('included', 8000, 40, 2.5), 0);
  assert.equal(pumpCharge('per_m3', '250.5', '10.5', 0), 2630.25);
});

test('reconcilePumpJobs: clean order has no flags and totals add up', () => {
  const r = reconcilePumpJobs([{
    orderId: 'o1', orderNo: 'ORD-1', customerName: 'A', pumpRequired: true, pumpChargePerM3: 200, deliveredM3: 42,
    jobs: [{ status: 'completed', pumpedM3: 41, hours: 3.5, chargeAmount: 8200, chargeBasis: 'per_m3' }],
  }]);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].flags, []);
  assert.equal(r.rows[0].billedPumpCharge, 8400);
  assert.equal(r.totals.pumpedM3, 41);
  assert.equal(r.totals.flagged, 0);
});

test('reconcilePumpJobs: flags a required pump with no job, unbilled pumping, and a quantity gap', () => {
  const r = reconcilePumpJobs([
    { orderId: 'o1', orderNo: 'ORD-1', customerName: 'A', pumpRequired: true, pumpChargePerM3: 200, deliveredM3: 30, jobs: [] },
    { orderId: 'o2', orderNo: 'ORD-2', customerName: 'B', pumpRequired: false, pumpChargePerM3: 0, deliveredM3: 30,
      jobs: [{ status: 'completed', pumpedM3: 30, hours: 2, chargeAmount: 3000, chargeBasis: 'per_hour' }] },
    { orderId: 'o3', orderNo: 'ORD-3', customerName: 'C', pumpRequired: true, pumpChargePerM3: 200, deliveredM3: 40,
      jobs: [{ status: 'completed', pumpedM3: 20, hours: 2, chargeAmount: 4000, chargeBasis: 'per_m3' }, { status: 'cancelled', pumpedM3: 0, hours: 0, chargeAmount: 0, chargeBasis: 'per_m3' }] },
    // An order still being pumped is not judged on quantity yet.
    { orderId: 'o4', orderNo: 'ORD-4', customerName: 'D', pumpRequired: true, pumpChargePerM3: 200, deliveredM3: 40,
      jobs: [{ status: 'completed', pumpedM3: 20, hours: 2, chargeAmount: 4000, chargeBasis: 'per_m3' }, { status: 'pumping', pumpedM3: 0, hours: 0, chargeAmount: 0, chargeBasis: 'per_m3' }] },
  ]);
  const by = Object.fromEntries(r.rows.map((x) => [x.orderNo, x]));
  assert.match(by['ORD-1'].flags[0], /Pump required .* no pump job/);
  assert.match(by['ORD-2'].flags[0], /bills no pump charge/);
  assert.match(by['ORD-3'].flags[0], /20 m³ against 40 m³/);
  assert.equal(by['ORD-3'].jobs, 1, 'cancelled jobs are not counted');
  assert.deepEqual(by['ORD-4'].flags, []);
  assert.equal(by['ORD-4'].openJobs, 1);
  assert.equal(r.totals.flagged, 3);
  // A pump charge billed with no job is a gap even when nobody ticked "pump required".
  const billed = reconcilePumpJobs([{ orderId: 'o5', orderNo: 'ORD-5', customerName: 'E', pumpRequired: false, pumpChargePerM3: 150, deliveredM3: 10, jobs: [] }]);
  assert.match(billed.rows[0].flags[0], /pump charge is billed .* no pump job/);
});
