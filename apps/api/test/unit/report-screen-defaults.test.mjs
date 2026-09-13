/**
 * Guards on how the report SCREENS load (apps/web).
 *
 * #256 made the registers refuse a window wider than 5,000 rows, because a
 * partial register is a wrong total rather than a slow one. That created a
 * hazard on the web side, which these pin:
 *
 *   1. Both report screens mounted with `{ from: '', to: '' }` — asking the API
 *      for everything. Past ~5,000 rows the first paint would be an error.
 *   2. The billing screen fired EIGHT reports through Promise.all, so one
 *      refusal rejected the lot and blanked seven reports that had answered.
 *
 * Verified against a live API at realistic volume (50,000 challans over 1,111
 * days): the default month window returns 547 rows in 27ms, HTTP 200.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const web = (p) => readFileSync(resolve(root, 'apps/web/src', p), 'utf8');

const SCREENS = [
  'app/app/billing/reports/page.tsx',
  'app/app/dispatch/delivery-register/page.tsx',
];

test('report screens open on a bounded window, not on "everything"', () => {
  for (const f of SCREENS) {
    const s = web(f);
    assert.match(s, /useState\(currentMonthRange\(\)\)/, `${f} must default its range`);
    assert.ok(
      !/useState\(\{ from: '', to: '' \}\)/.test(s),
      `${f} must not mount with an empty range — that asks the API for every row`,
    );
  }
});

test('one failing report does not blank the others', () => {
  for (const f of SCREENS) {
    const s = web(f);
    assert.match(s, /Promise\.allSettled\(/, `${f} must use allSettled`);
    assert.ok(!/await Promise\.all\(\[/.test(s), `${f} must not use Promise.all for independent reports`);
  }
});

test('a refusal is surfaced to the user, not swallowed', () => {
  for (const f of SCREENS) {
    const s = web(f);
    assert.match(s, /status === 'rejected'/, `${f} must inspect rejections`);
    assert.match(s, /setError\(/, `${f} must show the reason`);
  }
});

test('the default range helper is shared, not copied per screen', () => {
  for (const f of SCREENS) {
    assert.match(web(f), /from '.*lib\/report-range'/, `${f} must import the shared helper`);
  }
  const helper = web('lib/report-range.ts');
  assert.match(helper, /export function currentMonthRange/);
  assert.match(helper, /export function financialYearRange/);
});
