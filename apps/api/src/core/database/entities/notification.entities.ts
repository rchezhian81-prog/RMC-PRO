import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 4 — Notification log (Design Doc 6 §15.2 subset).
 * The WhatsApp/share foundation records every outbound message attempt here.
 * No live provider is wired in Sprint 4 — messages are recorded with a
 * 'queued' / 'logged' status so later sprints can attach a real gateway
 * without changing the sales flow.
 */
@Entity('notification_logs')
export class NotificationLog extends TenantScopedEntity {
  @Column({ name: 'channel', type: 'varchar', default: 'whatsapp' }) channel!: string;
  @Column({ name: 'recipient_mobile', type: 'varchar', nullable: true }) recipientMobile!: string | null;
  @Column({ name: 'module_key', type: 'varchar', nullable: true }) moduleKey!: string | null;
  @Column({ name: 'event_key', type: 'varchar', nullable: true }) eventKey!: string | null;
  @Column({ name: 'reference_type', type: 'varchar', nullable: true }) referenceType!: string | null;
  @Column({ name: 'reference_id', type: 'uuid', nullable: true }) referenceId!: string | null;
  @Column({ name: 'message_body', type: 'text', nullable: true }) messageBody!: string | null;
  @Column({ name: 'share_url', type: 'varchar', nullable: true }) shareUrl!: string | null;
  @Column({ name: 'message_status', type: 'varchar', default: 'queued' }) messageStatus!: string;
  @Column({ name: 'provider_message_id', type: 'varchar', nullable: true }) providerMessageId!: string | null;
  @Column({ name: 'error_message', type: 'varchar', nullable: true }) errorMessage!: string | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true }) sentAt!: Date | null;
}

/**
 * A tenant's WhatsApp Business (Meta Cloud API) connection: the phone-number id
 * the messages go out from and the access token, stored ONLY as AES-256-GCM
 * ciphertext (iv + ciphertext + auth tag + key version) sealed with the same
 * master key as the GST credentials. One row per tenant. The token never leaves
 * the server — the Settings card sees phone-number id, business number and the
 * last test outcome only.
 */
@Entity('tenant_whatsapp_credentials')
export class TenantWhatsAppCredential extends TenantScopedEntity {
  @Column({ name: 'provider', type: 'varchar', default: 'meta' }) provider!: string;
  @Column({ name: 'phone_number_id', type: 'varchar' }) phoneNumberId!: string;
  /** The display number customers see (e.g. +91 98765 43210); informational. */
  @Column({ name: 'business_number', type: 'varchar', nullable: true }) businessNumber!: string | null;
  @Column({ name: 'key_version', type: 'int' }) keyVersion!: number;
  @Column({ name: 'token_iv', type: 'varchar' }) tokenIv!: string;
  @Column({ name: 'token_ciphertext', type: 'text' }) tokenCiphertext!: string;
  @Column({ name: 'token_auth_tag', type: 'varchar' }) tokenAuthTag!: string;
  /**
   * An approved message template with ONE body parameter ({{1}}) that carries the
   * text. Meta only accepts free text inside a 24-hour customer window; a
   * template goes through any time, which is what a business notification needs.
   */
  @Column({ name: 'template_name', type: 'varchar', nullable: true }) templateName!: string | null;
  @Column({ name: 'template_language', type: 'varchar', default: 'en' }) templateLanguage!: string;
  @Column({ name: 'last_tested_at', type: 'timestamptz', nullable: true }) lastTestedAt!: Date | null;
  @Column({ name: 'last_test_success', type: 'boolean', nullable: true }) lastTestSuccess!: boolean | null;
  @Column({ name: 'last_test_message', type: 'varchar', nullable: true }) lastTestMessage!: string | null;
}
