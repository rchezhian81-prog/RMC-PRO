/**
 * Unit tests for the bulk import framework helpers (Plan F1): the CSV parser,
 * row→object pairing, the template builder, and the import-definition registry.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  rowsToObjects,
  buildTemplateCsv,
  getImportDef,
  IMPORT_DEFS,
} from '../../dist/imports/import-framework.util.js';

// ---- parseCsv ----
test('parses a simple CSV with a header and rows', () => {
  const r = parseCsv('code,name\nC1,Acme\nC2,Beta\n');
  assert.deepEqual(r.headers, ['code', 'name']);
  assert.deepEqual(r.rows, [['C1', 'Acme'], ['C2', 'Beta']]);
});

test('handles quoted fields with embedded commas', () => {
  const r = parseCsv('code,name\nC1,"Acme, Inc."\n');
  assert.deepEqual(r.rows[0], ['C1', 'Acme, Inc.']);
});

test('handles escaped double quotes inside a quoted field', () => {
  const r = parseCsv('code,name\nC1,"He said ""hi"""\n');
  assert.deepEqual(r.rows[0], ['C1', 'He said "hi"']);
});

test('handles a newline embedded in a quoted field', () => {
  const r = parseCsv('code,name\nC1,"Line1\nLine2"\n');
  assert.deepEqual(r.rows[0], ['C1', 'Line1\nLine2']);
});

test('tolerates CRLF line endings and trims unquoted fields', () => {
  const r = parseCsv('code,name\r\nC1, Acme \r\n');
  assert.deepEqual(r.headers, ['code', 'name']);
  assert.deepEqual(r.rows[0], ['C1', 'Acme']);
});

test('skips wholly-blank lines', () => {
  const r = parseCsv('code,name\nC1,Acme\n\n\nC2,Beta\n');
  assert.equal(r.rows.length, 2);
});

test('parses a final row with no trailing newline', () => {
  const r = parseCsv('code,name\nC1,Acme');
  assert.deepEqual(r.rows[0], ['C1', 'Acme']);
});

// ---- rowsToObjects ----
test('pairs rows with the header keys, padding short rows', () => {
  const objs = rowsToObjects(['code', 'name', 'city'], [['C1', 'Acme']]);
  assert.deepEqual(objs[0], { code: 'C1', name: 'Acme', city: '' });
});

// ---- registry + template ----
test('the registry exposes customers, materials and suppliers', () => {
  const keys = IMPORT_DEFS.map((d) => d.key).sort();
  assert.deepEqual(keys, ['customers', 'materials', 'suppliers']);
});

test('getImportDef finds a known definition and returns undefined otherwise', () => {
  assert.equal(getImportDef('customers')?.key, 'customers');
  assert.equal(getImportDef('nope'), undefined);
});

test('the customers template has the field keys as its header row', () => {
  const csv = buildTemplateCsv(getImportDef('customers'));
  const [header] = csv.split('\n');
  assert.ok(header.startsWith('customerCode,customerName,'));
  assert.ok(header.includes('creditLimit'));
});

test('template example values with commas are quoted', () => {
  const def = { key: 't', label: 'T', columns: [{ key: 'a', label: 'A', example: 'x,y' }] };
  const csv = buildTemplateCsv(def);
  assert.equal(csv.split('\n')[1], '"x,y"');
});

test('required columns are marked on the customer definition', () => {
  const def = getImportDef('customers');
  const required = def.columns.filter((c) => c.required).map((c) => c.key);
  assert.deepEqual(required, ['customerCode', 'customerName']);
});
