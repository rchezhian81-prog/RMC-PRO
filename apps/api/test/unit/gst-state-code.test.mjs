/**
 * Unit tests for gstStateCode (Tier 4B).
 *
 * Invoices store the place of supply as the customer's state NAME, but the NIC
 * portal's Pos / state-code fields need the 2-digit numeric code. gstStateCode
 * resolves name → code, keeps an already-numeric value, and falls back to a
 * valid GSTIN's own state code.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gstStateCode } from '../../dist/compliance/gst-payload.util.js';

test('maps a state name to its GST code', () => {
  assert.equal(gstStateCode('Tamil Nadu'), '33');
  assert.equal(gstStateCode('Karnataka'), '29');
  assert.equal(gstStateCode('Maharashtra'), '27');
});

test('is case- and whitespace-insensitive, and handles & / aliases', () => {
  assert.equal(gstStateCode('  tamil nadu  '), '33');
  assert.equal(gstStateCode('TAMILNADU'), '33');
  assert.equal(gstStateCode('Jammu & Kashmir'), '01');
  assert.equal(gstStateCode('Orissa'), '21'); // old name for Odisha
  assert.equal(gstStateCode('Pondicherry'), '34'); // old name for Puducherry
});

test('keeps an already-numeric 2-digit code as-is', () => {
  assert.equal(gstStateCode('33'), '33');
  assert.equal(gstStateCode('07'), '07');
});

test('falls back to the GSTIN state code when the name is unknown/empty', () => {
  // 33 = Tamil Nadu prefix on a syntactically valid GSTIN.
  assert.equal(gstStateCode(null, '33ABCDE1234F1Z5'), '33');
  assert.equal(gstStateCode('', '29ABCDE1234F1Z5'), '29');
  assert.equal(gstStateCode('Nowhere', '07ABCDE1234F1Z5'), '07');
});

test('prefers the place-of-supply name over the GSTIN when both resolve', () => {
  // POS is the delivery state; GSTIN is only the fallback.
  assert.equal(gstStateCode('Kerala', '33ABCDE1234F1Z5'), '32');
});

test('returns empty string when nothing resolves (validator then flags it)', () => {
  assert.equal(gstStateCode(null, null), '');
  assert.equal(gstStateCode('Not a state', 'not-a-gstin'), '');
});
