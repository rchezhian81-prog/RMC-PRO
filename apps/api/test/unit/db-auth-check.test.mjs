/**
 * Unit tests for the DB auth preflight's pure decision logic
 * (core/database/db-auth-check.ts).
 *
 * The connection I/O can't be unit-tested without a live Postgres, so the file
 * factors the decisions out into pure functions: how a connection error is
 * classified, how per-role outcomes collapse into an exit code, and the operator
 * remediation text. Those are pinned here.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 * (Importing the module does NOT open any connection — main() is guarded behind
 * `require.main === module`, which is false under this ESM import.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConnError,
  overallExitCode,
  remediation,
} from '../../dist/core/database/db-auth-check.js';

test('classifyConnError: a Postgres 28P01 is a definite auth failure', () => {
  assert.equal(classifyConnError({ code: '28P01', message: 'password authentication failed for user "rmc_owner"' }).kind, 'auth');
  // 28000 (invalid authorization spec) is also an auth-class failure.
  assert.equal(classifyConnError({ code: '28000', message: 'no pg_hba.conf entry' }).kind, 'auth');
});

test('classifyConnError: network/DNS errors mean "could not verify", not "wrong password"', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET']) {
    assert.equal(classifyConnError({ code, message: `${code} 10.0.0.1:5432` }).kind, 'unreachable', code);
  }
});

test('classifyConnError: anything else is "other" and keeps a one-line detail', () => {
  const r = classifyConnError({ code: '3D000', message: 'database "rmc" does not exist\n(second line dropped)' });
  assert.equal(r.kind, 'other');
  assert.equal(r.detail, 'database "rmc" does not exist');
});

test('overallExitCode: all roles OK -> 0 (safe to proceed)', () => {
  assert.equal(overallExitCode([{ ok: true }, { ok: true }]), 0);
});

test('overallExitCode: any DEFINITE auth mismatch -> 1 (actionable)', () => {
  assert.equal(overallExitCode([{ ok: true }, { ok: false, kind: 'auth' }]), 1);
  // An auth failure dominates an unreachable one — the auth mismatch is the fixable signal.
  assert.equal(overallExitCode([{ ok: false, kind: 'unreachable' }, { ok: false, kind: 'auth' }]), 1);
});

test('overallExitCode: a failure that is NOT an auth mismatch -> 2 (fail closed)', () => {
  assert.equal(overallExitCode([{ ok: true }, { ok: false, kind: 'unreachable' }]), 2);
  assert.equal(overallExitCode([{ ok: false, kind: 'other' }]), 2);
});

test('remediation: names the role, and offers both the ALTER ROLE and the .env fix', () => {
  const text = remediation('owner (migrations)', 'rmc_owner');
  assert.match(text, /rmc_owner/);
  assert.match(text, /ALTER ROLE "rmc_owner" WITH PASSWORD/);
  assert.match(text, /\.env\.production/);
});
