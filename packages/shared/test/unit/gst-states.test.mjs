/**
 * The state list that decides how a bill is taxed.
 *
 * A record's state is not a label — it decides CGST + SGST vs IGST on every
 * quotation, order, invoice and vendor bill. The field was free text, so one
 * state could be written "TN", "Tamil Nadu", "Tamilnadu" or "Tamil Nadi", and
 * the last of those silently produced whatever a name comparison decided.
 *
 * The forms now offer this list, and the API refuses a state that resolves to
 * nothing, so a typo is caught at entry instead of at filing time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
import { GST_STATES, GST_STATE_NAMES, resolveGstStateCode, isKnownGstState } from '../../dist/index.js';
import { validateMasterFields } from '../../dist/index.js';

test('the list covers every state and union territory, with no duplicates', () => {
  assert.equal(GST_STATES.length, 37);
  assert.equal(new Set(GST_STATES.map((s) => s.code)).size, 37, 'codes must be unique');
  assert.equal(new Set(GST_STATES.map((s) => s.name)).size, 37, 'names must be unique');
  for (const s of GST_STATES) assert.match(s.code, /^\d{2}$/, `${s.name} needs a 2-digit code`);
  assert.equal(GST_STATE_NAMES.length, 37);
});

test('a canonical name, an old spelling, a two-letter code and the code itself all agree', () => {
  for (const v of ['Tamil Nadu', 'tamilnadu', 'TAMIL NADU', '  Tamil Nadu  ', 'TN', 'tn', '33']) {
    assert.equal(resolveGstStateCode(v), '33', `${JSON.stringify(v)} is Tamil Nadu`);
  }
  assert.equal(resolveGstStateCode('Orissa'), '21');
  assert.equal(resolveGstStateCode('Odisha'), '21');
  assert.equal(resolveGstStateCode('Uttaranchal'), '05');
  assert.equal(resolveGstStateCode('Pondicherry'), '34');
});

test('Andhra Pradesh is 37, and 28 is not a state any more', () => {
  assert.equal(resolveGstStateCode('Andhra Pradesh'), '37');
  assert.equal(resolveGstStateCode('AP'), '37');
  assert.equal(resolveGstStateCode('28'), '', '28 was the pre-bifurcation code and is no longer allotted');
});

test('a typo resolves to nothing rather than to the wrong state', () => {
  for (const v of ['Tamil Nadi', 'Karnatka', 'XX', 'Mahrashtra', '99', '', '   ', null, undefined]) {
    assert.equal(resolveGstStateCode(v), '', `${JSON.stringify(v)} must not resolve`);
    assert.equal(isKnownGstState(v), false);
  }
});

test('every name in the list resolves to its own code', () => {
  for (const s of GST_STATES) {
    assert.equal(resolveGstStateCode(s.name), s.code, `${s.name} must round-trip`);
  }
});

test('saving a record with an unusable state is refused', () => {
  assert.deepEqual(validateMasterFields({ state: 'Tamil Nadu' }), {});
  assert.deepEqual(validateMasterFields({ state: 'TN' }), {}, 'a two-letter code is fine');
  assert.deepEqual(validateMasterFields({ state: 'Orissa' }), {}, 'an old spelling is fine');
  const bad = validateMasterFields({ state: 'Tamil Nadi' });
  assert.ok(bad.state, 'a typo must be caught at entry');
  assert.match(bad.state, /CGST\/SGST vs IGST/, 'and must say why it matters');
});

test('a record with no state at all is not blocked by this rule', () => {
  // Whether the field is REQUIRED is a per-entity decision; this validator only
  // judges a value that is present.
  assert.deepEqual(validateMasterFields({}), {});
  assert.deepEqual(validateMasterFields({ state: '' }), {});
  assert.deepEqual(validateMasterFields({ state: '   ' }), {});
});

test('the ops checker’s inlined table matches this list exactly', () => {
  // scripts/ops/check-gst-states.mjs inlines the table so it runs on a VPS from
  // a plain checkout with nothing built. Two copies of a table that decides tax
  // heads is exactly the drift this project keeps getting bitten by, so the copy
  // is checked against the original here rather than trusted.
  const src = readFileSync(resolve(here, '../../../../scripts/ops/check-gst-states.mjs'), 'utf8');
  const m = /const STATE_CODES = (\{[\s\S]*?\n\});/.exec(src);
  assert.ok(m, 'the checker must still declare STATE_CODES');
  const inlined = new Function(`return ${m[1]}`)();

  for (const [written, code] of Object.entries(inlined)) {
    assert.equal(resolveGstStateCode(written), code,
      `the checker maps "${written}" to ${code}; the shared list disagrees`);
  }
  // and the other way: every canonical name the shared list knows must be in it
  for (const s of GST_STATES) {
    const key = s.name.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');
    assert.equal(inlined[key], s.code, `the checker is missing ${s.name}`);
  }
});
