/**
 * Unit tests for the list-size cap (common/list-limit.util.ts).
 *
 * THE DEFECT: the core business lists — orders, delivery challans, invoices,
 * quotations, leads, rate contracts — were unbounded `find()` calls. Measured on
 * a seeded tenant with 50,000 challans (about three years at 50 deliveries a
 * day), GET /delivery-challans returned a 31 MB body in ~1.5s on an idle local
 * database. After the cap: 125 KB in ~15ms.
 *
 * Nothing about the old behaviour degraded gracefully — every screen load
 * returned the whole table, and it got worse every single day of use.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { listLimit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../dist/common/list-limit.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const src = (p) => readFileSync(resolve(root, 'apps/api/src', p), 'utf8');

test('an absent or unusable limit falls back to the default', () => {
  for (const v of [undefined, null, '', '   ', 'abc', NaN, {}, []]) {
    assert.equal(listLimit(v), DEFAULT_LIST_LIMIT, String(v));
  }
});

test('zero and negatives fall back rather than returning nothing', () => {
  // take: 0 in TypeORM means "no limit" — the exact bug being fixed.
  for (const v of [0, '0', -1, '-50', -0.4]) {
    assert.equal(listLimit(v), DEFAULT_LIST_LIMIT, String(v));
  }
});

test('a sensible limit is honoured', () => {
  assert.equal(listLimit(50), 50);
  assert.equal(listLimit('50'), 50);
  assert.equal(listLimit(1), 1);
  assert.equal(listLimit(MAX_LIST_LIMIT), MAX_LIST_LIMIT);
});

test('the ceiling cannot be escaped', () => {
  // Otherwise ?limit=999999 reinstates the unbounded read this exists to stop.
  for (const v of [MAX_LIST_LIMIT + 1, 999999, '1e9', Infinity]) {
    assert.ok(listLimit(v) <= MAX_LIST_LIMIT, `${v} -> ${listLimit(v)}`);
  }
});

test('fractional input is floored, not rounded up past the ceiling', () => {
  assert.equal(listLimit(10.9), 10);
  assert.equal(listLimit(MAX_LIST_LIMIT + 0.9), MAX_LIST_LIMIT);
});

// ── drift guard: the high-growth lists stay capped ───────────────────────────

test('every core business list applies the cap', () => {
  const LISTS = [
    ['dispatch/delivery-challan.service.ts', 'DeliveryChallan'],
    ['billing/invoice.service.ts', 'Invoice'],
    ['orders/orders.service.ts', 'Order'],
    ['sales/quotations.service.ts', 'Quotation'],
    ['sales/leads.service.ts', 'Lead'],
    ['sales/rate-contracts.service.ts', 'RateContract'],
  ];
  for (const [file, entity] of LISTS) {
    const s = src(file);
    assert.match(s, /import \{ listLimit \} from '\.\.\/common\/list-limit\.util'/, `${file} must import the cap`);
    assert.match(s, /take: listLimit\(limit\)/, `${entity} list in ${file} must be capped`);
  }
});

test('the cap is a shared module, not copied per service', () => {
  // The date-range guard was copied into two controllers and then missed two
  // more. One definition means the next list added inherits it.
  for (const file of ['dispatch/delivery-challan.service.ts', 'billing/invoice.service.ts']) {
    assert.ok(!/function listLimit/.test(src(file)), `${file} must not redefine listLimit`);
  }
});
