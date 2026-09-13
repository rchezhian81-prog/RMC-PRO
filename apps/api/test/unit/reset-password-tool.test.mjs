/**
 * Guards on the break-glass password reset (scripts/ops/reset-user-password.mjs).
 *
 * WHY IT EXISTS: a Company Admin may reset any staff password from Setup →
 * Users, but not the Company Owner's — deliberately, since otherwise an admin
 * could take the owner's login and with it the company's data. The consequence
 * is that a lone owner who forgets their password cannot be let back in by
 * anyone: not another admin, and not the platform super admin, which has no
 * reset route. This script is the only way back, so its security properties are
 * pinned here rather than assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../../../scripts/ops/reset-user-password.mjs'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

test('the password is taken from the environment, never from an argument', () => {
  // argv is visible to every user on the box through `ps`.
  assert.match(code, /process\.env\.NEW_PASSWORD/);
  assert.ok(!/process\.argv/.test(code), 'a password on the command line is readable by other users');
});

test('it revokes every existing session for that account', () => {
  // A reset that leaves an old refresh token working has not reset anything.
  assert.match(code, /token_version\s*=\s*COALESCE\(token_version, 0\) \+ 1/,
    'token_version must be bumped in the same statement as the hash');
});

test('the hash uses the same cost the API uses', () => {
  const api = readFileSync(resolve(here, '../../src/auth/auth.service.ts'), 'utf8');
  const apiCost = /bcrypt\.hash\([^,]+,\s*(\d+)\)/.exec(api)?.[1];
  const toolCost = /bcrypt\.hash\([^,]+,\s*(\d+)\)/.exec(code)?.[1];
  assert.ok(apiCost, 'could not read the API bcrypt cost');
  assert.equal(toolCost, apiCost, `the tool hashes at cost ${toolCost}, the API at ${apiCost}`);
});

test('it will not set a password the application would reject', () => {
  assert.match(code, /passwordProblems/, 'it must apply the shared password rules');
  // and it must still refuse something weak if the shared package is not built
  assert.match(code, /NEW_PASSWORD\.length < 12/);
});

test('it never prints the password', () => {
  // Naming the variable in help text is fine — "Set EMAIL and NEW_PASSWORD in
  // the environment." Interpolating its VALUE is not. So strip string literals
  // from each console argument before looking, or this flags its own usage text.
  for (const m of code.matchAll(/console\.(log|error)\((.*)\)/g)) {
    const expressions = m[2]
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")      // single-quoted
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')      // double-quoted
      .replace(/`(?:[^`$\\]|\\.)*`/g, '``');    // template with no ${}
    assert.ok(!/NEW_PASSWORD/.test(expressions), `this line would print the password: ${m[0]}`);
  }
  // and the value must never reach a template hole either
  assert.ok(!/\$\{[^}]*NEW_PASSWORD[^}]*\}/.test(code), 'the password must not be interpolated anywhere');
});

test('it refuses when the email matches more than one user', () => {
  assert.match(code, /rows\.length > 1/, 'resetting the wrong account is worse than refusing');
});

test('a dry run changes nothing', () => {
  assert.match(code, /DRY_RUN/);
  const dryAt = code.indexOf('DRY_RUN === ');
  const updateAt = code.indexOf('UPDATE users SET password_hash');
  const exitAt = code.indexOf('DRY_RUN=1 — nothing was changed');
  assert.ok(dryAt > 0 && updateAt > 0 && exitAt > 0 && exitAt < updateAt,
    'the dry-run exit must come before the UPDATE');
});
