import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { NotificationLog, TenantSetting } from '../core/database/entities';
import { listLimit } from '../common/list-limit.util';
import { WhatsAppCredentialStore } from './whatsapp-credential-store.service';
import { sendWhatsAppMessage, type WhatsAppConfig } from './whatsapp-provider';
import { waMeNumber } from './whatsapp.util';

export { waMeNumber } from './whatsapp.util';

export interface WhatsAppShareInput {
  recipientMobile?: string | null;
  moduleKey?: string;
  eventKey?: string;
  referenceType?: string;
  referenceId?: string | null;
  message: string;
}

/**
 * WhatsApp share / send.
 *
 * Every outbound message is recorded in notification_logs with a click-to-chat
 * `wa.me` link, so the sales user can always share by hand. When a WhatsApp
 * Business account is connected (Settings → WhatsApp Business, or the server's
 * env fallback) AND the tenant's "WhatsApp automatic sending" setting is on,
 * the message is ALSO sent through the Cloud API first, and the log row records
 * the outcome: `sent` with the provider message id, or `failed` with the
 * reason — in which case the click-to-chat link is still there as the fallback.
 *
 * The send happens before the row is written so the caller's response already
 * says what happened; the API's own 10 s timeout bounds the wait.
 */
@Injectable()
export class WhatsAppService {
  constructor(private readonly db: TenantDbService, private readonly store: WhatsAppCredentialStore) {}

  /** Build a wa.me click-to-chat link (no gateway required). */
  buildShareUrl(mobile: string | null | undefined, message: string): string {
    const digits = waMeNumber(mobile);
    const text = encodeURIComponent(message);
    return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  /** The tenant's "WhatsApp automatic sending" switch (default on). */
  private async autoSendEnabled(m: EntityManager): Promise<boolean> {
    const row = await m.getRepository(TenantSetting).findOne({ where: { settingKey: 'whatsapp_notifications' } });
    return row ? String(row.settingValue ?? 'true') !== 'false' : true;
  }

  /** Try the API send when it is configured and switched on; null = not attempted (click-to-chat only). */
  private async trySend(m: EntityManager, tenantId: string, mobile: string | null | undefined, message: string) {
    if (!waMeNumber(mobile)) return null;
    if (!(await this.autoSendEnabled(m))) return null;
    const cfg = await this.store.resolve(tenantId);
    if (!cfg) return null;
    return { cfg, result: await sendWhatsAppMessage(cfg, mobile, message) };
  }

  /** Record an outbound message inside the caller's existing tenant transaction (sending first when connected). */
  async logWithin(m: EntityManager, tenantId: string, input: WhatsAppShareInput): Promise<NotificationLog> {
    const shareUrl = this.buildShareUrl(input.recipientMobile, input.message);
    const attempt = await this.trySend(m, tenantId, input.recipientMobile, input.message);
    const repo = m.getRepository(NotificationLog);
    return repo.save(
      repo.create({
        tenantId,
        channel: 'whatsapp',
        recipientMobile: input.recipientMobile ?? null,
        moduleKey: input.moduleKey ?? 'sales',
        eventKey: input.eventKey ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        messageBody: input.message,
        shareUrl,
        messageStatus: attempt ? (attempt.result.ok ? 'sent' : 'failed') : 'logged',
        providerMessageId: attempt?.result.messageId ?? null,
        errorMessage: attempt && !attempt.result.ok ? attempt.result.error ?? 'send failed' : null,
        sentAt: attempt?.result.ok ? new Date() : null,
      }),
    );
  }

  /** Record an outbound message in its own tenant transaction. */
  share(tenantId: string, input: WhatsAppShareInput): Promise<NotificationLog> {
    return this.db.runInTenant(tenantId, (m) => this.logWithin(m, tenantId, input));
  }

  /** Send a logged / failed message again through the API (the log row is updated in place). */
  resend(tenantId: string, id: string): Promise<NotificationLog> {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(NotificationLog);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Message not found' });
      if (!row.messageBody) return row;
      const cfg = await this.store.resolve(tenantId);
      if (!cfg) {
        await repo.update({ id }, { messageStatus: 'failed', errorMessage: 'No WhatsApp Business account is connected — use the Open link to send by hand.' });
        return (await repo.findOne({ where: { id } })) as NotificationLog;
      }
      const result = await sendWhatsAppMessage(cfg, row.recipientMobile, row.messageBody);
      await repo.update({ id }, {
        messageStatus: result.ok ? 'sent' : 'failed',
        providerMessageId: result.messageId ?? row.providerMessageId,
        errorMessage: result.ok ? null : result.error ?? 'send failed',
        sentAt: result.ok ? new Date() : row.sentAt,
      });
      return (await repo.findOne({ where: { id } })) as NotificationLog;
    });
  }

  /** A test message from Settings, recorded like any other send so the log shows it. */
  async sendTest(tenantId: string, mobile: string, companyName: string): Promise<{ delivered: boolean; status: string; error: string | null; log: NotificationLog; source: WhatsAppConfig['source'] | null }> {
    const cfg = await this.store.resolve(tenantId);
    const message = `${companyName}: this is a test message from Mix Nova — WhatsApp Business is connected. ${new Date().toISOString()}`;
    const log = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(NotificationLog);
      const result = cfg ? await sendWhatsAppMessage(cfg, mobile, message) : { ok: false, error: 'No WhatsApp Business account is connected.' };
      return repo.save(repo.create({
        tenantId, channel: 'whatsapp', recipientMobile: mobile, moduleKey: 'settings', eventKey: 'whatsapp_test',
        referenceType: null, referenceId: null, messageBody: message, shareUrl: this.buildShareUrl(mobile, message),
        messageStatus: result.ok ? 'sent' : 'failed', providerMessageId: result.messageId ?? null,
        errorMessage: result.ok ? null : result.error ?? 'send failed', sentAt: result.ok ? new Date() : null,
      }));
    });
    if (cfg?.source === 'tenant') await this.store.recordTest(tenantId, log.messageStatus === 'sent', log.errorMessage ?? 'delivered');
    return { delivered: log.messageStatus === 'sent', status: log.messageStatus, error: log.errorMessage, log, source: cfg?.source ?? null };
  }

  /** Notification history for a tenant (most recent first). */
  history(tenantId: string, limit?: string): Promise<NotificationLog[]> {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(NotificationLog).find({ order: { createdAt: 'DESC' }, take: listLimit(limit) }),
    );
  }
}
