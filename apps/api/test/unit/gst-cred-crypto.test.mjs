/**
 * Unit tests for the GST credential cipher (AES-256-GCM, env master key).
 * Proves the security properties the spec requires: authenticated round-trip,
 * fail-closed on a wrong key or tampered ciphertext, a unique IV per encryption,
 * and strict master-key validation. No key material is ever logged or returned.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  EnvAesGcmCipher,
  parseMasterKey,
  validateMasterKeyConfig,
  CRED_KEY_ENV,
  CRED_KEY_VERSION,
} from '../../dist/compliance/gst-cred-crypto.util.js';

const key = () => randomBytes(32);

test('seal → open round-trips the plaintext', () => {
  const c = new EnvAesGcmCipher(key());
  const sealed = c.seal('S3cr3t-portal-pw');
  assert.equal(sealed.keyVersion, CRED_KEY_VERSION);
  assert.equal(c.open(sealed), 'S3cr3t-portal-pw');
});

test('the sealed record carries no plaintext and a full GCM envelope', () => {
  const c = new EnvAesGcmCipher(key());
  const sealed = c.seal('hunter2');
  assert.ok(sealed.iv && sealed.ciphertext && sealed.authTag);
  assert.ok(!JSON.stringify(sealed).includes('hunter2'), 'ciphertext must not reveal the plaintext');
  assert.equal(Buffer.from(sealed.iv, 'base64').length, 12); // GCM nonce
  assert.equal(Buffer.from(sealed.authTag, 'base64').length, 16); // GCM tag
});

test('a DIFFERENT key cannot open the record (fail closed)', () => {
  const sealed = new EnvAesGcmCipher(key()).seal('pw');
  const other = new EnvAesGcmCipher(key());
  assert.throws(() => other.open(sealed), /decryption failed/);
});

test('a TAMPERED ciphertext fails the auth check (fail closed)', () => {
  const c = new EnvAesGcmCipher(key());
  const sealed = c.seal('pw');
  const raw = Buffer.from(sealed.ciphertext, 'base64');
  raw[0] ^= 0xff; // flip a bit
  const tampered = { ...sealed, ciphertext: raw.toString('base64') };
  assert.throws(() => c.open(tampered), /decryption failed/);
});

test('a TAMPERED auth tag fails (fail closed)', () => {
  const c = new EnvAesGcmCipher(key());
  const sealed = c.seal('pw');
  const tag = Buffer.from(sealed.authTag, 'base64');
  tag[0] ^= 0xff;
  assert.throws(() => c.open({ ...sealed, authTag: tag.toString('base64') }), /decryption failed/);
});

test('every encryption uses a UNIQUE IV (no nonce reuse)', () => {
  const c = new EnvAesGcmCipher(key());
  const ivs = new Set();
  for (let i = 0; i < 100; i++) ivs.add(c.seal('same-plaintext').iv);
  assert.equal(ivs.size, 100, 'IVs must never repeat');
  // Same plaintext, different IV → different ciphertext (semantic security).
  const a = c.seal('same-plaintext');
  const b = c.seal('same-plaintext');
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('parseMasterKey accepts 64-hex and base64-of-32-bytes, rejects the rest', () => {
  assert.equal(parseMasterKey('a'.repeat(64)).length, 32); // hex
  const b64 = randomBytes(32).toString('base64');
  assert.equal(parseMasterKey(b64).length, 32); // base64
  assert.throws(() => parseMasterKey(undefined), new RegExp(CRED_KEY_ENV));
  assert.throws(() => parseMasterKey(''), new RegExp(CRED_KEY_ENV));
  assert.throws(() => parseMasterKey('too-short'), /32 bytes/);
  assert.throws(() => parseMasterKey('a'.repeat(63)), /32 bytes/); // 63 hex ≠ 32 bytes
});

test('validateMasterKeyConfig: unconfigured when absent, throws when malformed', () => {
  assert.deepEqual(validateMasterKeyConfig({}), { configured: false });
  assert.deepEqual(validateMasterKeyConfig({ [CRED_KEY_ENV]: 'a'.repeat(64) }), { configured: true });
  assert.throws(() => validateMasterKeyConfig({ [CRED_KEY_ENV]: 'bad' }), /32 bytes/);
});
