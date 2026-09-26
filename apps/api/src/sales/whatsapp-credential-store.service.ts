import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { TenantWhatsAppCredential } from '../core/database/entities';
import { type CredentialCipher, createCredentialCipher } from '../compliance/gst-cred-crypto.util';
import { configFromEnv, type WhatsAppConfig } from './whatsapp-provider';

const badReq = (message: string, field?: string) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message, ...(field ? { fields: { [field]: message } } : {}) });

/** The REDACTED view — the only shape a client ever sees. No token, no ciphertext. */
export interface WhatsAppStatus {
  configured: boolean;
  /** 'tenant' = this company's own account; 'server' = the box-wide env fallback. */
  source: 'tenant' | 'server' | null;
  phoneNumberId: string | null;
  businessNumber: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  /** Whether the server can seal a token at all (GST_CRED_ENC_KEY present). */
  encryptionAvailable: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  lastTestMessage: string | null;
}

/**
 * Per-tenant WhatsApp Business credentials, sealed at rest (AES-256-GCM, the
 * same master key as the GST credentials) and opened only to send. A box-wide
 * env fallback (WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN) serves a
 * single-plant server that has no per-company account. Every write is audited
 * without the secret.
 */
@Injectable()
export class WhatsAppCredentialStore {
  private readonly log = new Logger(WhatsAppCredentialStore.name);
  private cipherInstance: CredentialCipher | null = null;

  constructor(private readonly db: TenantDbService, private readonly audit: AuditService) {}

  private cipher(): CredentialCipher {
    if (!this.cipherInstance) this.cipherInstance = createCredentialCipher();
    return this.cipherInstance;
  }

  encryptionAvailable(): boolean {
    try { this.cipher(); return true; } catch { return false; }
  }

  private redact(row: TenantWhatsAppCredential | null): WhatsAppStatus {
    const env = configFromEnv();
    if (!row) {
      return {
        configured: Boolean(env), source: env ? 'server' : null,
        phoneNumberId: env?.phoneNumberId ?? null, businessNumber: env?.businessNumber ?? null,
        templateName: env?.templateName ?? null, templateLanguage: env?.templateLanguage ?? null,
        encryptionAvailable: this.encryptionAvailable(),
        lastTestedAt: null, lastTestSuccess: null, lastTestMessage: null,
      };
    }
    return {
      configured: true, source: 'tenant',
      phoneNumberId: row.phoneNumberId, businessNumber: row.businessNumber,
      templateName: row.templateName, templateLanguage: row.templateLanguage,
      encryptionAvailable: this.encryptionAvailable(),
      lastTestedAt: row.lastTestedAt ? new Date(row.lastTestedAt).toISOString() : null,
      lastTestSuccess: row.lastTestSuccess ?? null,
      lastTestMessage: row.lastTestMessage ?? null,
    };
  }

  status(tenantId: string): Promise<WhatsAppStatus> {
    return this.db.runInTenant(tenantId, async (m) => this.redact(await m.getRepository(TenantWhatsAppCredential).findOne({ where: { tenantId } })));
  }

  /**
   * The config to send with: the tenant's own account when stored, else the
   * server fallback, else null (click-to-chat only). Opens the sealed token
   * here and nowhere else; a token that no longer decrypts (rotated key) is
   * treated as "not configured" and logged once, never thrown at a share.
   */
  async resolve(tenantId: string): Promise<WhatsAppConfig | null> {
    const row = await this.db.runInTenant(tenantId, (m) => m.getRepository(TenantWhatsAppCredential).findOne({ where: { tenantId } }));
    if (row) {
      try {
        const accessToken = this.cipher().open({ keyVersion: row.keyVersion, iv: row.tokenIv, ciphertext: row.tokenCiphertext, authTag: row.tokenAuthTag });
        return {
          phoneNumberId: row.phoneNumberId, accessToken, templateName: row.templateName,
          templateLanguage: row.templateLanguage, businessNumber: row.businessNumber, source: 'tenant',
        };
      } catch (e) {
        this.log.warn(`WhatsApp token for tenant ${tenantId} cannot be opened (${e instanceof Error ? e.message : 'decrypt failed'}) — falling back to click-to-chat`);
        return null;
      }
    }
    return configFromEnv();
  }

  async set(
    tenantId: string,
    dto: { phoneNumberId?: string; accessToken?: string; businessNumber?: string | null; templateName?: string | null; templateLanguage?: string | null },
    actorUserId: string | null,
  ): Promise<WhatsAppStatus> {
    const phoneNumberId = String(dto.phoneNumberId ?? '').trim();
    const accessToken = String(dto.accessToken ?? '').trim();
    if (!/^\d{6,20}$/.test(phoneNumberId)) throw badReq('Enter the numeric Phone number ID from Meta (WhatsApp → API setup), not the phone number itself.', 'phoneNumberId');
    if (accessToken.length < 20) throw badReq('Paste the access token from Meta (a long string starting with EAA…).', 'accessToken');
    const templateName = String(dto.templateName ?? '').trim() || null;
    if (templateName && !/^[a-z0-9_]{1,512}$/.test(templateName)) throw badReq('A template name is lower-case letters, digits and underscores (as shown in Meta Business Manager).', 'templateName');
    const templateLanguage = String(dto.templateLanguage ?? '').trim() || 'en';
    if (!/^[a-zA-Z]{2,3}(_[a-zA-Z]{2,4})?$/.test(templateLanguage)) throw badReq('Template language is a code like en, en_US, hi or ta.', 'templateLanguage');
    const businessNumber = String(dto.businessNumber ?? '').trim() || null;
    if (!this.encryptionAvailable()) {
      throw badReq('This server has no credential key (GST_CRED_ENC_KEY) so the token cannot be stored safely. On the server run: cd /opt/rmc && sudo ./scripts/ops/cred-key-ensure.sh');
    }
    const sealed = this.cipher().seal(accessToken);

    const status = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(TenantWhatsAppCredential);
      const existing = await repo.findOne({ where: { tenantId } });
      const fields = {
        provider: 'meta', phoneNumberId, businessNumber, templateName, templateLanguage,
        keyVersion: sealed.keyVersion, tokenIv: sealed.iv, tokenCiphertext: sealed.ciphertext, tokenAuthTag: sealed.authTag,
        lastTestedAt: null, lastTestSuccess: null, lastTestMessage: null,
      };
      const saved = existing
        ? await repo.save(Object.assign(existing, fields))
        : await repo.save(repo.create({ tenantId, ...fields }));
      return this.redact(saved);
    });
    await this.audit.record({
      tenantId, actorUserId, action: AUDIT_ACTIONS.INTEGRATION_CHANGE, entityType: 'whatsapp_credential', entityId: null,
      entityLabel: phoneNumberId, summary: `Connected WhatsApp Business (phone number id ${phoneNumberId}${templateName ? `, template ${templateName}` : ''})`,
    });
    return status;
  }

  async remove(tenantId: string, actorUserId: string | null): Promise<{ deleted: boolean }> {
    const deleted = await this.db.runInTenant(tenantId, async (m) => {
      const res = await m.getRepository(TenantWhatsAppCredential).delete({ tenantId });
      return (res.affected ?? 0) > 0;
    });
    if (deleted) {
      await this.audit.record({
        tenantId, actorUserId, action: AUDIT_ACTIONS.INTEGRATION_CHANGE, entityType: 'whatsapp_credential', entityId: null,
        entityLabel: null, summary: 'Disconnected WhatsApp Business (token removed)',
      });
    }
    return { deleted };
  }

  /** Record the outcome of a test send on the tenant row (no-op for the env fallback). */
  async recordTest(tenantId: string, success: boolean, message: string): Promise<void> {
    await this.db.runInTenant(tenantId, async (m) => {
      await m.getRepository(TenantWhatsAppCredential).update({ tenantId }, {
        lastTestedAt: new Date(), lastTestSuccess: success, lastTestMessage: message.slice(0, 500),
      });
    });
  }
}
