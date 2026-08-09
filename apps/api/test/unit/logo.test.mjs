/**
 * Unit tests for company-logo validation (setup/logo.ts) — a security-relevant
 * gate: the client MIME is never trusted, the bytes are sniffed, oversize is
 * refused, and an SVG carrying script is rejected outright. A regression here
 * could let a renamed executable or an active-content SVG be stored.
 *
 * Imports the compiled output (pnpm --filter @rmc/api build runs first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLogo, MAX_LOGO_BYTES, ALLOWED_LOGO_MIMES } from '../../dist/setup/logo.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]); // JPEG SOI + APP0
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const b64 = (buf) => buf.toString('base64');

test('accepts a real PNG / JPEG / SVG and returns canonical mime + clean base64', () => {
  assert.equal(validateLogo('image/png', b64(PNG)).mime, 'image/png');
  assert.equal(validateLogo('image/jpg', b64(JPEG)).mime, 'image/jpeg'); // jpg normalises to jpeg
  const svg = validateLogo('image/svg+xml', b64(SVG));
  assert.equal(svg.mime, 'image/svg+xml');
  assert.equal(svg.data, b64(SVG)); // re-encoded from the sniffed bytes
});

test('strips a data-URL prefix if the client left it on', () => {
  const out = validateLogo('image/png', `data:image/png;base64,${b64(PNG)}`);
  assert.equal(out.mime, 'image/png');
});

test('rejects a type that does not match the actual bytes', () => {
  // claims PNG, but the bytes are a JPEG
  assert.throws(() => validateLogo('image/png', b64(JPEG)), /does not match its contents/i);
});

test('rejects a non-image / unknown type', () => {
  assert.throws(() => validateLogo('image/gif', b64(PNG)), /PNG, JPG or SVG/i);
  assert.throws(() => validateLogo('image/png', b64(Buffer.from('just some text'))), /not a valid/i);
});

test('rejects an empty upload', () => {
  assert.throws(() => validateLogo('image/png', ''), /No logo file/i);
});

test('rejects an oversize file (before anything else expensive)', () => {
  const tooBig = Buffer.alloc(MAX_LOGO_BYTES + 1, 0x89); // starts like PNG but is too large
  assert.throws(() => validateLogo('image/png', b64(tooBig)), /KB or smaller/i);
});

test('rejects an SVG carrying script or event handlers (active content)', () => {
  const withScript = Buffer.from('<svg><script>alert(1)</script></svg>');
  const withOnload = Buffer.from('<svg onload="alert(1)"></svg>');
  const withHref = Buffer.from('<svg><a href="javascript:alert(1)">x</a></svg>');
  assert.throws(() => validateLogo('image/svg+xml', b64(withScript)), /may not contain scripts/i);
  assert.throws(() => validateLogo('image/svg+xml', b64(withOnload)), /may not contain scripts/i);
  assert.throws(() => validateLogo('image/svg+xml', b64(withHref)), /may not contain scripts/i);
});

test('the allowed MIME set is exactly PNG / JPEG / SVG', () => {
  assert.deepEqual([...ALLOWED_LOGO_MIMES].sort(), ['image/jpeg', 'image/png', 'image/svg+xml']);
});
