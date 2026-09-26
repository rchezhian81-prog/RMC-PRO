/**
 * The self-service password reset: the token is random and only its hash is
 * stored, a malformed token is refused before any lookup, the link points at
 * the web app, and the email says what the reader needs in plain words.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const util = require('../../dist/auth/password-reset.util.js');

test('a fresh token is 64 hex characters and its stored hash is not the token', () => {
  const a = util.newResetToken();
  const b = util.newResetToken();
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.hash, a.token);
  assert.equal(util.hashResetToken(a.token), a.hash);
});

test('only a well-formed token reaches the database', () => {
  assert.equal(util.looksLikeResetToken(util.newResetToken().token), true);
  assert.equal(util.looksLikeResetToken(''), false);
  assert.equal(util.looksLikeResetToken('abc'), false);
  assert.equal(util.looksLikeResetToken(null), false);
  assert.equal(util.looksLikeResetToken("' OR 1=1 --"), false);
});

test('the link is built on WEB_ORIGIN, else the first allowed browser origin', () => {
  assert.equal(util.webOrigin({ WEB_ORIGIN: 'https://app.example.com/' }), 'https://app.example.com');
  assert.equal(util.webOrigin({ CORS_ORIGINS: 'https://app.example.com, https://admin.example.com' }), 'https://app.example.com');
  assert.equal(util.webOrigin({}), 'http://localhost:3000');
  assert.equal(util.resetLink('https://app.example.com', 'abc'), 'https://app.example.com/reset-password?token=abc');
});

test('the email carries the link, the time limit and the "ignore it" line', () => {
  const m = util.resetEmail({ name: 'Priya Raman', link: 'https://app.example.com/reset-password?token=t' });
  assert.match(m.subject, /reset/i);
  assert.match(m.text, /Hello Priya,/);
  assert.match(m.text, /https:\/\/app\.example\.com\/reset-password\?token=t/);
  assert.match(m.text, /30 minutes/);
  assert.match(m.text, /ignore this email/);
  assert.match(m.html, /href="https:\/\/app\.example\.com\/reset-password\?token=t"/);
  assert.equal(util.RESET_TTL_MINUTES, 30);
});
