import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for per-tenant GST-portal credentials (the portal
 * password). AES-256-GCM with a master key held ONLY in the environment
 * (`GST_CRED_ENC_KEY`) — never in the DB, repo, image, logs, or any API response.
 *
 * Design:
 *   - a fresh random 12-byte IV per encryption (GCM nonce), never reused;
 *   - the sealed record stores {keyVersion, iv, ciphertext, authTag} so the key
 *     can be rotated (bump the version) and each field decoded independently;
 *   - decryption is FAIL-CLOSED: a wrong key or tampered ciphertext fails the GCM
 *     auth check and throws — it never returns a guess or partial plaintext.
 *
 * The `CredentialCipher` interface is the seam: today it's an env-key AES-GCM
 * implementation; a KMS/secret-manager-backed one can replace it later WITHOUT
 * changing any caller (the store depends on the interface, not the impl).
 */

export const CRED_KEY_ENV = 'GST_CRED_ENC_KEY';
/** Bump when the master key is rotated so old rows remain decryptable by version. */
export const CRED_KEY_VERSION = 1;

/** A sealed secret — safe to persist. Contains no key material. */
export interface SealedSecret {
  /** Master-key version used to seal this record. */
  keyVersion: number;
  /** base64 12-byte GCM nonce (unique per encryption). */
  iv: string;
  /** base64 ciphertext. */
  ciphertext: string;
  /** base64 16-byte GCM authentication tag. */
  authTag: string;
}

export interface CredentialCipher {
  readonly keyVersion: number;
  seal(plaintext: string): SealedSecret;
  /** Throws (fail-closed) on a wrong key or tampered record. */
  open(sealed: SealedSecret): string;
}

/**
 * Decode a 32-byte (AES-256) key from `GST_CRED_ENC_KEY`. Accepts 64 hex chars or
 * base64 that decodes to exactly 32 bytes. Throws a clear, actionable error when
 * the key is missing or malformed — the message never contains the key itself.
 */
export function parseMasterKey(raw: string | undefined): Buffer {
  if (!raw || !raw.trim()) {
    throw new Error(
      `${CRED_KEY_ENV} is not set — GST portal credential encryption is unavailable. ` +
        `Provide a 32-byte AES-256 key (64 hex chars, or base64 of 32 bytes).`,
    );
  }
  const s = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    key = Buffer.from(s, 'hex');
  } else {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) key = b;
  }
  if (!key || key.length !== 32) {
    throw new Error(
      `${CRED_KEY_ENV} must decode to exactly 32 bytes (AES-256): provide 64 hex chars or base64 of 32 bytes.`,
    );
  }
  return key;
}

/**
 * Startup check (runbook item 11). If the key is present, validate its format
 * (throws on malformed → fail fast on a misconfigured deployment); if absent,
 * report unconfigured so live use can be blocked with a clear error later.
 * Never logs or returns the key.
 */
export function validateMasterKeyConfig(env: NodeJS.ProcessEnv = process.env): { configured: boolean } {
  const raw = env[CRED_KEY_ENV];
  if (!raw || !raw.trim()) return { configured: false };
  parseMasterKey(raw); // throws if malformed
  return { configured: true };
}

export class EnvAesGcmCipher implements CredentialCipher {
  readonly keyVersion = CRED_KEY_VERSION;
  private readonly key: Buffer;

  /** `key` is injectable for tests; in production it loads from the environment. */
  constructor(key?: Buffer) {
    this.key = key ?? parseMasterKey(process.env[CRED_KEY_ENV]);
  }

  seal(plaintext: string): SealedSecret {
    const iv = randomBytes(12); // GCM standard nonce length; unique per call
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    return {
      keyVersion: this.keyVersion,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  open(sealed: SealedSecret): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
        decipher.final(), // throws if the auth tag doesn't verify
      ]).toString('utf8');
    } catch {
      // Fail closed — wrong key or tampered data. Never surface a partial result.
      throw new Error('GST credential decryption failed (wrong key or tampered data)');
    }
  }
}

/** The default seam impl: env-key AES-256-GCM. Throws if the key is missing/bad. */
export function createCredentialCipher(): CredentialCipher {
  return new EnvAesGcmCipher();
}
