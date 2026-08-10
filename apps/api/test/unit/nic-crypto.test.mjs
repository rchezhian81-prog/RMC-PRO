/**
 * Unit tests for the NIC IRP/e-way crypto primitives. No secrets, no network:
 * we prove the AES-256-ECB session round-trip and that the RSA envelope decrypts
 * with a locally-generated keypair (standing in for the portal's key pair).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { genAppKey, rsaEncryptBase64, aesEncryptBase64, aesDecrypt } from '../../dist/compliance/nic-crypto.util.js';

test('genAppKey is a 32-byte AES-256 key', () => {
  const k = genAppKey();
  assert.equal(k.length, 32);
  assert.notEqual(k.toString('hex'), genAppKey().toString('hex')); // random
});

test('AES-256-ECB session payload round-trips', () => {
  const key = genAppKey();
  const payload = JSON.stringify({ Version: '1.1', DocDtls: { No: 'INV-001' }, n: 295000 });
  const enc = aesEncryptBase64(key, payload);
  assert.notEqual(enc, payload);
  assert.equal(aesDecrypt(key, enc), payload);
});

test('AES rejects a non-32-byte key', () => {
  assert.throws(() => aesEncryptBase64(Buffer.alloc(16), 'x'), /32-byte/);
});

test('RSA envelope decrypts with the matching private key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const appKey = genAppKey();
  const authPayload = JSON.stringify({ UserName: 'u', Password: 'p', AppKey: appKey.toString('base64'), ForceRefreshAccessToken: false });
  const b64 = rsaEncryptBase64(publicKey, authPayload);
  const recovered = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(b64, 'base64')).toString('utf8');
  assert.equal(recovered, authPayload);
});
