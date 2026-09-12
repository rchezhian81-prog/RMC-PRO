/**
 * Guards on the interactive onboarding wizard (scripts/setup/onboard-tenant.sh).
 *
 * The wizard exists so that adding a tenant does not require assembling a
 * multi-line shell command by hand — the failure mode that actually bit us was
 * placeholder values and lost environment variables, not the API.
 *
 * Pinned here are the properties that keep it safe to hand to a non-engineer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const wizard = readFileSync(resolve(repoRoot, 'scripts/setup/onboard-tenant.sh'), 'utf8');

test('nothing is created before an explicit confirmation', () => {
  const confirmAt = wizard.indexOf('ask CONFIRM');
  // Match the INVOCATION, not the earlier existence check for the same filename.
  const createAt = wizard.indexOf('node "$REPO_ROOT/scripts/setup/provision-tenant.mjs"');
  assert.ok(confirmAt > -1, 'the wizard must ask for confirmation');
  assert.ok(createAt > confirmAt, 'provisioning must happen AFTER the confirmation');
  assert.match(wizard, /Nothing was created/);
});

test('unreplaced placeholder values are refused', () => {
  // Entering the example text from a chat message must not create a tenant
  // literally named "<the actual company name>".
  assert.match(wizard, /\*'<'\*\|\*'>'\*/);
  assert.match(wizard, /still contains < > /);
});

test('api_login sets globals instead of echoing the token', () => {
  // REGRESSION: called in a command substitution it runs in a subshell, so a
  // status code assigned inside never reaches the caller — which turned
  // "that password is not right" into a useless "HTTP ?".
  assert.match(wizard, /LOGIN_TOKEN=''/);
  assert.match(wizard, /if api_login "\$ADMIN_EMAIL" "\$ADMIN_PW"; then/);
  assert.ok(
    !/TOKEN="\$\(api_login/.test(wizard),
    'api_login must not be called in a command substitution',
  );
});

test('a failed sign-in points at the reset path rather than dead-ending', () => {
  assert.match(wizard, /recover-login\.sh --set-password/);
  assert.match(wizard, /that password is not right/);
});

test('the rate limiter and an unreachable stack are explained, not just reported', () => {
  assert.match(wizard, /429\)/);
  assert.match(wizard, /brute-force guard/);
  assert.match(wizard, /000\)/);
  assert.match(wizard, /cannot reach/);
});

test('generated passwords satisfy the shared policy', () => {
  // 16 letters + 4 digits clears >= 10 chars, a letter, a digit, and cannot
  // begin with a common word.
  assert.match(wizard, /tr -dc 'A-Za-z' <\/dev\/urandom \| head -c 16/);
  assert.match(wizard, /tr -dc '0-9'\s+<\/dev\/urandom \| head -c 4/);
});

test('the wizard refuses stray arguments like the deploy scripts', () => {
  assert.match(wizard, /lib-args\.sh/);
  assert.match(wizard, /reject_positional_args "\$@"/);
});
