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
