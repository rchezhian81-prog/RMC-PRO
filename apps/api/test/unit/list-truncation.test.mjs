/**
 * Guards on SILENT list truncation.
 *
 * THE BUG THIS EXISTS TO PREVENT: transaction lists are capped server-side so
 * one plant-year of invoices cannot arrive as a 31 MB response. The cap was
 * silent — the endpoint returned a bare array, so a screen that received 200
 * rows could not tell whether that was all of them. On a list with no filter
 * (invoices, receipts, vendor bills) the 201st record was unreachable from
 * anywhere in the UI, and nothing on screen admitted it. In an accounting
 * system a list that quietly stops at 200 is a wrong answer, not a slow one.
 *
 * Three invariants, checked repo-wide rather than against a fixed list of
 * files, because fixing one screen and missing its siblings is precisely how
 * this class of bug keeps returning here:
 *
 *   1. A capped read is escapable   — every `take:` is `listLimit(limit)`.
 *   2. Client and server agree      — every web call that sends `?limit=` hits
 *                                     a controller that reads it.
 *   3. The user is told             — every screen on a capped list renders
 *                                     <ListCap> and re-fetches when widened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');

function walk(dir, ext, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push({ path: p, rel: relative(root, p), src: readFileSync(p, 'utf8') });
  }
  return out;
}

const apiSrc = walk(resolve(root, 'apps/api/src'), '.ts');
const webSrc = walk(resolve(root, 'apps/web/src'), '.tsx').concat(walk(resolve(root, 'apps/web/src'), '.ts'));

/**
 * The one documented exception: a GPS trip trail is read oldest-first and must
 * not be cut in the middle of a journey, so it is bounded generously and on
 * purpose rather than by the shared list window.
 */
const TAKE_EXCEPTIONS = [/take: 5000,/];

test('every capped read can be widened — no magic-number take:', () => {
  const offenders = [];
  for (const f of apiSrc) {
    for (const m of f.src.matchAll(/take: ([^,\n)]+)/g)) {
      const value = m[1].trim();
      if (/^listLimit\(/.test(value)) continue;            // the shared window
      if (/^(capped|clampLimit\()/.test(value)) continue;  // already a bounded variable
      // `take: 1` (or 2) is a single-record probe — "does one exist", "is it
      // the only one" — not a list, so it has nothing to widen.
      const literal = Number(/^(\d+)\b/.exec(value)?.[1]);
      if (Number.isFinite(literal) && literal <= 2) continue;
      const line = f.src.slice(0, m.index).split('\n').length;
      const whole = `take: ${value}`;
      if (TAKE_EXCEPTIONS.some((re) => re.test(whole + ','))) continue;
      offenders.push(`${f.rel}:${line}  take: ${value}`);
    }
  }
  assert.deepEqual(offenders, [], 'a hard-coded take: caps a list with no way for the screen to widen it');
});

test('every ?limit= the web client sends is honoured by a controller', () => {
  const api = readFileSync(resolve(root, 'apps/web/src/lib/api.ts'), 'utf8');
  const routes = new Set();
  for (const m of api.matchAll(/apiFetch<[^>]*>\(`\/([a-z0-9\-/]+)\$\{listQs\(/g)) routes.add(m[1]);
  for (const m of api.matchAll(/qs\.set\('limit'[\s\S]{0,400}?apiFetch<[^>]*>\(`\/([a-z0-9\-/]+)\$/g)) routes.add(m[1]);
  assert.ok(routes.size >= 25, `expected the list client to be found, saw ${routes.size}`);

  const honoured = new Map();
  for (const f of apiSrc) {
    if (!f.rel.includes('.controller')) continue;
    for (const m of f.src.matchAll(/@Controller\('([a-z0-9\-/]+)'\)/g)) {
      const nxt = f.src.slice(m.index + m[0].length).search(/@Controller\('/);
      const end = nxt === -1 ? f.src.length : m.index + m[0].length + nxt;
      const block = f.src.slice(m.index, end);
      honoured.set(m[1], (honoured.get(m[1]) ?? false) || block.includes("@Query('limit')"));
    }
  }
  const deaf = [...routes].filter((r) => !(honoured.get(r) ?? honoured.get(r.split('/')[0]) ?? false));
  assert.deepEqual(deaf, [], 'the screen would offer a "Show more" the server ignores');
});

test('every screen on a capped list tells the user and can widen', () => {
  const screens = webSrc.filter((f) => f.rel.endsWith('page.tsx') && f.src.includes('useListWindow'));
  assert.ok(screens.length >= 25, `expected the capped list screens to be found, saw ${screens.length}`);
  for (const f of screens) {
    assert.match(f.src, /<ListCap\b/, `${f.rel} takes a list window but never says the list is capped`);
    assert.match(f.src, /win\.limit\]/, `${f.rel} must re-fetch when the window widens`);
    assert.match(f.src, /win\.limit[,)]/, `${f.rel} must send its current window to the API`);
  }
  // and the converse: no screen renders the notice without a window to drive it
  for (const f of webSrc.filter((x) => x.src.includes('<ListCap'))) {
    assert.match(f.src, /useListWindow\(/, `${f.rel} renders <ListCap> with no window`);
  }
});

test('the list window agrees with the API it is describing', () => {
  const web = readFileSync(resolve(root, 'apps/web/src/lib/list-window.ts'), 'utf8');
  const api = readFileSync(resolve(root, 'apps/api/src/common/list-limit.util.ts'), 'utf8');
  const pick = (s, name) => Number(new RegExp(`${name} = (\\d+)`).exec(s)?.[1]);
  assert.equal(pick(web, 'LIST_PAGE'), pick(api, 'DEFAULT_LIST_LIMIT'), 'the page size the screen assumes must be the API default');
  assert.equal(pick(web, 'LIST_MAX'), pick(api, 'MAX_LIST_LIMIT'), 'the ceiling the screen offers must be the API ceiling');
});

test('no screen promises an export the export does not contain', () => {
  // The stock ledger used to be titled "latest 200 (export for the full set)",
  // while ExportButton only ever writes the rows already loaded.
  for (const f of webSrc) {
    assert.ok(!/export for the full set/.test(f.src), `${f.rel} promises a complete export it cannot deliver`);
  }
});
