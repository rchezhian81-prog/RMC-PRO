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
import {
  listLimit,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  REPORT_ROW_CAP,
  REPORT_FETCH_LIMIT,
  assertReportSize,
} from '../../dist/common/list-limit.util.js';

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
    // Match the symbol and the module, not the exact import line — services that
    // also pull in the report helpers widen the braces, and pinning the literal
    // string makes this fail on a correct change.
    assert.match(s, /import \{[^}]*\blistLimit\b[^}]*\} from '\.\.\/common\/list-limit\.util'/, `${file} must import the cap`);
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

// ── reports refuse rather than truncate ──────────────────────────────────────

test('a report within the cap passes through', () => {
  assertReportSize({ length: 0 }, 'sales register');
  assertReportSize({ length: REPORT_ROW_CAP }, 'sales register');
});

test('a report over the cap is REFUSED, not silently shortened', () => {
  // A sales register missing rows is a wrong total handed to an accountant.
  // Truncation would be the dangerous outcome here, not the safe one.
  assert.throws(() => assertReportSize({ length: REPORT_FETCH_LIMIT }, 'sales register'), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.response.code, 'REPORT_TOO_LARGE');
    assert.match(err.response.message, /sales register/);
    assert.match(err.response.message, /Narrow the date range/);
    return true;
  });
});

test('the fetch limit is exactly one more than the cap', () => {
  // So overflow is detectable without a second COUNT query.
  assert.equal(REPORT_FETCH_LIMIT, REPORT_ROW_CAP + 1);
});

test('every caller of the capped invoice query checks the size', () => {
  // REGRESSION: issuedInvoicesInRange is shared. Capping it without guarding a
  // caller turns that caller into a silently-incomplete financial export — the
  // Tally CSV was one such caller and would have shipped books that do not
  // balance.
  const billing = src('billing/billing-reports.service.ts');
  const callers = (billing.match(/issuedInvoicesInRange\(m, from, to\)/g) ?? []).length;
  const guards = (billing.match(/assertReportSize\(/g) ?? []).length;
  assert.ok(callers >= 2, `expected multiple callers, saw ${callers}`);
  assert.equal(guards, callers, `each of the ${callers} callers must assert its size (saw ${guards})`);
});

test('the delivery register is bounded in SQL and checked', () => {
  const dispatch = src('dispatch/delivery-challan.service.ts');
  assert.match(dispatch, /LIMIT \$\{REPORT_FETCH_LIMIT\}/);
  assert.match(dispatch, /assertReportSize\(rows, 'delivery register'\)/);
});
