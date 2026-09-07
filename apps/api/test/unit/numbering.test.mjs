/**
 * Unit tests for the document-numbering helpers (Plan F2): the Indian financial
 * year, number formatting, and the yearly-reset roll-over decision.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  financialYearOf,
  formatSeriesNumber,
  applyYearlyReset,
  fyToken,
  rolloverSuffix,
} from '../../dist/sales/numbering.util.js';

// ---- financialYearOf ----
test('a date in mid-year falls in that April-starting FY', () => {
  assert.equal(financialYearOf('2026-08-12'), '2026-27');
});

test('April 1 starts a new financial year', () => {
  assert.equal(financialYearOf('2026-04-01'), '2026-27');
});

test('March 31 is still the previous financial year', () => {
  assert.equal(financialYearOf('2026-03-31'), '2025-26');
});

test('January falls in the FY that started the previous April', () => {
  assert.equal(financialYearOf('2027-01-15'), '2026-27');
});

// ---- formatSeriesNumber ----
test('formats prefix + zero-padded number + suffix', () => {
  assert.equal(formatSeriesNumber({ prefix: 'INV-', suffix: null, number: 7, paddingLength: 4 }), 'INV-0007');
});

test('a suffix is appended and padding defaults to 4', () => {
  assert.equal(formatSeriesNumber({ prefix: 'DC/', suffix: '/26-27', number: 42 }), 'DC/0042/26-27');
});

test('a number wider than the padding is not truncated', () => {
  assert.equal(formatSeriesNumber({ prefix: 'X', number: 12345, paddingLength: 4 }), 'X12345');
});

// ---- applyYearlyReset ----
test('same FY carries the counter on', () => {
  const r = applyYearlyReset({ resetFrequency: 'yearly', seriesFy: '2026-27', currentFy: '2026-27', currentNumber: 40 });
  assert.equal(r.didReset, false);
  assert.equal(r.currentNumber, 40);
  assert.equal(r.financialYear, '2026-27');
});

test('a new FY rolls the series over and restarts at 0', () => {
  const r = applyYearlyReset({ resetFrequency: 'yearly', seriesFy: '2025-26', currentFy: '2026-27', currentNumber: 512 });
  assert.equal(r.didReset, true);
  assert.equal(r.currentNumber, 0);
  assert.equal(r.financialYear, '2026-27');
});

test('a series with no FY yet adopts the current FY without resetting the counter', () => {
  const r = applyYearlyReset({ resetFrequency: 'yearly', seriesFy: null, currentFy: '2026-27', currentNumber: 15 });
  assert.equal(r.didReset, false);
  assert.equal(r.currentNumber, 15);
  assert.equal(r.financialYear, '2026-27');
});

test('a never-reset series ignores the FY change', () => {
  const r = applyYearlyReset({ resetFrequency: 'never', seriesFy: '2025-26', currentFy: '2026-27', currentNumber: 900 });
  assert.equal(r.didReset, false);
  assert.equal(r.currentNumber, 900);
  assert.equal(r.financialYear, '2025-26');
});

test('reset frequency defaults to yearly when unset', () => {
  const r = applyYearlyReset({ seriesFy: '2025-26', currentFy: '2026-27', currentNumber: 5 });
  assert.equal(r.didReset, true);
  assert.equal(r.currentNumber, 0);
});

// ── FY token + roll-over suffix (data-integrity item I6) ──────────────────────

test('fyToken renders a financial year as /YY-YY', () => {
  assert.equal(fyToken('2026-27'), '/26-27');
  assert.equal(fyToken('2027-28'), '/27-28');
  assert.equal(fyToken('2099-00'), '/99-00');
});

test('fyToken is empty for a missing or malformed FY', () => {
  assert.equal(fyToken(null), '');
  assert.equal(fyToken(undefined), '');
  assert.equal(fyToken(''), '');
  assert.equal(fyToken('2026'), '');
  assert.equal(fyToken('FY26'), '');
});

test('rolloverSuffix appends the new FY token to a plain series on its first roll-over', () => {
  assert.equal(rolloverSuffix(null, '2026-27', '2027-28'), '/27-28');
  assert.equal(rolloverSuffix('', '2026-27', '2027-28'), '/27-28');
});

test('rolloverSuffix replaces the previous FY token so it never stacks', () => {
  assert.equal(rolloverSuffix('/27-28', '2027-28', '2028-29'), '/28-29');
  assert.equal(rolloverSuffix('/A/27-28', '2027-28', '2028-29'), '/A/28-29');
});

test('rolloverSuffix keeps a tenant-configured suffix and adds the token after it', () => {
  assert.equal(rolloverSuffix('/CHN', '2026-27', '2027-28'), '/CHN/27-28');
});

test('the formatted number is distinct across two financial years', () => {
  const y1 = formatSeriesNumber({ prefix: 'INV-', suffix: null, number: 1, paddingLength: 4 });
  const y2 = formatSeriesNumber({ prefix: 'INV-', suffix: rolloverSuffix(null, '2026-27', '2027-28'), number: 1, paddingLength: 4 });
  assert.equal(y1, 'INV-0001');
  assert.equal(y2, 'INV-0001/27-28');
  assert.notEqual(y1, y2);
});
