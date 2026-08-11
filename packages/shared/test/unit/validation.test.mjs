/**
 * Unit tests for the shared master-data validators — the single source of truth
 * used by both the API (authoritative) and the web client. Imports the compiled
 * package output (`pnpm --filter @rmc/shared build` runs first via turbo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGstin, isValidMobile, isNonNegativeNumber, isValidPincode, validateMasterFields } from '../../dist/index.js';

test('isValidGstin accepts a well-formed GSTIN and rejects junk', () => {
  assert.equal(isValidGstin('33ABCDE1234F1Z5'), true);
  assert.equal(isValidGstin(' 33abcde1234f1z5 '), true); // trims + upper-cases
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
  const e = validateMasterFields({ gstin: '33ABCDE1234F1Z5', creditLimit: 5000, creditDays: 30, mobile: '9943602633' });
  assert.equal(Object.keys(e).length, 0);
});

test('validateMasterFields ignores absent fields (required-ness is enforced elsewhere)', () => {
  assert.equal(Object.keys(validateMasterFields({})).length, 0);
  assert.equal(Object.keys(validateMasterFields({ gstin: '', mobile: '' })).length, 0);
});
