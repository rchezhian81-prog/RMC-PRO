/**
 * Which tax heads an invoice carries — CGST + SGST, or IGST.
 *
 * THE BUG: the state map held full names only. A company saved as "TN" and a
 * customer saved as "Tamil Nadu" are the SAME state, but neither resolved to a
 * code, so the comparison fell through to the two NAMES, found them different,
 * and judged the supply INTER-state. Every local sale was then taxed IGST
 * instead of CGST + SGST — wrong heads on the invoice, a wrong GSTR-1, and a
 * buyer who cannot match the credit. Correcting it afterwards means credit
 * notes and a re-filing.
 *
 * The seeded company state is "TN", so a fresh install shipped with exactly
 * that mismatch waiting for the first local customer.
 *
 * Verified end to end after the fix: a 28 m³ delivery to a Tamil Nadu customer
 * from a "TN" company invoiced CGST 12,096 + SGST 12,096, IGST 0 — where it had
 * been IGST 24,192.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { gstStateCode } = require(resolve(here, '../../dist/compliance/gst-payload.util.js'));
const { isInterstateSupply } = require(resolve(here, '../../dist/billing/tax.util.js'));

test('a two-letter state code resolves like the full name', () => {
  const pairs = [
    ['TN', 'Tamil Nadu', '33'], ['KA', 'Karnataka', '29'], ['MH', 'Maharashtra', '27'],
    ['KL', 'Kerala', '32'], ['GJ', 'Gujarat', '24'], ['DL', 'Delhi', '07'],
    ['TS', 'Telangana', '36'], ['OD', 'Odisha', '21'], ['UP', 'Uttar Pradesh', '09'],
    ['WB', 'West Bengal', '19'], ['MP', 'Madhya Pradesh', '23'], ['RJ', 'Rajasthan', '08'],
  ];
  for (const [abbr, name, code] of pairs) {
    assert.equal(gstStateCode(abbr), code, `${abbr} must resolve to ${code}`);
    assert.equal(gstStateCode(name), code, `${name} must resolve to ${code}`);
    assert.equal(gstStateCode(abbr.toLowerCase()), code, 'case must not matter');
  }
});

test('Andhra Pradesh resolves to 37, the code still issued', () => {
  // 28 was the pre-bifurcation code and is no longer allotted.
  assert.equal(gstStateCode('AP'), '37');
  assert.equal(gstStateCode('Andhra Pradesh'), '37');
});

test('an unknown state resolves to nothing rather than a guess', () => {
  for (const v of ['XX', 'Tami', 'ZZ', '', '   ', null, undefined]) {
    assert.equal(gstStateCode(v), '', `${JSON.stringify(v)} must not resolve`);
  }
});

test('a state NAME is never truncated into an abbreviation', () => {
  // Only a bare two-letter token is read as a code, so "Goa" cannot become "GO".
  assert.equal(gstStateCode('Goa'), '30');
  assert.equal(gstStateCode('GA'), '30');
  assert.equal(gstStateCode('Assam'), '18');
});

test('a local sale is CGST + SGST however the two sides spell the state', () => {
  const local = [
    ['TN', 'Tamil Nadu'], ['Tamil Nadu', 'TN'], ['TN', 'tn'], ['TN', 'TN'],
    ['Tamil Nadu', 'Tamilnadu'], ['Odisha', 'Orissa'], ['KA', 'Karnataka'],
    ['Uttarakhand', 'UK'], ['Puducherry', 'Pondicherry'],
  ];
  for (const [seller, buyer] of local) {
    assert.equal(isInterstateSupply(seller, buyer), false,
      `${seller} -> ${buyer} is one state and must be CGST + SGST`);
  }
});

test('a genuine inter-state sale is still IGST', () => {
  const across = [['TN', 'Karnataka'], ['TN', 'KA'], ['Karnataka', 'TN'], ['MH', 'GJ'], ['Kerala', 'TN']];
  for (const [seller, buyer] of across) {
    assert.equal(isInterstateSupply(seller, buyer), true,
      `${seller} -> ${buyer} crosses a border and must be IGST`);
  }
});

test('a numeric code is taken as given', () => {
  assert.equal(gstStateCode('33'), '33');
  assert.equal(isInterstateSupply('33', 'Tamil Nadu'), false);
  assert.equal(isInterstateSupply('33', 'KA'), true);
});

test('a GSTIN supplies the state when the name cannot', () => {
  // 33AABCS1429B1ZQ — the first two digits ARE the state code.
  assert.equal(gstStateCode('', '33AABCS1429B1ZQ'), '33');
  assert.equal(gstStateCode('Nowhere', '29AABCS1429B1ZQ'), '29');
});
