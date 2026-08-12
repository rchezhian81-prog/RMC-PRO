/**
 * Unit tests for the transporter-id validator and its wiring into
 * validateMasterFields — the rule behind the transporter master's TRANSIN /
 * GSTIN field, which becomes the e-way bill's `TransId`.
 *
 * Imports the COMPILED shared output, so `pnpm --filter @rmc/shared build` must
 * run first (the test turbo task depends on build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTransporterId, validateMasterFields } from '@rmc/shared';

test('isValidTransporterId accepts a 15-char GSTIN-shaped id', () => {
  assert.equal(isValidTransporterId('29ABCDE1234F1Z5'), true);
});

test('isValidTransporterId accepts an enrolled TRANSIN (lowercased, spaces trimmed)', () => {
  assert.equal(isValidTransporterId('  88abcde1234f1z5  '), true);
});

test('isValidTransporterId rejects wrong length or bad state prefix', () => {
  assert.equal(isValidTransporterId('29ABCDE1234F1Z'), false); // 14 chars
  assert.equal(isValidTransporterId('29ABCDE1234F1Z55'), false); // 16 chars
  assert.equal(isValidTransporterId('A9ABCDE1234F1Z5'), false); // first two must be digits
  assert.equal(isValidTransporterId(''), false);
});

test('validateMasterFields flags a malformed transin', () => {
  const errors = validateMasterFields({ transin: 'nope' });
  assert.equal('transin' in errors, true);
});

test('validateMasterFields passes a well-formed transin', () => {
  assert.deepEqual(validateMasterFields({ transin: '29ABCDE1234F1Z5' }), {});
});

test('validateMasterFields ignores an absent or empty transin (required-ness is enforced elsewhere)', () => {
  assert.deepEqual(validateMasterFields({}), {});
  assert.deepEqual(validateMasterFields({ transin: '' }), {});
});
