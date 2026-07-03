import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { NotificationLog } from '../core/database/entities';

export interface WhatsAppShareInput {
  recipientMobile?: string | null;
  moduleKey?: string;
  eventKey?: string;
  referenceType?: string;
  referenceId?: string | null;
  message: string;
}

/**
 * WhatsApp share/send FOUNDATION (Design Doc 6 §15.2, Doc 6.1 integrations).
 * Sprint 4 has NO live gateway wired — every outbound message is recorded in
 * notification_logs and a click-to-chat `wa.me` share URL is returned so the
 * sales user can share immediately. Later sprints swap `messageStatus:'logged'`
 * for a real provider send without changing callers.
 */
@Injectable()
export class WhatsAppService {
  constructor(private readonly db: TenantDbService) {}

  /** Build a wa.me click-to-chat link (no gateway required). */
  buildShareUrl(mobile: string | null | undefined, message: string): string {
    const digits = (mobile ?? '').replace(/\D/g, '');
    const text = encodeURIComponent(message);
    return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  /** Record an outbound message inside the caller's existing tenant transaction. */
  async logWithin(
    m: EntityManager,
    tenantId: string,
    input: WhatsAppShareInput,
  ): Promise<NotificationLog> {
    const shareUrl = this.buildShareUrl(input.recipientMobile, input.message);
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
        messageStatus: 'logged',
      }),
    );
  }

  /** Record an outbound message in its own tenant transaction. */
  share(tenantId: string, input: WhatsAppShareInput): Promise<NotificationLog> {
    return this.db.runInTenant(tenantId, (m) => this.logWithin(m, tenantId, input));
  }

  /** Notification history for a tenant (most recent first). */
  history(tenantId: string): Promise<NotificationLog[]> {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(NotificationLog).find({ order: { createdAt: 'DESC' }, take: 100 }),
    );
  }
}
