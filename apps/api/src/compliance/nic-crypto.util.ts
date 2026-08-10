import { createCipheriv, createDecipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';

/**
 * Crypto primitives for the NIC IRP / e-way auth + session envelope. These are
 * the reusable, testable part of the live adapter — standard, deterministic
 * transforms with no secrets of their own; only the *inputs* (the portal public
 * key, the session key) are sensitive, and those arrive at call time.
 *
 * The NIC handshake (see docs/deployment/INTEGRATION-RUNBOOK-00-gst-common.md §3):
 *   - the client makes a 32-byte AES-256 "AppKey";
 *   - the auth request payload is RSA-encrypted with the portal's public key;
 *   - the response yields a session key ("Sek"); thereafter every business
 *     payload is AES-256-ECB encrypted with the Sek and base64-wrapped as
 *     `{ "Data": "<b64>" }`.
 */

/** A fresh 32-byte AES-256 key (the per-auth "AppKey"). */
export function genAppKey(): Buffer {
  return randomBytes(32);
}

/**
 * RSA-encrypt (PKCS#1 v1.5) with the portal's public key and return base64.
 * The auth JSON is small enough to encrypt directly for RSA-2048. `publicKeyPem`
 * is the portal key in PEM (`-----BEGIN PUBLIC KEY-----`…); convert a NIC-supplied
 * base64/DER cert to PEM once at deploy.
 */
export function rsaEncryptBase64(publicKeyPem: string, data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, buf).toString('base64');
}

/** AES-256-ECB encrypt (PKCS7 padding) → base64. Used for session payloads. */
export function aesEncryptBase64(key: Buffer, plaintext: string): string {
  assertKey(key);
  const cipher = createCipheriv('aes-256-ecb', key, null);
  return Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]).toString('base64');
}

/** AES-256-ECB decrypt a base64 payload → utf8 string (for JSON payloads). */
export function aesDecrypt(key: Buffer, b64: string): string {
  return aesDecryptToBuffer(key, b64).toString('utf8');
}

/**
 * AES-256-ECB decrypt a base64 payload → raw bytes. Use this for the session key
 * ("Sek"), which is 32 raw bytes AES-encrypted with the AppKey — decoding it as
 * utf8 would corrupt it.
 */
export function aesDecryptToBuffer(key: Buffer, b64: string): Buffer {
  assertKey(key);
  const decipher = createDecipheriv('aes-256-ecb', key, null);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]);
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('AES-256 key must be a 32-byte Buffer');
  }
}
