/**
 * Unit tests for the read-only insight agents' pure helpers (M1): numeric
 * coercion of Postgres aggregates, input clamping, and stock-severity. No I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, clampInt, stockSeverity } from '../../dist/agents/insights.util.js';

test('num coerces Postgres numeric strings and guards NaN/null', () => {
  assert.equal(num('12345.00'), 12345);
  assert.equal(num(0), 0);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num('not-a-number'), 0);
  assert.equal(num('-8'), -8);
});

test('clampInt bounds input and falls back to the default', () => {
  assert.equal(clampInt(30, 30, 1, 365), 30);
  assert.equal(clampInt(0, 30, 1, 365), 1);     // below min → min
  assert.equal(clampInt(999, 30, 1, 365), 365); // above max → max
  assert.equal(clampInt(undefined, 30, 1, 365), 30); // unusable → default
  assert.equal(clampInt('7', 30, 1, 365), 7);   // numeric string ok
  assert.equal(clampInt(5.9, 30, 1, 365), 5);   // truncated
});

test('stockSeverity is critical only when negative', () => {
  assert.equal(stockSeverity(-1), 'critical');
  assert.equal(stockSeverity(0), 'warn');
  assert.equal(stockSeverity(10), 'warn');
});
