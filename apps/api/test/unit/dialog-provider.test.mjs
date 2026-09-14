/**
 * Every screen that asks a question has the dialog provider above it.
 *
 * `useConfirm()` throws unless a `<ConfirmProvider>` is mounted in an enclosing
 * layout. The app shell mounts one; the admin shell did not, and the first
 * admin screen converted from `window.confirm` to the hook would have thrown on
 * render — the page that suspends a company. Typecheck cannot see this: a
 * hook's provider is a runtime fact, not a type. So it is pinned here: for each
 * page that calls the hook, walk up to the nearest layout that mounts the
 * provider, and fail if there is none.
 *
 * The companion rule — that no screen still uses the native dialogs the hook
 * replaced — is pinned alongside, since one page slipping back to
 * `window.confirm` is invisible to everything but a person clicking it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, '../../../../apps/web/src');
const appDir = resolve(webSrc, 'app');

/** Comment bodies blanked (positions kept), so these read code and not prose. */
const codeOnly = (src) => {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

test('every screen calling useConfirm() sits under a layout that mounts ConfirmProvider', () => {
  const pages = walk(appDir).filter((f) => f.endsWith('page.tsx') && /useConfirm\(/.test(codeOnly(readFileSync(f, 'utf8'))));
  assert.ok(pages.length > 0, 'expected at least one screen to use useConfirm');
  const unprovided = [];
  for (const page of pages) {
    let dir = dirname(page);
    let covered = false;
    for (;;) {
      const layout = resolve(dir, 'layout.tsx');
      if (existsSync(layout) && /<ConfirmProvider>/.test(codeOnly(readFileSync(layout, 'utf8')))) { covered = true; break; }
      if (dir === appDir) break;
      dir = dirname(dir);
    }
    if (!covered) unprovided.push(page.slice(webSrc.length + 1));
  }
  assert.deepEqual(
    unprovided,
    [],
    `these call useConfirm() with no <ConfirmProvider> in any enclosing layout: ${unprovided.join(', ')}`,
  );
});

test('no screen uses the native confirm/alert/prompt the dialog replaced', () => {
  const offenders = [];
  for (const f of walk(webSrc)) {
    if (f.endsWith('ConfirmDialog.tsx')) continue;
    const code = codeOnly(readFileSync(f, 'utf8'));
    // Native calls: a bare `confirm(` / `alert(` / `prompt(` not preceded by
    // `.` (a method) or an identifier character, or the explicit window.* form.
    if (/(^|[^.\w])(confirm|alert|prompt)\(\s*[`'"]/.test(code) || /window\.(confirm|alert|prompt)\(/.test(code)) {
      offenders.push(f.slice(webSrc.length + 1));
    }
  }
  assert.deepEqual(offenders, [], `native dialogs remain in: ${offenders.join(', ')} — use useConfirm() from components/ui/ConfirmDialog`);
});
