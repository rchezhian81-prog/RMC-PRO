import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService } from '../audit/audit.service';
import { TenantGstCredential } from '../core/database/entities';
import { GstProviderError } from './gst.types';
import { isGstin } from './gst-payload.util';
import { type CredentialCipher, createCredentialCipher } from './gst-cred-crypto.util';

/**
 * REDACTED view of a stored credential — the ONLY shape that ever reaches the
 * client. It carries the GSTIN and test status, never the username, password, or
 * any ciphertext.
 */
export interface CredentialStatus {
  gstin: string;
  configured: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  lastTestMessage: string | null;
}

/**
 * Stores per-tenant GST-portal credentials, tenant-scoped under RLS. The password
 * is sealed with AES-256-GCM (gst-cred-crypto) before it touches the DB and is
 * decrypted only for the live provider via {@link resolve}. Every mutation is
 * audited WITHOUT the secret, and no method returns the plaintext to a caller
 * other than the provider.
 */
@Injectable()
export class GstCredentialStore {
  private readonly log = new Logger(GstCredentialStore.name);
  private cipherInstance: CredentialCipher | null = null;

  constructor(
    private readonly db: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  /** Build the cipher lazily; throws a clear error if GST_CRED_ENC_KEY is missing/bad. */
  private cipher(): CredentialCipher {
    if (!this.cipherInstance) this.cipherInstance = createCredentialCipher();
    return this.cipherInstance;
  }

  /** True when credential encryption is usable (the master key is present + valid). */
  isEncryptionConfigured(): boolean {
    try {
      this.cipher();
      return true;
    } catch {
      return false;
    }
  }

  /** Map a row to its redacted status. NEVER include username/password/ciphertext. */
  private redact(row: TenantGstCredential): CredentialStatus {
    return {
      gstin: row.gstin,
      configured: true,
      lastTestedAt: row.lastTestedAt ? new Date(row.lastTestedAt).toISOString() : null,
      lastTestSuccess: row.lastTestSuccess ?? null,
      lastTestMessage: row.lastTestMessage ?? null,
    };
  }

  async setCredentials(
    tenantId: string,
    gstin: string,
    username: string,
    password: string,
    actorUserId: string | null,
  ): Promise<CredentialStatus> {
    if (!gstin || !isGstin(gstin)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'a valid 15-character GSTIN is required' });
    }
    if (!username?.trim() || !password) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'portal username and password are required' });
    }

    // Seal BEFORE any DB work — a missing/bad key fails here with a clear error
    // and nothing is written (fail closed).
    const sealed = this.cipher().seal(password);

    const { row, created } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(TenantGstCredential);
      const existing = await repo.findOne({ where: { tenantId, gstin } });
      const saved = await repo.save(
        repo.create({
          ...(existing ?? {}),
          tenantId,
          gstin,
          portalUsername: username.trim(),
          keyVersion: sealed.keyVersion,
          passwordIv: sealed.iv,
          passwordCiphertext: sealed.ciphertext,
          passwordAuthTag: sealed.authTag,
          // A credential change invalidates any prior test result.
          lastTestedAt: null,
          lastTestSuccess: null,
          lastTestMessage: null,
        }),
      );
      return { row: saved, created: !existing };
    });

    await this.audit.record({
      tenantId,
      actorUserId,
      action: created ? 'gst.credentials.created' : 'gst.credentials.updated',
      summary: `GST portal credentials ${created ? 'set' : 'updated'} for GSTIN ${gstin}`,
      entityType: 'gst_credential',
      entityId: row.id,
      details: { gstin, keyVersion: sealed.keyVersion }, // never username / password
    });
    return this.redact(row);
  }

  async getStatus(tenantId: string, gstin: string): Promise<CredentialStatus | null> {
    const row = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(TenantGstCredential).findOne({ where: { tenantId, gstin } }),
    );
    return row ? this.redact(row) : null;
  }

  async listStatuses(tenantId: string): Promise<CredentialStatus[]> {
    const rows = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(TenantGstCredential).find({ where: { tenantId }, order: { gstin: 'ASC' } }),
    );
    return rows.map((r) => this.redact(r));
  }

  async deleteCredentials(tenantId: string, gstin: string, actorUserId: string | null): Promise<{ deleted: boolean }> {
    const existing = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(TenantGstCredential);
      const row = await repo.findOne({ where: { tenantId, gstin } });
      if (row) await repo.delete({ id: row.id });
      return row;
    });
    if (!existing) return { deleted: false };
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'gst.credentials.deleted',
      summary: `GST portal credentials removed for GSTIN ${gstin}`,
      entityType: 'gst_credential',
      entityId: existing.id,
      details: { gstin },
    });
    return { deleted: true };
  }

  async recordTest(
    tenantId: string,
    gstin: string,
    success: boolean,
    message: string,
    actorUserId: string | null,
  ): Promise<CredentialStatus | null> {
    const row = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(TenantGstCredential);
      const existing = await repo.findOne({ where: { tenantId, gstin } });
      if (!existing) return null;
      existing.lastTestedAt = new Date();
      existing.lastTestSuccess = success;
      existing.lastTestMessage = message ? message.slice(0, 500) : null;
      return repo.save(existing);
    });
    if (!row) return null;
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'gst.credentials.tested',
      summary: `GST portal credential test ${success ? 'succeeded' : 'failed'} for GSTIN ${gstin}`,
      entityType: 'gst_credential',
      entityId: row.id,
      details: { gstin, success, message: row.lastTestMessage },
    });
    return this.redact(row);
  }

  /**
   * Decrypt and return the live portal credentials — for the PROVIDER only, never
   * an API response. Fail-closed: throws NO_CREDENTIALS when none are configured,
   * and the cipher throws when the key is missing/wrong or the record is tampered.
   */
  async resolve(tenantId: string, gstin: string): Promise<{ username: string; password: string }> {
    const row = await this.db.runInTenant(tenantId, (m) =>
      m.getRepository(TenantGstCredential).findOne({ where: { tenantId, gstin } }),
    );
    if (!row) {
      throw new GstProviderError('NO_CREDENTIALS', `no GST portal credentials configured for GSTIN ${gstin}`);
    }
    const password = this.cipher().open({
      keyVersion: row.keyVersion,
      iv: row.passwordIv,
      ciphertext: row.passwordCiphertext,
      authTag: row.passwordAuthTag,
    });
    return { username: row.portalUsername, password };
  }
}
