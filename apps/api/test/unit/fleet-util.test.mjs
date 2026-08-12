/**
 * Unit tests for the Fleet maintenance & fuel-log helpers (Plan D3): next-due
 * computation, service due-state classification, per-fill fuel efficiency, and
 * the tank-to-tank fuel roll-up.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextDue,
  serviceDueState,
  fuelEfficiency,
  summariseFuel,
} from '../../dist/fleet/fleet.util.js';

// ---- computeNextDue ----
test('next-due rolls both odometer and date forward by the interval', () => {
  const r = computeNextDue({ baseOdometer: 50000, baseDate: '2026-01-01', intervalKm: 10000, intervalDays: 90 });
  assert.equal(r.nextDueOdometer, 60000);
  assert.equal(r.nextDueDate, '2026-04-01'); // Jan(31)+Feb(28)+Mar(31) = 90 days
});

test('km-only interval yields only an odometer next-due', () => {
  const r = computeNextDue({ baseOdometer: 12000, intervalKm: 5000, baseDate: null, intervalDays: null });
  assert.equal(r.nextDueOdometer, 17000);
  assert.equal(r.nextDueDate, null);
});

test('date-only interval yields only a date next-due', () => {
  const r = computeNextDue({ baseDate: '2026-06-01', intervalDays: 30, baseOdometer: null, intervalKm: null });
  assert.equal(r.nextDueOdometer, null);
  assert.equal(r.nextDueDate, '2026-07-01');
});

test('no anchor / no interval yields nulls', () => {
  assert.deepEqual(computeNextDue({}), { nextDueOdometer: null, nextDueDate: null });
  // interval without a base cannot be projected
  assert.deepEqual(
    computeNextDue({ intervalKm: 5000, intervalDays: 30 }),
    { nextDueOdometer: null, nextDueDate: null },
  );
});

test('a zero or negative interval is ignored', () => {
  const r = computeNextDue({ baseOdometer: 100, intervalKm: 0, baseDate: '2026-01-01', intervalDays: -5 });
  assert.equal(r.nextDueOdometer, null);
  assert.equal(r.nextDueDate, null);
});

// ---- serviceDueState ----
test('a service comfortably ahead on both axes is ok', () => {
  const s = serviceDueState({
    nextDueOdometer: 60000, currentOdometer: 52000, nextDueDate: '2026-12-01', today: '2026-08-12',
  });
  assert.equal(s.status, 'ok');
  assert.equal(s.kmRemaining, 8000);
  assert.equal(s.overdueByKm, false);
  assert.equal(s.overdueByDate, false);
});

test('within the km warning window is due_soon', () => {
  const s = serviceDueState({
    nextDueOdometer: 60000, currentOdometer: 59700, nextDueDate: '2027-01-01', today: '2026-08-12', warnKm: 500,
  });
  assert.equal(s.status, 'due_soon');
  assert.equal(s.kmRemaining, 300);
});

test('within the date warning window is due_soon', () => {
  const s = serviceDueState({
    nextDueDate: '2026-08-20', today: '2026-08-12', warnDays: 14, nextDueOdometer: null, currentOdometer: null,
  });
  assert.equal(s.status, 'due_soon');
  assert.equal(s.daysRemaining, 8);
});

test('past the due date is overdue', () => {
  const s = serviceDueState({
    nextDueDate: '2026-08-01', today: '2026-08-12', nextDueOdometer: null, currentOdometer: null,
  });
  assert.equal(s.status, 'overdue');
  assert.equal(s.overdueByDate, true);
  assert.equal(s.daysRemaining, -11);
});

test('odometer reached the due reading is overdue even if the date is far off', () => {
  const s = serviceDueState({
    nextDueOdometer: 60000, currentOdometer: 60250, nextDueDate: '2027-06-01', today: '2026-08-12',
  });
  assert.equal(s.status, 'overdue');
  assert.equal(s.overdueByKm, true);
  assert.equal(s.kmRemaining, -250);
});

test('a schedule with nothing to measure against is ok', () => {
  const s = serviceDueState({ today: '2026-08-12', nextDueOdometer: null, currentOdometer: null, nextDueDate: null });
  assert.equal(s.status, 'ok');
  assert.equal(s.kmRemaining, null);
  assert.equal(s.daysRemaining, null);
});

// ---- fuelEfficiency ----
test('km/litre computed from the previous full-tank reading', () => {
  const r = fuelEfficiency({ prevOdometer: 50000, currOdometer: 50400, litres: 100 });
  assert.deepEqual(r, { distanceKm: 400, kmPerLitre: 4 });
});

test('first fill (no previous reading) yields no mileage', () => {
  assert.equal(fuelEfficiency({ prevOdometer: null, currOdometer: 50000, litres: 80 }), null);
});

test('non-advancing odometer or zero litres yields no mileage', () => {
  assert.equal(fuelEfficiency({ prevOdometer: 50000, currOdometer: 50000, litres: 80 }), null);
  assert.equal(fuelEfficiency({ prevOdometer: 50000, currOdometer: 49000, litres: 80 }), null);
  assert.equal(fuelEfficiency({ prevOdometer: 50000, currOdometer: 50400, litres: 0 }), null);
});

// ---- summariseFuel ----
test('fuel summary excludes the baseline fill from the average', () => {
  const s = summariseFuel([
    { quantityLitres: 100, amount: 9000, distanceKm: null }, // baseline
    { quantityLitres: 100, amount: 9000, distanceKm: 400 },
    { quantityLitres: 120, amount: 10800, distanceKm: 480 },
  ]);
  assert.equal(s.entryCount, 3);
  assert.equal(s.totalLitres, 320);
  assert.equal(s.totalAmount, 28800);
  assert.equal(s.totalDistanceKm, 880);
  // 880 km / (100 + 120 litres over measured intervals) = 4 km/l
  assert.equal(s.avgKmPerLitre, 4);
  // (9000 + 10800) / 880 km = 22.5 ₹/km
  assert.equal(s.avgCostPerKm, 22.5);
});

test('fuel summary with no measured interval reports null averages', () => {
  const s = summariseFuel([{ quantityLitres: 90, amount: 8100, distanceKm: null }]);
  assert.equal(s.totalLitres, 90);
  assert.equal(s.totalDistanceKm, 0);
  assert.equal(s.avgKmPerLitre, null);
  assert.equal(s.avgCostPerKm, null);
});

test('empty fuel log summarises to zeros and null averages', () => {
  const s = summariseFuel([]);
  assert.equal(s.entryCount, 0);
  assert.equal(s.totalLitres, 0);
  assert.equal(s.avgKmPerLitre, null);
});
