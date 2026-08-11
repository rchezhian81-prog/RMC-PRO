/**
 * Unit tests for qrMatrix — the pure QR encoder wrapper the invoice PDF uses to
 * print the e-invoice signed QR. Asserts the structural invariants of a real QR
 * symbol (square, valid version size, corner finder patterns) plus determinism
 * and that a JWT-length payload encodes without throwing — so a regression in the
 * encoder or our wrapper is caught without rendering a PDF.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from '../../dist/sales/qr.util.js';

test('qrMatrix returns a square boolean grid at a valid QR version size', () => {
  const m = qrMatrix('hello');
  const n = m.length;
  assert.ok(n >= 21, `size ${n} must be at least version 1 (21)`);
  assert.equal((n - 21) % 4, 0, 'QR sizes are 21, 25, 29, … (17 + 4·version)');
  for (const row of m) {
    assert.equal(row.length, n, 'every row has n cells (square)');
    for (const cell of row) assert.equal(typeof cell, 'boolean');
  }
});

test('the three finder patterns are present (structural sanity)', () => {
  const m = qrMatrix('MixNova');
  const n = m.length;
  // A finder pattern is a 7×7 dark border; the top edge is 7 dark modules, then a
  // 1-module light separator. Check top-left and top-right corners.
  for (let c = 0; c < 7; c++) {
    assert.equal(m[0][c], true, `top-left finder: [0][${c}] dark`);
    assert.equal(m[0][n - 1 - c], true, `top-right finder: [0][${n - 1 - c}] dark`);
  }
  assert.equal(m[0][7], false, 'separator after the top-left finder is light');
  // Bottom-left finder: left edge of row n-1 is dark for the first 7 columns.
  for (let c = 0; c < 7; c++) assert.equal(m[n - 1][c], true, `bottom-left finder: [${n - 1}][${c}] dark`);
});

test('qrMatrix has both dark and light modules', () => {
  const m = qrMatrix('some-content');
  const flat = m.flat();
  assert.ok(flat.some((x) => x === true), 'has dark modules');
  assert.ok(flat.some((x) => x === false), 'has light modules');
});

test('qrMatrix is deterministic; different inputs differ', () => {
  const a1 = qrMatrix('same');
  const a2 = qrMatrix('same');
  assert.deepEqual(a1, a2);
  const b = qrMatrix('different');
  assert.notDeepEqual(a1, b);
});

test('a JWT-length signed-QR payload encodes without throwing (and grows the symbol)', () => {
  // Roughly the size of a real e-invoice signed QR (a JWS): ~900 chars, base64url + dots.
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.' + 'AbC012_-'.repeat(110) + '.' + 'Zz9y8x7w'.repeat(12);
  assert.ok(jwt.length > 800);
  const big = qrMatrix(jwt, 'M');
  const small = qrMatrix('x', 'M');
  assert.ok(big.length > small.length, 'more data → a higher QR version (larger grid)');
});
