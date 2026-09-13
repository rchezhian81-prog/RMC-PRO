/**
 * Two things found by driving the real app in a browser at phone width rather
 * than reading the CSS.
 *
 * 1. PAGES SCROLLED SIDEWAYS. `Table` wraps itself in `overflow-x: auto`, so a
 *    wide table is supposed to scroll inside its card. It did not. Most screens
 *    lay their cards out in a `display: grid` wrapper, and a grid (or flex)
 *    item defaults to `min-width: auto` — it refuses to shrink below its
 *    content's intrinsic width. The card therefore grew to fit the table, the
 *    grid track grew to fit the card, and the whole PAGE scrolled sideways,
 *    dragging the heading and every other card with it.
 *
 *    Measured at 400px before: Delivery Register 517px wide, Stock 593px, and
 *    Billing Reports 901px at a 768px tablet. After `minWidth: 0` on the card:
 *    all 39 screen/width checks fit exactly, and 35 wide tables scroll inside
 *    their own card.
 *
 * 2. DATES WERE RAW. The delivery register printed "2026-09-13T00:00:00.000Z"
 *    in the date column of the screen a manager reads every morning — and that
 *    string was a large part of why the table was too wide. Nineteen screens
 *    now format through one helper: 13/09/2026, and that table narrowed from
 *    490px to 443px.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, '../../../../apps/web/src');

function tsx(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsx(p, out);
    else if (e.name.endsWith('.tsx')) out.push({ rel: relative(webSrc, p), src: readFileSync(p, 'utf8') });
  }
  return out;
}
const ALL = tsx(webSrc);

test('a card can shrink, so a wide table scrolls instead of the page', () => {
  const card = readFileSync(resolve(webSrc, 'components/ui/Card.tsx'), 'utf8');
  const sections = [...card.matchAll(/<section className="mn-card" style=\{([^}]*\}?[^}]*)\}/g)];
  assert.ok(sections.length >= 2, `expected both card variants, found ${sections.length}`);
  for (const m of sections) {
    assert.match(m[1], /minWidth: 0/,
      'without min-width:0 a grid item grows to its content and the table scroller never engages');
  }
  // and the caller's own style must still win if it sets one
  assert.match(card, /minWidth: 0, \.\.\.style/, 'a caller-supplied style must override, not be overridden');
});

test('the table still provides its own horizontal scroller', () => {
  const t = readFileSync(resolve(webSrc, 'components/ui/Table.tsx'), 'utf8');
  assert.match(t, /overflowX: 'auto'/);
  assert.match(t, /width: '100%'/);
});

test('no screen prints a raw date value', () => {
  const offenders = [];
  for (const f of ALL) {
    for (const m of f.src.matchAll(/<Td[^>]*>\{String\(r\.([a-zA-Z]*[Dd]ate[a-zA-Z]*|date)\s*\?\?/g)) {
      offenders.push(`${f.rel}: r.${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'these render a date straight from the API — use formatDate');
});

test('the screens that show dates use the shared helper', () => {
  const users = ALL.filter((f) => /formatDate\(/.test(f.src));
  assert.ok(users.length >= 19, `expected the date screens to use it, saw ${users.length}`);
  for (const f of users) {
    assert.match(f.src, /from '.*lib\/format-date'/, `${f.rel} must import the helper`);
  }
});

test('a bare calendar date never shifts by a timezone', async () => {
  // "2026-01-01" from a DATE column has no time and no zone. Passing it through
  // new Date() makes it UTC midnight, which in a timezone BEHIND UTC renders as
  // 31/12 — an invoice dated the 1st showing as the previous month.
  const ts = require('typescript');
  const srcTs = readFileSync(resolve(webSrc, 'lib/format-date.ts'), 'utf8');
  const js = ts.transpileModule(srcTs, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', js)(mod.exports, mod);
  const { formatDate, formatDateTime } = mod.exports;

  assert.equal(formatDate('2026-09-13T00:00:00.000Z'), '13/09/2026', 'a timestamp renders as a date');
  assert.equal(formatDate('2026-09-13'), '13/09/2026');
  assert.equal(formatDate('2026-01-01'), '01/01/2026');
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(''), '—');
  assert.equal(formatDate('not a date'), 'not a date', 'never show "Invalid Date"');
  assert.equal(formatDateTime('2026-09-13'), '13/09/2026', 'a date column has no time to show');

  // The bare-date path must not go through Date at all.
  assert.ok(!/new Date\(raw\)[\s\S]{0,200}BARE_DATE/.test(srcTs));
  assert.match(srcTs, /BARE_DATE\.exec\(raw\)[\s\S]{0,160}return `\$\{bare\[3\]\}\/\$\{bare\[2\]\}\/\$\{bare\[1\]\}`/,
    'a bare date must be reformatted by string surgery, not parsed');
});
