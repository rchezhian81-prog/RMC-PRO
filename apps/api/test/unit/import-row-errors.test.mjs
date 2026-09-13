/**
 * Guard: a rejected import row must name the column and say what is wrong.
 *
 * THE BUG: the master services answer a bad value with the generic message
 * "Please correct the highlighted fields." plus a `fields` map of the real
 * per-field messages. On a FORM that is right — the web app highlights the
 * offending inputs. A SPREADSHEET has nothing to highlight, and the importer
 * kept only the generic half. Someone loading their customer list on day one
 * was told "Row 4: Please correct the highlighted fields." and had no way to
 * learn which of eleven columns was wrong, or why.
 *
 * Verified live against a six-row file:
 *   Row 3 — GSTIN: Enter a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5).
 *   Row 4 — Mobile: Enter a valid 10-digit mobile number.
 *   Row 6 — GSTIN: … Mobile: … PIN Code: …        (all three at once)
 *   Row 7 — Credit Limit: "not-a-number" is not a number
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/imports/import.service.ts'), 'utf8');

test('a row error carries the per-field detail, not just the generic banner', () => {
  assert.match(src, /resp\?\.fields/, 'the importer must read the fields map off the refusal');
  // and it must be preferred over the generic message, not appended after it
  const fields = src.indexOf('resp?.fields');
  const generic = src.indexOf('if (resp?.message) return resp.message;');
  assert.ok(fields > 0 && generic > 0 && fields < generic,
    'the field detail must be checked BEFORE falling back to the generic message');
});

test('the column is named by its spreadsheet header, not its internal key', () => {
  assert.match(src, /def\?\.columns\.find\(\(c\) => c\.key === key\)\?\.label/,
    'a person editing a CSV looks for the header, not the DTO key');
});

test('every failing field is reported, not only the first', () => {
  assert.match(src, /Object\.entries\(resp\.fields\)[\s\S]{0,200}\.join\(/,
    'a row with three bad columns must name all three');
});

test('the error formatter is given the definition it needs', () => {
  assert.match(src, /this\.errorMessage\(e, importer\.def\)/,
    'without the def the labels fall back to raw keys');
});

test('a duplicate code still reads as a duplicate, not raw SQL', () => {
  assert.match(src, /duplicate key value\|unique constraint/);
  assert.match(src, /A record with this code already exists/);
});
