/**
 * Unit tests for the shared master-data validators — the single source of truth
 * used by both the API (authoritative) and the web client. Imports the compiled
 * package output (`pnpm --filter @rmc/shared build` runs first via turbo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  isValidGstin,
  gstinCheckDigit,
  isValidMobile, isNonNegativeNumber, isValidPincode, validateMasterFields } from '../../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

test('isValidGstin accepts a well-formed GSTIN and rejects junk', () => {
  assert.equal(isValidGstin('33ABCDE1234F1Z7'), true);
  assert.equal(isValidGstin(' 33abcde1234f1z7 '), true); // trims + upper-cases
  assert.equal(isValidGstin('INVALIDGSTIN123'), false);
  assert.equal(isValidGstin('33ABCDE1234F1Z'), false); // too short
});

test('isValidMobile is lenient about formatting but rejects junk', () => {
  assert.equal(isValidMobile('9943602633'), true);
  assert.equal(isValidMobile('+91 99436 02633'), true);
  assert.equal(isValidMobile('99436-02633'), true);
  assert.equal(isValidMobile('12345'), false); // too short
  assert.equal(isValidMobile('1234567890'), false); // must start 6-9
});

test('isNonNegativeNumber', () => {
  assert.equal(isNonNegativeNumber(0), true);
  assert.equal(isNonNegativeNumber('5000'), true);
  assert.equal(isNonNegativeNumber(-1), false);
  assert.equal(isNonNegativeNumber('abc'), false);
  assert.equal(isNonNegativeNumber(Infinity), false);
});

test('isValidPincode accepts a 6-digit Indian PIN and rejects junk', () => {
  assert.equal(isValidPincode('600002'), true);
  assert.equal(isValidPincode(' 110001 '), true); // trims
  assert.equal(isValidPincode('012345'), false); // must not start with 0
  assert.equal(isValidPincode('12345'), false); // too short
  assert.equal(isValidPincode('1234567'), false); // too long
  assert.equal(isValidPincode('6000A2'), false); // non-digit
});

test('validateMasterFields validates pincode only when provided', () => {
  assert.equal(validateMasterFields({ pincode: '600002' }).pincode, undefined); // valid → no error
  assert.equal(validateMasterFields({}).pincode, undefined); // absent → not validated
  assert.ok(validateMasterFields({ pincode: '12345' }).pincode); // provided-but-wrong → error
});

test('validateMasterFields flags the exact QA-bad payload', () => {
  const e = validateMasterFields({ gstin: 'INVALIDGSTIN123', creditLimit: -5000, creditDays: -1, mobile: '12345' });
  assert.ok(e.gstin);
  assert.ok(e.creditLimit);
  assert.ok(e.creditDays);
  assert.ok(e.mobile);
});

test('validateMasterFields returns no errors for a valid record', () => {
  const e = validateMasterFields({ gstin: '33ABCDE1234F1Z7', creditLimit: 5000, creditDays: 30, mobile: '9943602633' });
  assert.equal(Object.keys(e).length, 0);
});

test('validateMasterFields ignores absent fields (required-ness is enforced elsewhere)', () => {
  assert.equal(Object.keys(validateMasterFields({})).length, 0);
  assert.equal(Object.keys(validateMasterFields({ gstin: '', mobile: '' })).length, 0);
});

// ---- GSTIN check digit -------------------------------------------------------
// The shape alone used to be enough, so a GSTIN with one mistyped character was
// accepted onto every invoice for that customer and into GSTR-1. The 15th
// character exists to catch exactly that.
test('the GSTIN check digit is computed per the GSTN rule', () => {
  // 29AABCS1429B1ZQ is the one fixture in this repo whose digit already held.
  assert.equal(gstinCheckDigit('29AABCS1429B1Z'), 'Q');
  assert.equal(gstinCheckDigit('33ABCDE1234F1Z'), '7');
  assert.equal(gstinCheckDigit('33ABCDE1234F1Z'.toLowerCase()), '7', 'case does not matter');
  assert.equal(gstinCheckDigit('33ABCDE1234F1'), null, '13 characters is not a GSTIN prefix');
  assert.equal(gstinCheckDigit('33ABCDE1234F1*'), null, 'only base-36 characters');
});

test('a GSTIN with a wrong check digit is rejected, and only that one is accepted', () => {
  const stem = '33ABCDE1234F1Z';
  const right = gstinCheckDigit(stem);
  for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    assert.equal(isValidGstin(stem + c), c === right, `${stem}${c} should be ${c === right ? 'valid' : 'rejected'}`);
  }
});

test('one mistyped character anywhere in a GSTIN is caught', () => {
  const good = '33ABCDE1234F1Z7';
  assert.equal(isValidGstin(good), true);
  // Change each position to something else that still fits the shape.
  const alt = (ch) => (/[0-9]/.test(ch) ? String((Number(ch) + 1) % 10) : ch === 'Z' ? 'Y' : 'Z');
  for (let i = 0; i < 14; i += 1) {
    if (i === 13) continue; // the fixed 'Z' — changing it fails the shape, not the digit
    const typo = good.slice(0, i) + alt(good[i]) + good.slice(i + 1);
    assert.equal(isValidGstin(typo), false, `typo at position ${i + 1}: ${typo}`);
  }
});

test('the compliance validator is the shared one, not a second regex', () => {
  const src = readFileSync(resolve(here, '../../../../apps/api/src/compliance/gst-payload.util.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /GSTIN_RE\s*=/, 'gst-payload.util.ts must not keep its own GSTIN regex');
  assert.match(src, /isValidGstin\(/, 'it must ask the shared validator');
});
