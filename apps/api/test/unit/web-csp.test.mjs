/**
 * Guards on the web app's Content-Security-Policy (apps/web/next.config.mjs).
 *
 * 'unsafe-eval' was removed after verifying a production Next build does not
 * need it: no file in the client (99) or server (170) output uses `eval(` or
 * `new Function(`, and Chromium loading /, /login and /app under the stricter
 * policy reported zero CSP violations with byte-identical DOM.
 *
 * These pin the directives whose loss would quietly widen the XSS surface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(resolve(here, '../../../../apps/web/next.config.mjs'), 'utf8');

test("script-src does not allow 'unsafe-eval'", () => {
  // Require the space: the doc comment above the policy also backticks the bare
  // word `script-src`, and matching that captures nothing and proves nothing.
  const scriptSrc = /`script-src ([^`]*)`/.exec(config)?.[1] ?? '';
  assert.ok(scriptSrc.length > 0, 'script-src must be present');
  assert.ok(!scriptSrc.includes('unsafe-eval'), `script-src must not allow unsafe-eval: ${scriptSrc}`);
});

test('the directives that contain an XSS are still present', () => {
  // connect-src confines exfiltration; the rest close the plugin, base-tag and
  // framing vectors. Losing any of them is silent until it matters.
  for (const directive of ['connect-src', `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`]) {
    assert.ok(config.includes(directive), `CSP must keep ${directive}`);
  }
});

test('the policy is actually attached to every route', () => {
  assert.match(config, /source: '\/\(\.\*\)'/);
  assert.match(config, /key: 'Content-Security-Policy'/);
});
