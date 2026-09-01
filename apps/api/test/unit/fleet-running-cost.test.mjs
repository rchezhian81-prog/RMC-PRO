/**
 * Unit tests for the fleet running-cost maths (fleet/fleet-running-cost.util.ts).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFleetRunningCost } from '../../dist/fleet/fleet-running-cost.util.js';

test('merges maintenance + fuel by vehicle and derives cost/km + km/litre', () => {
  const { rows, totals } = buildFleetRunningCost(
    [
      { vehicleId: 'v1', vehicleNo: 'KA01', vehicleType: 'TM', maintenanceCost: '5000', jobs: '2' },
      { vehicleId: 'v2', vehicleNo: 'KA02', vehicleType: 'TM', maintenanceCost: '1000', jobs: '1' },
    ],
    [
      { vehicleId: 'v1', fuelCost: '10000', litres: '100', distanceKm: '500' },
      { vehicleId: 'v2', fuelCost: '4000', litres: '50', distanceKm: '400' },
    ],
  );

  const v1 = rows.find((r) => r.vehicleNo === 'KA01');
  assert.equal(v1.maintenanceCost, 5000);
  assert.equal(v1.fuelCost, 10000);
  assert.equal(v1.totalCost, 15000);
  assert.equal(v1.jobs, 2);
  assert.equal(v1.costPerKm, 30); // 15000 / 500
  assert.equal(v1.kmPerLitre, 5); // 500 / 100

  // v1 (15000) is costlier than v2 (5000), so it sorts first.
  assert.equal(rows[0].vehicleNo, 'KA01');

  assert.equal(totals.totalCost, 20000);
  assert.equal(totals.distanceKm, 900);
  assert.equal(totals.costPerKm, 22.22); // 20000 / 900
  assert.equal(totals.kmPerLitre, 6); // 900 / 150
});

test('a vehicle with maintenance but no fuel has no distance -> cost/km + km/litre null', () => {
  const { rows } = buildFleetRunningCost(
    [{ vehicleId: 'v3', vehicleNo: 'KA03', vehicleType: 'Pump', maintenanceCost: '8000', jobs: '1' }],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalCost, 8000);
  assert.equal(rows[0].distanceKm, 0);
  assert.equal(rows[0].costPerKm, null); // no distance to spread cost over
  assert.equal(rows[0].kmPerLitre, null); // no fuel logged
});

test('a vehicle with only fuel (no maintenance) still appears', () => {
  const { rows } = buildFleetRunningCost(
    [],
    [{ vehicleId: 'v4', vehicleNo: 'KA04', vehicleType: 'TM', fuelCost: '6000', litres: '60', distanceKm: '300' }],
  );
  assert.equal(rows[0].maintenanceCost, 0);
  assert.equal(rows[0].fuelCost, 6000);
  assert.equal(rows[0].totalCost, 6000);
  assert.equal(rows[0].costPerKm, 20); // 6000 / 300
});
