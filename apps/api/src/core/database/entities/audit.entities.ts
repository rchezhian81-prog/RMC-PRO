import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * An immutable record of a consequential action — the trail an auditor asks for
 * first: who released this credit hold, who cancelled that invoice, who changed
 * the rate, and when.
 *
 * Append-only by database grant, not merely by convention. The application role
 * holds SELECT and INSERT on this table and nothing else, so a bug in the app —
 * or the app itself if it were compromised — cannot alter or erase an entry.
 * That is the property that makes the trail worth keeping, so there is
 * deliberately no `updated_at` column and no code path that updates a row.
 *
 * The actor's email and name are stored alongside the id as a snapshot, so the
 * trail still reads correctly after a user is renamed or removed.
 */
@Entity('audit_logs')
@Index('idx_audit_logs_tenant_time', ['tenantId', 'createdAt'])
@Index('idx_audit_logs_entity', ['tenantId', 'entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** When it happened. There is no updated_at — an audit row is never revised. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** The person responsible. Null only for genuinely system-initiated events. */
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /** Snapshot of who they were, so the trail survives a rename or deletion. */
  @Column({ name: 'actor_email', type: 'varchar', nullable: true })
  actorEmail!: string | null;

  @Column({ name: 'actor_name', type: 'varchar', nullable: true })
  actorName!: string | null;

  /** A stable machine key, e.g. `credit_hold.release`, `invoice.cancel`. */
  @Column({ name: 'action', type: 'varchar' })
  action!: string;

  /** What kind of thing was acted on, e.g. `order`, `invoice`, `user`. */
  @Column({ name: 'entity_type', type: 'varchar', nullable: true })
  entityType!: string | null;

  /** The record's id when it has one. Left null for non-uuid subjects. */
  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  /** A human reference for the subject — an invoice number, a module name. */
  @Column({ name: 'entity_label', type: 'varchar', nullable: true })
  entityLabel!: string | null;

  /** One plain sentence a non-technical reader can understand at a glance. */
  @Column({ name: 'summary', type: 'varchar' })
  summary!: string;

  /** Structured context (e.g. a before/after diff). Never holds a secret. */
  @Column({ name: 'details', type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress!: string | null;
}
