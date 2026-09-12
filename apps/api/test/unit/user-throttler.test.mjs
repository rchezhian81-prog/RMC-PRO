/**
 * Unit tests for the per-user rate-limit tracker.
 *
 * THE DEFECT: the stock ThrottlerGuard keys on the client IP, so a plant office
 * behind one NAT address shared a single 100-req/min bucket across all its
 * staff — a few people working normally exhausted it and the whole site started
 * getting 429s.
 *
 * THE RISK IN THE FIX: this guard is a global APP_GUARD, so it runs before
 * JwtAuthGuard and must read the identity out of the Authorization header
 * itself. If it merely DECODED the token, anyone could claim an arbitrary `sub`
 * and mint unlimited fresh buckets — turning the rate limiter off entirely.
 * The forged/expired/malformed cases below are the tests that matter most.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { bearerToken, resolveTracker } from '../../dist/common/user-throttler.guard.js';

const require = createRequire(import.meta.url);
const { JwtService } = require('@nestjs/jwt');

const here = dirname(fileURLToPath(import.meta.url));
const appModule = readFileSync(resolve(here, '../../src/app.module.ts'), 'utf8');

const SECRET = 'unit-test-access-secret-long-enough';
const jwt = new JwtService({});
const sign = (payload, opts = {}) => jwt.sign(payload, { secret: SECRET, expiresIn: '5m', ...opts });
/** The real verifier the guard uses, bound to the test secret. */
const verify = (token) => jwt.verifyAsync(token, { secret: SECRET });

// ── header parsing ───────────────────────────────────────────────────────────

test('bearerToken pulls the token and tolerates casing and padding', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('  Bearer   abc.def.ghi  '), 'abc.def.ghi');
});

test('bearerToken rejects anything that is not a bearer header', () => {
  for (const h of ['', '   ', 'Basic abc', 'Bearer', 'Bearer ', 'abc.def.ghi', null, undefined, 42]) {
    assert.equal(bearerToken(h), null, String(h));
  }
});

// ── the bucket decision ──────────────────────────────────────────────────────

test('a valid token buckets by user', async () => {
  const token = sign({ sub: 'user-1', tid: 't1' });
  assert.equal(await resolveTracker(`Bearer ${token}`, '203.0.113.5', verify), 'user:user-1');
});

test('THE FIX: two users behind one office IP get separate buckets', async () => {
  const ip = '203.0.113.5';
  const a = await resolveTracker(`Bearer ${sign({ sub: 'user-a' })}`, ip, verify);
  const b = await resolveTracker(`Bearer ${sign({ sub: 'user-b' })}`, ip, verify);
  assert.notEqual(a, b);
  assert.equal(a, 'user:user-a');
  assert.equal(b, 'user:user-b');
});

test('one user roaming between networks keeps ONE bucket', async () => {
  const token = sign({ sub: 'user-1' });
  const office = await resolveTracker(`Bearer ${token}`, '203.0.113.5', verify);
  const mobile = await resolveTracker(`Bearer ${token}`, '198.51.100.9', verify);
  assert.equal(office, mobile);
});

// ── no bypass ────────────────────────────────────────────────────────────────

test('NO BYPASS: a token signed with the wrong secret falls back to the IP bucket', async () => {
  // The whole rate limiter would be off if a forged sub were trusted.
  const forged = jwt.sign({ sub: 'anything-i-like' }, { secret: 'not-the-real-secret', expiresIn: '5m' });
  assert.equal(await resolveTracker(`Bearer ${forged}`, '203.0.113.5', verify), 'ip:203.0.113.5');
});

test('NO BYPASS: an unsigned/alg-none style token falls back to the IP bucket', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
  assert.equal(await resolveTracker(`Bearer ${header}.${body}.`, '203.0.113.5', verify), 'ip:203.0.113.5');
});

test('an expired token falls back to the IP bucket', async () => {
  const expired = sign({ sub: 'user-1' }, { expiresIn: '-1s' });
  assert.equal(await resolveTracker(`Bearer ${expired}`, '203.0.113.5', verify), 'ip:203.0.113.5');
});

test('a garbage token falls back to the IP bucket', async () => {
  assert.equal(await resolveTracker('Bearer not-a-jwt', '203.0.113.5', verify), 'ip:203.0.113.5');
});

test('a valid token carrying no usable sub falls back to the IP bucket', async () => {
  for (const payload of [{}, { sub: '' }, { sub: '   ' }, { sub: null }]) {
    const token = sign(payload);
    assert.equal(await resolveTracker(`Bearer ${token}`, '203.0.113.5', verify), 'ip:203.0.113.5', JSON.stringify(payload));
  }
});

// ── unauthenticated traffic is unchanged ─────────────────────────────────────

test('login and refresh (no bearer token) stay IP-keyed — brute-force protection intact', async () => {
  assert.equal(await resolveTracker(undefined, '203.0.113.5', verify), 'ip:203.0.113.5');
  assert.equal(await resolveTracker('', '203.0.113.5', verify), 'ip:203.0.113.5');
});

test('two anonymous callers on one IP still share a bucket', async () => {
  const a = await resolveTracker(undefined, '203.0.113.5', verify);
  const b = await resolveTracker(undefined, '203.0.113.5', verify);
  assert.equal(a, b);
});

test('a missing IP still yields a usable, non-empty key', async () => {
  // An empty tracker key would collapse every anonymous caller into one bucket
  // under a blank string — make the fallback explicit instead.
  assert.equal(await resolveTracker(undefined, undefined, verify), 'ip:unknown');
  assert.equal(await resolveTracker(undefined, '   ', verify), 'ip:unknown');
});

test('user and ip keys can never collide', async () => {
  const asUser = await resolveTracker(`Bearer ${sign({ sub: '203.0.113.5' })}`, '198.51.100.9', verify);
  const asIp = await resolveTracker(undefined, '203.0.113.5', verify);
  assert.notEqual(asUser, asIp);
});

// ── drift guard ──────────────────────────────────────────────────────────────

test('the app registers the per-user guard, not the stock one', () => {
  assert.match(appModule, /useClass: UserThrottlerGuard/);
  assert.ok(
    !/useClass: ThrottlerGuard/.test(appModule),
    'the stock IP-keyed guard must not be re-registered',
  );
});
