/**
 * Unit tests for nullifyEmpty (common/sanitize.ts): web forms submit "" for
 * untouched optional fields, which Postgres rejects for date/numeric/uuid
 * columns — so "" must become null while every other value passes through
 * untouched, and the input must not be mutated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nullifyEmpty } from '../../dist/common/sanitize.js';

test('empty strings become null; other values pass through unchanged', () => {
  const out = nullifyEmpty({ a: '', b: 'x', c: 0, d: null, e: false, f: '0' });
  assert.equal(out.a, null);
  assert.equal(out.b, 'x');
  assert.equal(out.c, 0);   // a numeric 0 is not empty
  assert.equal(out.d, null);
  assert.equal(out.e, false); // a boolean false is not empty
  assert.equal(out.f, '0');   // the string "0" is not empty
});

test('does not mutate the input object', () => {
  const input = { a: '', b: 'keep' };
  const out = nullifyEmpty(input);
  assert.equal(input.a, ''); // original untouched
  assert.notEqual(out, input); // returns a new object
});
