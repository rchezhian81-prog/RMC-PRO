/**
 * Unit tests for the pour-schedule roll-up (Plan B1).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarisePourSchedule } from '../../dist/orders/pour-schedule.util.js';

test('sums scheduled quantity and derives unscheduled / remaining', () => {
  const s = summarisePourSchedule(
    [{ quantityM3: 30 }, { quantityM3: 20 }],
    100, // ordered
    18, // delivered
  );
  assert.equal(s.scheduled, 50);
  assert.equal(s.ordered, 100);
  assert.equal(s.unscheduled, 50); // 100 - 50 still to slot
  assert.equal(s.remainingToDeliver, 32); // 50 scheduled - 18 delivered
});

test('cancelled slots are excluded from the scheduled total', () => {
  const s = summarisePourSchedule(
    [{ quantityM3: 30, status: 'planned' }, { quantityM3: 20, status: 'cancelled' }],
    100,
    0,
  );
  assert.equal(s.scheduled, 30);
});

test('a fully scheduled, fully delivered order nets to zero', () => {
  const s = summarisePourSchedule([{ quantityM3: 60 }, { quantityM3: 40 }], 100, 100);
  assert.equal(s.unscheduled, 0);
  assert.equal(s.remainingToDeliver, 0);
});

test('over-scheduling shows a negative unscheduled figure', () => {
  const s = summarisePourSchedule([{ quantityM3: 120 }], 100, 0);
  assert.equal(s.scheduled, 120);
  assert.equal(s.unscheduled, -20);
});

test('no slots → nothing scheduled, whole order unscheduled', () => {
  const s = summarisePourSchedule([], 75, 0);
  assert.equal(s.scheduled, 0);
  assert.equal(s.unscheduled, 75);
});
