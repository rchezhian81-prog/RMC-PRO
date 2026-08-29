/**
 * Unit tests for buildCycleTimes (Tier-C gap C2).
 *
 * Turns a completed dispatch's four board timestamps into travel / wait / pour /
 * turnaround minutes, and averages each over the rows where it's present.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCycleTimes } from '../../dist/dispatch/dispatch-cycle.util.js';

const T = (h, m) => `2026-01-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

test('computes travel / wait / pour / turnaround in whole minutes', () => {
  const r = buildCycleTimes([
    { dispatchNo: 'D1', gradeLabel: 'M25', dispatchTime: T(9, 0), siteArrivalTime: T(9, 30), pourStartTime: T(9, 45), pourEndTime: T(10, 15) },
  ]).rows[0];
  assert.deepEqual([r.travelMin, r.waitMin, r.pourMin, r.turnaroundMin], [30, 15, 30, 75]);
});

test('missing stamps yield null for the affected durations', () => {
  const r = buildCycleTimes([
    { dispatchNo: 'D2', dispatchTime: T(9, 0), siteArrivalTime: null, pourStartTime: null, pourEndTime: T(10, 0) },
  ]).rows[0];
  assert.equal(r.travelMin, null);
  assert.equal(r.waitMin, null);
  assert.equal(r.pourMin, null);
  assert.equal(r.turnaroundMin, 60); // left → pour-end still computable
});

test('averages each duration over the rows where it is present', () => {
  const rep = buildCycleTimes([
    { dispatchNo: 'A', dispatchTime: T(9, 0), siteArrivalTime: T(9, 20), pourStartTime: T(9, 30), pourEndTime: T(10, 0) },
    { dispatchNo: 'B', dispatchTime: T(9, 0), siteArrivalTime: T(9, 40), pourStartTime: null, pourEndTime: null },
  ]);
  assert.equal(rep.count, 2);
  assert.equal(rep.averages.travelMin, 30); // (20 + 40) / 2
  assert.equal(rep.averages.pourMin, 30); // only A has it
});

test('a negative interval (bad data) is treated as null, not negative', () => {
  const r = buildCycleTimes([
    { dispatchNo: 'D3', dispatchTime: T(10, 0), siteArrivalTime: T(9, 0) },
  ]).rows[0];
  assert.equal(r.travelMin, null);
});
