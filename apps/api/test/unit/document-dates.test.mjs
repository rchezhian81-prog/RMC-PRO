/**
 * Every document that happened has a date.
 *
 * THE BUG: a document's date was stored as `?? null` when the caller omitted
 * it, and the web forms make the date field optional. A ₹50,000 cash receipt
 * entered without picking a date was saved with NO date — and then vanished
 * from the receipts register and the cash/bank day book, both of which bound by
 * date, while still reducing the customer's outstanding. Money collected,
 * missing from the report the day's cash is reconciled against.
 *
 * Measured before: receipts register 0 rows / ₹0 and day book inflow ₹0, while
 * the table held ₹1,59,296 across three receipts, two of them undated.
 * After: the same undated entry is dated automatically and shows up in both.
 *
 * AND THE TIMEZONE: "today" meant UTC. A plant pours at night, and a receipt
 * taken at 2am in India is 20:30 the PREVIOUS day in UTC — it would be filed
 * under yesterday and land in the wrong day's collections.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = resolve(here, '../../src');

function ts(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) ts(p, out);
    else if (e.name.endsWith('.ts')) out.push({ path: p, src: readFileSync(p, 'utf8') });
  }
  return out;
}
const ALL = ts(apiSrc);

/** Dates that are legitimately unknown when the document is created. */
const MAY_BE_NULL = new Set(['expectedDate', 'dueDate', 'completedDate']);

test('a document date is never stored as null', () => {
  const offenders = [];
  for (const f of ALL) {
    for (const m of f.src.matchAll(/(\w*[Dd]ate)\w*: \(dto\.\w+ as string\) \?\? null/g)) {
      if (MAY_BE_NULL.has(m[1])) continue;
      offenders.push(`${f.path.slice(apiSrc.length + 1)}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'an undated document disappears from every date-bounded report');
});

test('a future or unknown date may still be null', () => {
  // The opposite mistake: defaulting an expected delivery date to today would
  // assert something nobody said.
  const src = ALL.map((f) => f.src).join('\n');
  for (const field of MAY_BE_NULL) {
    assert.match(src, new RegExp(`${field}: \\(dto\\.\\w+ as string\\) \\?\\? null`),
      `${field} is not known at creation and must stay nullable`);
  }
});

test('today means the plant’s day, not UTC', () => {
  const ts = require('typescript');
  const srcTs = readFileSync(resolve(apiSrc, 'common/business-date.util.ts'), 'utf8');
  const js = ts.transpileModule(srcTs, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'process', js)(mod.exports, mod, process);
  const { businessToday, documentDate } = mod.exports;

  // 20:30 UTC on the 13th is 02:00 on the 14th in India.
  const nightShift = new Date('2026-09-13T20:30:00Z');
  assert.equal(nightShift.toISOString().slice(0, 10), '2026-09-13', 'UTC would call this the 13th');
  assert.equal(businessToday(nightShift), '2026-09-14', 'the plant is already on the 14th');

  // And the financial-year boundary, where a day's error changes the FY.
  assert.equal(businessToday(new Date('2026-03-31T23:59:00Z')), '2026-04-01');

  assert.equal(documentDate('2026-01-05', nightShift), '2026-01-05', 'a supplied date wins');
  assert.equal(documentDate('', nightShift), '2026-09-14');
  assert.equal(documentDate('   ', nightShift), '2026-09-14');
  assert.equal(documentDate(null, nightShift), '2026-09-14');
  assert.equal(documentDate(undefined, nightShift), '2026-09-14');
});

test('the backfill repairs old rows and only old rows', () => {
  const m = readFileSync(resolve(apiSrc, 'core/database/migrations/1720000068000-BackfillDocumentDates.ts'), 'utf8');
  assert.match(m, /IS NULL/, 'it must only touch rows that have no date');
  assert.match(m, /created_at AT TIME ZONE 'Asia\/Kolkata'/, 'and use the plant day, not UTC');
  for (const t of ['payments', 'orders', 'purchase_orders', 'vendor_payments', 'goods_receipts', 'vendor_bills', 'expense_vouchers'])
    assert.match(m, new RegExp(`'${t}'`), `${t} must be repaired too`);
  // registered, or it never runs
  const ds = readFileSync(resolve(apiSrc, 'core/database/data-source.ts'), 'utf8');
  assert.match(ds, /BackfillDocumentDates1720000068000,/, 'the migration must be in the data source list');
});

test('no business decision is made on the UTC date', () => {
  // A plant pours at night. Anywhere the server asks "what day is it?" to date
  // a document, decide a financial year, or judge a block's age, it must ask in
  // the plant's timezone — on 1 April before 05:30 IST a UTC clock still says
  // 31 March, which is the one morning of the year when the answer changes the
  // financial year a document number is drawn in.
  const offenders = [];
  for (const f of ALL) {
    const rel = f.path.slice(apiSrc.length + 1);
    if (rel.includes('fake.provider')) continue;      // a test double, not a plant
    if (rel.includes('business-date.util')) continue; // the fallback lives here
    if (/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(f.src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'use businessToday() / documentDate() instead of the UTC date');
});

test('the financial year of a document number is the plant\u2019s', () => {
  const numbering = readFileSync(resolve(apiSrc, 'sales/numbering.service.ts'), 'utf8');
  assert.match(numbering, /financialYearOf\(opts\.date \?\? businessToday\(\)\)/,
    'a number drawn at 2am on 1 April must belong to the NEW financial year');
  const sync = readFileSync(resolve(apiSrc, 'sync/sync.service.ts'), 'utf8');
  assert.match(sync, /financialYearOf\(businessToday\(\)\)/,
    "a device's reserved block must be judged against the plant's financial year");
});
