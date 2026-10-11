/**
 * A basis for each charge — the maths the API and the browser share.
 *
 *   - estimateLineValue: per-m³ charges multiply by the quantity, a per-trip
 *     transport charge by the trips the quantity takes at the truck load, a
 *     lump sum and a per-job pump count once, a per-hour charge counts
 *     nothing in an estimate;
 *   - summariseGst taxes that estimate, so the quotation's tax preview, the
 *     order value and the invoice all reconcile;
 *   - billableWaitingHours rounds the time beyond the free period UP to the
 *     next quarter hour;
 *   - pickChargeBases refuses a basis outside the allowed set and leaves a
 *     blank one to the per-m³ default;
 *   - reconcilePumpJobs reads "billed pump charge" from the invoice lines
 *     when the order bills pumping per job or per hour.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLineValue, estimateLineParts, billableWaitingHours, perM3Rate } from '@rmc/shared';
import { summariseGst } from '../../dist/billing/tax.util.js';
import { pickChargeBases, lineEstimateInput } from '../../dist/billing/charge-basis.util.js';
import { reconcilePumpJobs } from '../../dist/pump/pump.util.js';

test('estimateLineValue: the default is qty × (rate + transport + pump + waiting)', () => {
  assert.equal(estimateLineValue({ qty: 12, rate: 4500, transport: 150, pump: 250, waiting: 40 }), 12 * 4940);
});

test('estimateLineValue: per trip counts trips at the truck load, per job once, per hour nothing', () => {
  const v = estimateLineValue({
    qty: 14, rate: 4000, transport: 1500, transportBasis: 'per_trip',
    pump: 3500, pumpBasis: 'per_job', waiting: 400, waitingBasis: 'per_hour', truckM3: 6,
  });
  // 14 m³ at 6 m³ a truck = 3 trips.
  assert.equal(v, 14 * 4000 + 3 * 1500 + 3500);
  const parts = estimateLineParts({ qty: 14, rate: 4000, transport: 1500, transportBasis: 'per_trip', truckM3: 7 });
  assert.equal(parts.trips, 2);
  assert.equal(parts.transport, 3000);
  assert.equal(parts.allPerM3, false);
});

test('estimateLineValue: a lump sum counts once whatever the quantity', () => {
  assert.equal(estimateLineValue({ qty: 3, rate: 4000, transport: 9000, transportBasis: 'lump_sum' }), 12000 + 9000);
  assert.equal(estimateLineValue({ qty: 30, rate: 4000, transport: 9000, transportBasis: 'lump_sum' }), 120000 + 9000);
});

test('lineEstimateInput reads an entity line (string numerics) into the shared estimate', () => {
  const line = { ratePerM3: '4000.00', transportCharge: '1500.00', pumpCharge: '0.00', waitingCharge: '0.00', transportBasis: 'per_trip', pumpBasis: 'per_m3', waitingBasis: 'per_m3' };
  assert.equal(estimateLineValue(lineEstimateInput(line, '14.000', 6)), 56000 + 4500);
});

test('summariseGst taxes the basis estimate, not qty × all-in', () => {
  const s = summariseGst([{
    quantity: 14, rate: 4000, transport: 1500, transportBasis: 'per_trip', pump: 3500, pumpBasis: 'per_job',
    waiting: 400, waitingBasis: 'per_hour', truckM3: 6, gstRate: 18,
  }], false);
  assert.equal(s.taxable, 64000);
  assert.equal(s.cgst, 5760);
  assert.equal(s.sgst, 5760);
  assert.equal(s.total, 75520);
  // Without bases the old reading holds.
  const old = summariseGst([{ quantity: 10, rate: 4000, transport: 100, pump: 50, waiting: 0, gstRate: 18 }], true);
  assert.equal(old.taxable, 41500);
  assert.equal(old.igst, 7470);
});

test('perM3Rate folds in only the per-m³ charges (the concrete-only invoice rate)', () => {
  assert.equal(perM3Rate({ rate: 4000, transport: 1500, transportBasis: 'per_trip', pump: 3500, pumpBasis: 'per_job', waiting: 50 }), 4050);
});

test('waiting hours: 95 minutes on site with 60 free is 0.75 h; rounding is always up to the quarter', () => {
  const arrive = new Date('2026-04-01T09:00:00Z');
  const at = (min) => new Date(arrive.getTime() + min * 60_000);
  assert.equal(billableWaitingHours(arrive, at(95), 60), 0.75);
  assert.equal(billableWaitingHours(arrive, at(96), 60), 0.75);
  assert.equal(billableWaitingHours(arrive, at(106), 60), 1);
  assert.equal(billableWaitingHours(arrive, at(45), 60), 0);
  assert.equal(billableWaitingHours(arrive, null, 60), 0);
  assert.equal(billableWaitingHours(arrive, at(30), 0), 0.5);
});

test('pickChargeBases: blank means per m³, a known value passes, anything else is refused by name', () => {
  assert.deepEqual(pickChargeBases({}), {});
  assert.deepEqual(pickChargeBases({ transportBasis: '', pumpBasis: null }), { transportBasis: 'per_m3', pumpBasis: 'per_m3' });
  assert.deepEqual(pickChargeBases({ transportBasis: 'per_trip', pumpBasis: 'per_hour', waitingBasis: 'per_hour' }), { transportBasis: 'per_trip', pumpBasis: 'per_hour', waitingBasis: 'per_hour' });
  assert.throws(() => pickChargeBases({ transportBasis: 'per_job' }), /transportBasis must be one of/);
  assert.throws(() => pickChargeBases({ pumpBasis: 'per_trip' }), /pumpBasis must be one of/);
  assert.throws(() => pickChargeBases({ waitingBasis: 'lump_sum' }), /waitingBasis must be one of/);
});

test('reconcilePumpJobs: billed pump charge comes from the invoice lines under a per-job or per-hour basis', () => {
  const job = { status: 'completed', pumpedM3: 10, hours: 2, chargeAmount: 3500, chargeBasis: 'fixed' };
  const perM3 = reconcilePumpJobs([{ orderId: 'a', orderNo: 'ORD-1', customerName: null, pumpRequired: true, pumpChargePerM3: 300, deliveredM3: 10, jobs: [job] }]);
  assert.equal(perM3.rows[0].billedPumpCharge, 3000);
  assert.equal(perM3.rows[0].pumpBasis, 'per_m3');
  const perJob = reconcilePumpJobs([{ orderId: 'b', orderNo: 'ORD-2', customerName: null, pumpRequired: true, pumpChargePerM3: 3500, pumpBasis: 'per_job', invoicedPumpCharge: 3500, deliveredM3: 10, jobs: [job] }]);
  assert.equal(perJob.rows[0].billedPumpCharge, 3500);
  assert.equal(perJob.rows[0].pumpBasis, 'per_job');
  const perHour = reconcilePumpJobs([{ orderId: 'c', orderNo: 'ORD-3', customerName: null, pumpRequired: true, pumpChargePerM3: 1500, pumpBasis: 'per_hour', invoicedPumpCharge: 0, deliveredM3: 10, jobs: [job] }]);
  assert.equal(perHour.rows[0].billedPumpCharge, 0);
});
