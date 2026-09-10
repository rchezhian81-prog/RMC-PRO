/**
 * Unit tests for the shared report-window guard (Q3).
 *
 * `from`/`to` used to reach Postgres as `$1::date`, so `?from=garbage` surfaced
 * as a 500 rather than a 400. The guard was written for billing, copied into
 * purchase, and then NOT copied into QC or inventory — the same "fix lands on
 * one side of a pair" pattern that has produced a finding in every scan. It now
 * lives in one module, and the drift guard below keeps it that way.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { dateRange } from '../../dist/common/date-range.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(resolve(here, '../../src/', p), 'utf8');

const CONSUMERS = [
  'billing/billing.controllers.ts',
  'purchase/purchase.controllers.ts',
  'qc/qc.controller.ts',
  'inventory/inventory.controllers.ts',
];

// ── the guard ────────────────────────────────────────────────────────────────

test('a well-formed window passes through unchanged', () => {
  assert.deepEqual(dateRange('2026-04-01', '2026-06-30'), ['2026-04-01', '2026-06-30']);
});

test('absent or empty bounds mean unbounded, not an error', () => {
  assert.deepEqual(dateRange(undefined, undefined), [undefined, undefined]);
  assert.deepEqual(dateRange('', ''), [undefined, undefined]);
  assert.deepEqual(dateRange('   ', '2026-06-30'), [undefined, '2026-06-30']);
});

test('a malformed date is a 400 naming the offending value', () => {
  assert.throws(() => dateRange('garbage', undefined), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.response.code, 'VALIDATION_ERROR');
    assert.match(err.response.message, /from must be a date in YYYY-MM-DD form/);
    assert.match(err.response.message, /garbage/);
    return true;
  });
  assert.throws(() => dateRange(undefined, '30-06-2026'), /to must be a date/);
});

test('a very long junk value is truncated in the message', () => {
  // The echoed value must not become a reflection vector for arbitrary length.
  assert.throws(() => dateRange('x'.repeat(500), undefined), (err) => {
    assert.ok(err.response.message.length < 200);
    return true;
  });
});

test('a backwards range is refused', () => {
  assert.throws(() => dateRange('2026-06-30', '2026-04-01'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.response.message, /from \(2026-06-30\) is after to \(2026-04-01\)/);
    return true;
  });
});

test('an equal from/to is a valid single-day window', () => {
  assert.deepEqual(dateRange('2026-04-01', '2026-04-01'), ['2026-04-01', '2026-04-01']);
});

// ── drift guard: one implementation, used by every report controller ─────────

test('every report controller uses the shared guard', () => {
  for (const f of CONSUMERS) {
    const s = src(f);
    assert.match(s, /import \{ dateRange \} from '\.\.\/common\/date-range\.util'/, `${f} must import the shared guard`);
    assert.match(s, /\.\.\.dateRange\(from, to\)/, `${f} must apply it to its report routes`);
  }
});

test('no controller keeps a private copy of the guard', () => {
  for (const f of CONSUMERS) {
    assert.ok(!/function dateRange/.test(src(f)), `${f} must not redefine dateRange`);
  }
});

test('no report route passes a raw from/to straight through', () => {
  // Catches a NEW route added alongside the guarded ones without the guard.
  for (const f of CONSUMERS) {
    const bare = src(f).match(/\w+\(tid\(u\)(?:, [^)]*?)?, from, to\)/g) ?? [];
    assert.deepEqual(bare, [], `${f} passes an unvalidated window: ${bare.join(', ')}`);
  }
});
