/**
 * The company's state is chosen from the GST state list, not typed — on the
 * screen and at the API. Customers and sites already chose theirs; the company
 * typed its own, and a typo could not be resolved to a state code, so the
 * inter-state decision fell back to comparing names and every local sale was
 * taxed as inter-state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the company screen offers the state list; the API refuses an unknown state', () => {
  const page = codeOnly(readFileSync(resolve(repoRoot, 'apps/web/src/app/app/company/page.tsx'), 'utf8'));
  assert.match(page, /GST_STATE_NAMES\.map\(/, 'the select is built from the shared state list');
  assert.match(page, /k === 'state' \?/, 'and it is the state field that gets it');
  const shared = codeOnly(readFileSync(resolve(repoRoot, 'packages/shared/src/validation.ts'), 'utf8'));
  const fn = shared.slice(shared.indexOf('export function validateCompanyProfile'));
  assert.match(fn, /isKnownGstState\(state\)/, 'validateCompanyProfile checks the state against the same list');
});
