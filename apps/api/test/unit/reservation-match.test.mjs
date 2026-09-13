/**
 * Which document numbers belong to a device's reserved block.
 *
 * THE BUG: deciding this was `documentNo.match(/(\d+)/)` — the first digit run
 * ANYWHERE in the string. Any number a person typed ("MANUAL-2026-45", a site
 * reference, an imported legacy number) yielded a figure, and if that figure
 * fell inside a live block the block was marked spent up to that point. The
 * Devices screen then reported a tablet about to run dry when it had barely
 * started — the one question that screen exists to answer.
 *
 * It surfaced as an integration test that failed roughly once a fortnight,
 * because the number it used was time-derived and only sometimes landed inside
 * the block. The flakiness WAS the bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { numberWithinBlock } = require(resolve(here, '../../dist/sync/reservation-match.util.js'));

/** DC-####/26-27, numbers 681..700 — a block after a financial-year roll-over. */
const block = { prefix: 'DC-', suffix: '/26-27', padding_length: 4, number_from: 681, number_to: 700 };

test('a number the device formatted from the block is recognised', () => {
  assert.equal(numberWithinBlock('DC-0681/26-27', block), 681);
  assert.equal(numberWithinBlock('DC-0690/26-27', block), 690);
  assert.equal(numberWithinBlock('DC-0700/26-27', block), 700);
});

test('a hand-typed number is not, even when it contains a figure from the range', () => {
  for (const typed of ['MANUAL-685', 'MANUAL-690-abc', 'CH-2026-OVERRIDE-690', 'SITE-690-A', '690', 'DC-690']) {
    assert.equal(numberWithinBlock(typed, block), null, `${typed} must not spend a block number`);
  }
});

test('a figure outside the block is not one of its numbers', () => {
  assert.equal(numberWithinBlock('DC-0680/26-27', block), null);
  assert.equal(numberWithinBlock('DC-0701/26-27', block), null);
});

test('last financial year’s number does not spend this year’s block', () => {
  // Each FY restarts at 1, so the same figure exists in both years. Only the
  // suffix separates them — which is why matching on digits alone was unsafe.
  assert.equal(numberWithinBlock('DC-0690/25-26', block), null);
});

test('another series’ number does not spend this block', () => {
  assert.equal(numberWithinBlock('INV-0690/26-27', block), null);
});

test('a series that outgrows its padding keeps working', () => {
  const wide = { prefix: 'DC-', suffix: '', padding_length: 4, number_from: 9998, number_to: 10002 };
  assert.equal(numberWithinBlock('DC-9999', wide), 9999);
  assert.equal(numberWithinBlock('DC-10000', wide), 10000);
  assert.equal(numberWithinBlock('DC-10002', wide), 10002);
  assert.equal(numberWithinBlock('DC-999', wide), null, 'still too few digits for the padding');
});

test('empty and nonsense input are simply not matches', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(numberWithinBlock(v, block), null);
});

test('a prefix containing regex metacharacters is matched literally', () => {
  const odd = { prefix: 'DC(A)-', suffix: '.26', padding_length: 3, number_from: 1, number_to: 9 };
  assert.equal(numberWithinBlock('DC(A)-005.26', odd), 5);
  assert.equal(numberWithinBlock('DCXAX-005X26', odd), null, 'metacharacters must not act as wildcards');
});

/**
 * The body of noteNumberUsed with comments stripped.
 *
 * Scanning the raw source is a trap this repo has fallen into before: the
 * comment above the function QUOTES the old broken pattern to explain it, so a
 * naive search finds the bug in the very code that fixed it.
 */
function noteNumberUsedCode() {
  const src = readFileSync(resolve(here, '../../src/sync/sync.service.ts'), 'utf8');
  const fn = src.slice(src.indexOf('private async noteNumberUsed('), src.indexOf('private async resolveGradeId('));
  return fn
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/^\s*\/\/.*$/gm, ' ');       // line comments
}

test('the bookkeeping cannot take a push down with it', () => {
  // It runs inside the push transaction, where a failed statement aborts the
  // WHOLE transaction — a try/catch hides the error but not the damage. This is
  // how a missing column turned every offline challan push into a failure.
  const code = noteNumberUsedCode();
  assert.match(code, /SAVEPOINT/, 'the bookkeeping must be fenced in a savepoint');
  assert.match(code, /ROLLBACK TO SAVEPOINT/, 'and rolled back on its own failure');
  assert.ok(!/\.match\(/.test(code), 'it must not go back to scanning the number with a regex');
  assert.match(code, /numberWithinBlock\(/, 'it must ask the block whether the number is one of its own');
});

test('the suffix comes from the series, because the block row has no such column', () => {
  const code = noteNumberUsedCode();
  assert.match(code, /FROM number_series s/, 'the suffix must be read back from the series');
  assert.ok(!/r\.suffix/.test(code), 'local_number_reservations has no suffix column to select');
});
