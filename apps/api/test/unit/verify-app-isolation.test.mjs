/**
 * Guards on the cross-tenant isolation section of scripts/ops/verify-app.sh.
 *
 * The RLS isolation e2e test runs in CI against synthetic fixtures; this section
 * asks the same question of the DEPLOYED configuration with real tenants, which
 * is the only thing that proves multi-tenancy holds in production.
 *
 * The properties worth pinning are about how it FAILS, not how it passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const verify = readFileSync(resolve(repoRoot, 'scripts/ops/verify-app.sh'), 'utf8');

test('the check is opt-in and skips rather than failing when unconfigured', () => {
  // Every existing deploy check must keep working on a single-tenant install.
  assert.match(verify, /if \[ -z "\$\{LOGIN_B:-\}" \]; then\s*\n\s*skip "tenant isolation"/);
  assert.match(verify, /set LOGIN_B\/PASSWORD_B/);
});

test('it skips when the prerequisites are missing instead of reporting a false failure', () => {
  for (const reason of [/needs the primary login too/, /PASSWORD_B is not set/, /node is not on PATH/, /not found — git pull/]) {
    assert.match(verify, reason);
  }
});

test('REGRESSION: it targets the API host, not the web host', () => {
  // The API lives at api.<domain>; pointing the check at https://$DOMAIN sent it
  // to the web app, where every request would fail for the wrong reason.
  assert.match(verify, /ISO_OUT="\$\(API_URL="\$API"/);
  assert.ok(!/API_URL="https:\/\/\$DOMAIN"/.test(verify), 'must not use the web host');
});

test('a failed check is reported as a failure, with the reason shown', () => {
  assert.match(verify, /bad "tenant isolation"/);
  // On failure the underlying output is printed so the operator can see which
  // check broke — the script emits counts and verdicts only, never tenant data.
  assert.match(verify, /printf '%s\\n' "\$ISO_OUT" \| sed 's\/\^\/ {6}\/'/);
});

test('the isolation section runs before the verdict is printed', () => {
  const sectionAt = verify.indexOf('6. Tenant isolation');
  const verdictAt = verify.indexOf('VERIFY FAILED');
  assert.ok(sectionAt > -1 && verdictAt > sectionAt, 'the verdict must account for this section');
});

test('the extra sign-ins it costs are documented', () => {
  // Enabling it takes the run from one login to three, and /auth/login allows
  // AUTH_THROTTLE_LIMIT (default 5) per minute per IP.
  assert.match(verify, /three sign-ins instead of\s*\n#\s*one/);
  assert.match(verify, /AUTH_THROTTLE_LIMIT/);
});
