/**
 * Unit tests for the batching-controller log helpers (Plan A4): parsing the
 * controller batch report across format variants, the variance rule, matching
 * ingested actuals to ticket target lines, and the simulated log generator.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBatchLog,
  reconcileBatchLog,
  computeVariance,
  simulateBatchLog,
} from '../../dist/production/batching-log.util.js';

// ---- parseBatchLog ----
test('parses a CSV batch log with a header', () => {
  const rows = parseBatchLog('Material,Target,Actual\nCement,320.0,318.5\nWater,160,159');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { material: 'Cement', actual: 318.5, target: 320 });
  assert.equal(rows[1].material, 'Water');
  assert.equal(rows[1].actual, 159);
});

test('maps header columns by keyword regardless of order', () => {
  const rows = parseBatchLog('Ingredient;Actual_kg;Design\nFine Aggregate;715.2;710');
  assert.equal(rows[0].material, 'Fine Aggregate');
  assert.equal(rows[0].actual, 715.2);
  assert.equal(rows[0].target, 710);
});

test('parses positional material,target,actual with no header', () => {
  const rows = parseBatchLog('Cement,320,318.5\nWater,160,159');
  assert.equal(rows[0].actual, 318.5);
  assert.equal(rows[0].target, 320);
});

test('parses positional material,actual (two columns)', () => {
  const rows = parseBatchLog('Cement,318.5\nWater,159');
  assert.equal(rows[0].actual, 318.5);
  assert.equal(rows[0].target, undefined);
});

test('tolerates tab delimiter, unit suffixes and comment lines', () => {
  const rows = parseBatchLog('# batch 4471\nMaterial\tActual\nCement\t318.5 kg\nWater\t159 L');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actual, 318.5);
  assert.equal(rows[1].actual, 159);
});

test('skips rows with a non-numeric actual and empty input', () => {
  assert.equal(parseBatchLog('').length, 0);
  const rows = parseBatchLog('Material,Actual\nCement,--\nWater,159');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].material, 'Water');
});

// ---- computeVariance (mirrors the service rule) ----
test('computeVariance flags within/over tolerance', () => {
  assert.equal(computeVariance(100, 101, 2).withinTolerance, true); // +1% <= 2%
  assert.equal(computeVariance(100, 105, 2).withinTolerance, false); // +5% > 2%
  assert.equal(computeVariance(100, 98, 2).variancePercentage, -2);
  assert.equal(computeVariance(100, 103, 2).varianceQuantity, 3);
});

test('computeVariance handles a zero target', () => {
  assert.equal(computeVariance(0, 0, 2).variancePercentage, 0);
  assert.equal(computeVariance(0, 5, 2).variancePercentage, 100);
});

// ---- reconcileBatchLog ----
const ticket = [
  { id: 'm1', materialLabel: 'Cement', materialId: 'c', correctedTarget: 320, tolerance: 2, uom: 'kg' },
  { id: 'm2', materialLabel: 'Fine Aggregate', materialId: 'f', correctedTarget: 710, tolerance: 3, uom: 'kg' },
  { id: 'm3', materialLabel: 'Water', materialId: 'w', correctedTarget: 160, tolerance: 3, uom: 'ltr' },
];

test('reconciles matched lines to their corrected target', () => {
  const log = [
    { material: 'Cement', actual: 318.5 },
    { material: 'fine_aggregate', actual: 715.2 }, // loose-key match
    { material: 'Water', actual: 159 },
  ];
  const r = reconcileBatchLog(ticket, log);
  assert.equal(r.matchedCount, 3);
  assert.equal(r.varianceExceeded, false);
  assert.equal(r.lines[0].actual, 318.5);
  assert.equal(r.lines[0].matched, true);
  assert.equal(r.lines[1].matched, true); // matched despite underscore/case
});

test('a matched line out of tolerance sets varianceExceeded', () => {
  const log = [
    { material: 'Cement', actual: 340 }, // +6.25% > 2%
    { material: 'Water', actual: 159 },
  ];
  const r = reconcileBatchLog(ticket, log);
  assert.equal(r.varianceExceeded, true);
  assert.equal(r.lines[0].withinTolerance, false);
});

test('an unmatched ticket line stays untouched and never breaches', () => {
  const log = [{ material: 'Cement', actual: 318.5 }];
  const r = reconcileBatchLog(ticket, log);
  assert.equal(r.matchedCount, 1);
  assert.equal(r.lines[1].matched, false);
  assert.equal(r.lines[1].withinTolerance, true);
  assert.equal(r.varianceExceeded, false);
});

test('a controller line matching no ticket material is reported unmatched', () => {
  const log = [
    { material: 'Cement', actual: 318.5 },
    { material: 'Silica Fume', actual: 12 },
  ];
  const r = reconcileBatchLog(ticket, log);
  assert.equal(r.unmatchedLog.length, 1);
  assert.equal(r.unmatchedLog[0].material, 'Silica Fume');
});

// ---- simulateBatchLog → parse/reconcile round trip ----
test('simulated log reconciles within tolerance', () => {
  const log = simulateBatchLog(ticket);
  const r = reconcileBatchLog(ticket, log);
  assert.equal(r.matchedCount, 3);
  assert.equal(r.varianceExceeded, false);
});

test('simulated log with a forced breach exceeds tolerance', () => {
  const log = simulateBatchLog(ticket, { breachIndex: 0, breachPct: 10 });
  const r = reconcileBatchLog(ticket, log);
  assert.equal(r.varianceExceeded, true);
  assert.equal(r.lines[0].withinTolerance, false);
});

test('simulated log serialises back through the parser', () => {
  const log = simulateBatchLog(ticket);
  const text = ['Material,Target,Actual', ...log.map((l) => `${l.material},${l.target},${l.actual}`)].join('\n');
  const parsed = parseBatchLog(text);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].material, 'Cement');
  assert.equal(parsed[0].actual, log[0].actual);
});

console.log('batching-log unit tests defined');
