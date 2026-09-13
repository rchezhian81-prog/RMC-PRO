/**
 * Guards on how the report SCREENS load (apps/web).
 *
 * #256 made the registers refuse a window wider than 5,000 rows, because a
 * partial register is a wrong total rather than a slow one. That created two
 * hazards on the web side, which these pin:
 *
 *   1. Report screens mounted with `{ from: '', to: '' }` — asking the API for
 *      every row the tenant has ever written. Past the cap that makes the very
 *      first paint an error, for a user who has typed nothing yet.
 *   2. Several screens fetched many independent reports through Promise.all, so
 *      ONE refusal rejected the batch and blanked every panel, including the
 *      ones that answered.
 *
 * The scan below is deliberately repo-wide rather than a fixed list: a screen
 * added later with an empty default range fails this test, instead of being
 * found in production. Fixing one screen and missing its siblings is the
 * failure mode this file exists to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const webSrc = resolve(root, 'apps/web/src');

/** Every .tsx under apps/web/src, as { path, rel, src }. */
function screens() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) out.push({ path: p, rel: relative(webSrc, p), src: readFileSync(p, 'utf8') });
    }
  };
  walk(webSrc);
  return out;
}

const ALL = screens();

/**
 * Source with comments removed. These guards must read CODE: the comment above
 * a rule naturally quotes the wrong form it forbids, and a guard that matches
 * its own explanation is worthless in both directions — it can pass when the
 * behaviour is gone, and fail when only the prose changed.
 */
const readCode = (path) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no screen mounts with an empty date range', () => {
  // An empty range means "every row you have" — the one request the API caps.
  const bad = ALL.filter((f) => /useState\(\s*\{\s*from:\s*''\s*,\s*to:\s*''\s*\}\s*\)/.test(f.src));
  assert.deepEqual(bad.map((f) => f.rel), [], 'these screens open on an unbounded range; use currentMonthRange()');
});

test('every screen with a date range defaults it from the shared helper', () => {
  const ranged = ALL.filter((f) => /const \[range, setRange\] = useState\(/.test(f.src));
  assert.ok(ranged.length >= 9, `expected the ranged report screens to be found, saw ${ranged.length}`);
  for (const f of ranged) {
    assert.match(f.src, /useState\(currentMonthRange\(\)\)/, `${f.rel} must default its range`);
    assert.match(f.src, /from '.*lib\/report-range'/, `${f.rel} must import the shared helper, not copy it`);
  }
});

test('screens that fetch several independent reports use allSettled', () => {
  // Promise.all is fine for a detail page that needs both halves to render
  // anything. It is not fine on a report screen, where each panel stands alone.
  const reportScreens = ALL.filter((f) => /\/reports\/page\.tsx$|register\/page\.tsx$|utilization\/page\.tsx$/.test(f.rel));
  assert.ok(reportScreens.length >= 8, `expected the report screens to be found, saw ${reportScreens.length}`);
  for (const f of reportScreens) {
    if (!/await Promise\.(all|allSettled)\(/.test(f.src)) continue; // single-report screen
    assert.match(f.src, /await Promise\.allSettled\(/, `${f.rel} must use allSettled`);
    assert.ok(!/await Promise\.all\(\[/.test(f.src), `${f.rel} must not use Promise.all — one refusal would blank every panel`);
  }
});

test('a settled batch always reports its failures to the user', () => {
  for (const f of ALL) {
    if (!/await Promise\.allSettled\(/.test(f.src)) continue;
    assert.match(f.src, /settledFailure\(/, `${f.rel} must surface failures via settledFailure`);
    assert.match(f.src, /setError\(/, `${f.rel} must show the reason`);
  }
});

test('the range and settled helpers live in one place', () => {
  const helper = readFileSync(resolve(webSrc, 'lib/report-range.ts'), 'utf8');
  for (const fn of ['currentMonthRange', 'financialYearRange', 'settledValue', 'settledFailure']) {
    assert.match(helper, new RegExp(`export function ${fn}\\b`), `report-range.ts must export ${fn}`);
  }
});

test('the range helper computes the windows it claims to', () => {
  // Node cannot import .ts, and every other source-scanning test here is
  // regex-based, so pin the arithmetic by shape. The behaviour itself is
  // exercised by tsc and by the build.
  const src = readCode(resolve(webSrc, 'lib/report-range.ts'));
  assert.match(src, /new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\)/,
    'currentMonthRange must start at the first of the current month');
  assert.match(src, /now\.getMonth\(\) >= 3/, 'the Indian financial year must start in April');
  // Local calendar date, not UTC: in IST a UTC "today" is yesterday until
  // 05:30, so a night-shift operator on the 1st would be shown last month.
  assert.ok(!/toISOString\(\)/.test(src), 'the range must be built from local date parts, not toISOString');
  assert.ok(!/getUTC/.test(src), 'the range must not use UTC getters');
  assert.match(src, /\$\{startYear\}-04-01/, 'the financial year must run 1 April');
  assert.match(src, /\$\{startYear \+ 1\}-03-31/, 'to 31 March');
});

test('no screen derives a date it sends to the API from UTC', () => {
  // `new Date().toISOString().slice(0, 10)` is UTC. In IST that names YESTERDAY
  // until 05:30, so a goods receipt or purchase bill keyed at 2am was filed a
  // day early — and on 1 April, a FINANCIAL YEAR early, into the wrong GST
  // period. The server defaults a missing date to the plant's today, but a
  // client that sends an explicit wrong date is believed, so the client has to
  // be right too.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const src = readCode(full);
      if (/new Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/.test(src)) {
        offenders.push(full.slice(webSrc.length + 1));
      }
    }
  };
  walk(webSrc);
  assert.deepEqual(
    offenders,
    [],
    `these build a date from UTC — use todayLocal() from lib/report-range: ${offenders.join(', ')}`,
  );
});

test('todayLocal is the plant\'s date, never UTC-shifted', () => {
  const src = readCode(resolve(webSrc, 'lib/report-range.ts'));
  assert.match(src, /export function todayLocal\b/, 'report-range.ts must export todayLocal');
  assert.ok(!/toISOString\(\)/.test(src), 'and must build it from local date parts');
});
