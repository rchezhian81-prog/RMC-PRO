/**
 * Unit tests for the returned / short-load concrete wastage helpers (Plan B3):
 * valuing a returned quantity and rolling deliveries up by reason and grade.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { returnCost, wastageSummary } from '../../dist/dispatch/wastage.util.js';

// ---- returnCost ----
test('returned concrete is valued at quantity × cost per m³', () => {
  assert.equal(returnCost(1.5, 4800), 7200);
});

test('returnCost coerces strings and rounds to paise', () => {
  assert.equal(returnCost('0.750', '4333.33'), 3250); // 0.75 * 4333.33 = 3249.9975 → 3250
});

test('a zero return costs nothing', () => {
  assert.equal(returnCost(0, 4800), 0);
});

// ---- wastageSummary ----
test('wastage summary totals returned m³ and value', () => {
  const s = wastageSummary([
    { returnQuantityM3: 1, returnCost: 4800, returnReason: 'excess_ordered', gradeLabel: 'M25' },
    { returnQuantityM3: 0.5, returnCost: 2400, returnReason: 'pump_breakdown', gradeLabel: 'M25' },
    { returnQuantityM3: 2, returnCost: 8000, returnReason: 'excess_ordered', gradeLabel: 'M30' },
  ]);
  assert.equal(s.entryCount, 3);
  assert.equal(s.totalReturnedM3, 3.5);
  assert.equal(s.totalReturnCost, 15200);
});

test('wastage summary rolls up by reason with shares of value', () => {
  const s = wastageSummary([
    { returnQuantityM3: 1, returnCost: 4800, returnReason: 'excess_ordered', gradeLabel: 'M25' },
    { returnQuantityM3: 2, returnCost: 8000, returnReason: 'excess_ordered', gradeLabel: 'M30' },
    { returnQuantityM3: 0.5, returnCost: 2400, returnReason: 'pump_breakdown', gradeLabel: 'M25' },
  ]);
  // sorted by cost desc → excess_ordered first (12800), pump_breakdown (2400)
  assert.equal(s.byReason[0].label, 'excess_ordered');
  assert.equal(s.byReason[0].quantityM3, 3);
  assert.equal(s.byReason[0].cost, 12800);
  assert.equal(s.byReason[0].share, 84.21); // 12800 / 15200
  assert.equal(s.byReason[1].label, 'pump_breakdown');
});

test('wastage summary rolls up by grade', () => {
  const s = wastageSummary([
    { returnQuantityM3: 1, returnCost: 4800, returnReason: 'x', gradeLabel: 'M25' },
    { returnQuantityM3: 0.5, returnCost: 2400, returnReason: 'y', gradeLabel: 'M25' },
    { returnQuantityM3: 2, returnCost: 8000, returnReason: 'z', gradeLabel: 'M30' },
  ]);
  const m25 = s.byGrade.find((b) => b.label === 'M25');
  assert.equal(m25.quantityM3, 1.5);
  assert.equal(m25.cost, 7200);
});

test('a missing reason or grade buckets as Unspecified', () => {
  const s = wastageSummary([{ returnQuantityM3: 1, returnCost: 4800 }]);
  assert.equal(s.byReason[0].label, 'Unspecified');
  assert.equal(s.byGrade[0].label, 'Unspecified');
});

test('an empty wastage report is zeroed', () => {
  const s = wastageSummary([]);
  assert.equal(s.totalReturnedM3, 0);
  assert.equal(s.totalReturnCost, 0);
  assert.equal(s.byReason.length, 0);
});
