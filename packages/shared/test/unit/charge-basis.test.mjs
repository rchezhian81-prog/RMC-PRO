import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateLineValue, estimateLineParts, perM3Rate, billableWaitingHours, tripsFor,
  chargeBasisLabel, chargeBasisUom, isTransportBasis, isPumpBasis, isWaitingBasis,
  truckM3Setting, waitingFreeMinutesSetting, validateSettingValue,
} from '../../dist/index.js';

test('every charge per m³ values the line as qty × all-in', () => {
  assert.equal(estimateLineValue({ qty: 10, rate: 4500, transport: 200, pump: 300, waiting: 50 }), 50500);
  assert.equal(estimateLineParts({ qty: 10, rate: 4500, transport: 200 }).allPerM3, true);
});

test('per trip counts the trips the quantity takes at the truck load, lump sum and per job count once, per hour counts nothing', () => {
  const parts = estimateLineParts({ qty: 14, rate: 4000, transport: 1500, transportBasis: 'per_trip', pump: 3500, pumpBasis: 'per_job', waiting: 400, waitingBasis: 'per_hour', truckM3: 6 });
  assert.equal(parts.trips, 3);
  assert.equal(parts.transport, 4500);
  assert.equal(parts.pump, 3500);
  assert.equal(parts.waiting, 0);
  assert.equal(parts.allPerM3, false);
  assert.equal(parts.total, 56000 + 4500 + 3500);
  assert.equal(estimateLineValue({ qty: 14, rate: 4000, transport: 9000, transportBasis: 'lump_sum' }), 65000);
  assert.equal(estimateLineValue({ qty: 0, rate: 4000, transport: 1500, transportBasis: 'per_trip' }), 0);
});

test('trips: the default truck load applies when none is set; a fraction of a load is still a trip', () => {
  assert.equal(tripsFor(12, undefined), 2);
  assert.equal(tripsFor(12.1, 6), 3);
  assert.equal(tripsFor(1, 6), 1);
  assert.equal(tripsFor(0, 6), 0);
  assert.equal(truckM3Setting(''), 6);
  assert.equal(truckM3Setting('8'), 8);
  assert.equal(truckM3Setting('-1'), 6);
});

test('the per-m³ rate folds in only the charges that are per m³', () => {
  assert.equal(perM3Rate({ rate: 4000, transport: 200, pump: 300, waiting: 50 }), 4550);
  assert.equal(perM3Rate({ rate: 4000, transport: 1500, transportBasis: 'per_trip', pump: 300, waiting: 400, waitingBasis: 'per_hour' }), 4300);
});

test('waiting hours: minutes beyond the free period, rounded up to the quarter hour', () => {
  const t0 = '2026-03-01T08:00:00Z';
  const at = (min) => new Date(Date.parse(t0) + min * 60_000).toISOString();
  assert.equal(billableWaitingHours(t0, at(95), 60), 0.75);
  assert.equal(billableWaitingHours(t0, at(60), 60), 0);
  assert.equal(billableWaitingHours(t0, at(61), 60), 0.25);
  assert.equal(billableWaitingHours(t0, at(135), 60), 1.25);
  assert.equal(billableWaitingHours(t0, at(95), 0), 1.75);
  assert.equal(billableWaitingHours(t0, at(95), ''), 0.75);
  assert.equal(billableWaitingHours(null, at(95), 60), 0);
  assert.equal(billableWaitingHours(at(95), t0, 60), 0);
  assert.equal(waitingFreeMinutesSetting('30'), 30);
  assert.equal(waitingFreeMinutesSetting('x'), 60);
});

test('labels, units and the basis guards', () => {
  assert.equal(chargeBasisLabel('per_m3'), 'per m³');
  assert.equal(chargeBasisLabel('per_trip'), 'per trip');
  assert.equal(chargeBasisLabel('lump_sum'), 'lump sum');
  assert.equal(chargeBasisLabel('per_job'), 'per job');
  assert.equal(chargeBasisLabel('per_hour'), 'per hour');
  assert.equal(chargeBasisUom('per_trip'), 'trip');
  assert.equal(chargeBasisUom('lump_sum'), 'lot');
  assert.equal(chargeBasisUom('per_hour'), 'hour');
  assert.ok(isTransportBasis('per_trip') && !isTransportBasis('per_job'));
  assert.ok(isPumpBasis('per_hour') && !isPumpBasis('per_trip'));
  assert.ok(isWaitingBasis('per_hour') && !isWaitingBasis('per_job'));
});

test('the billing settings are in the catalogue with their bounds', () => {
  assert.equal(validateSettingValue('billing.default_truck_m3', '6'), null);
  assert.ok(validateSettingValue('billing.default_truck_m3', '0'));
  assert.ok(validateSettingValue('billing.default_truck_m3', '13'));
  assert.equal(validateSettingValue('billing.waiting_free_minutes', '0'), null);
  assert.ok(validateSettingValue('billing.waiting_free_minutes', '241'));
  assert.ok(validateSettingValue('billing.waiting_free_minutes', '1.5'));
});
