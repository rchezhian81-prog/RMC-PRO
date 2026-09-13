/**
 * Guards on error text a PERSON reads.
 *
 * Framework defaults leak jargon. Nest's throttler answers "ThrottlerException:
 * Too Many Requests" — which is what a plant manager who mistyped their
 * password five times was being shown. It reads like a crash, and it omits the
 * one useful fact: wait a moment. Express answers an unrouted path with
 * "Cannot GET /api/v1/whatever", which means nothing to a user and echoes our
 * route shape back at whoever probed it.
 *
 * Verified live: 6th bad login → "Too many attempts. Please wait a minute and
 * try again."; GET /api/v1/does-not-exist → "That page or record could not be
 * found."; while a real missing record still says "Invoice not found".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const filter = readFileSync(resolve(here, '../../src/common/error.filter.ts'), 'utf8');

test('a rate-limited user is told to wait, not shown an exception name', () => {
  assert.match(filter, /HttpStatus\.TOO_MANY_REQUESTS/, 'the filter must intercept 429');
  assert.match(filter, /Too many attempts\. Please wait a minute and try again\./);
  // The rewrite must come BEFORE the generic HttpException branch, or the
  // framework's own message wins.
  const rate = filter.indexOf('TOO_MANY_REQUESTS');
  const generic = filter.indexOf('if (!(exception instanceof HttpException))');
  assert.ok(rate > 0 && generic > 0 && rate < generic, 'the 429 rewrite must precede the generic passthrough');
});

test('an unrouted path does not echo the route back', () => {
  assert.match(filter, /Cannot \[A-Z\]\+ \\\//, 'the filter must recognise Express’s "Cannot GET /x"');
  assert.match(filter, /That page or record could not be found\./);
});

test('a real missing record keeps its own wording', () => {
  // The rewrite is gated on the Express message shape, so a NotFoundException
  // carrying "Invoice not found" must pass through untouched.
  const gate = /status === HttpStatus\.NOT_FOUND && \/\^Cannot \[A-Z\]\+ \\\/\/\.test\(/;
  assert.match(filter, gate, 'the 404 rewrite must be gated on the Express message, not on the status alone');
});

test('a 500 never leaks its cause', () => {
  assert.match(filter, /status >= 500[\s\S]{0,120}Something went wrong\. Please try again\./);
});
