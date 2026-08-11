import { Column, Entity, Index, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * A tenant's GST-portal (IRP / e-way) API credentials, one row per seller GSTIN.
 *
 * The portal PASSWORD is stored ONLY as AES-256-GCM ciphertext (see
 * gst-cred-crypto.util) — this table never holds it in the clear, and no API
 * response returns it. The username is an identifier (the portal login name), not
 * a secret, but is likewise never returned to the client. `last_test_*` records
 * the outcome of a connectivity test so the UI can show configured / last-tested
 * status without ever seeing the secret. Tenant-scoped under FORCE RLS.
 */
@Entity('tenant_gst_credentials')
@Unique('uq_tenant_gst_credentials', ['tenantId', 'gstin'])
export class TenantGstCredential extends TenantScopedEntity {
  @Column({ name: 'gstin', type: 'varchar', length: 15 })
  gstin!: string;

  /** Portal login name (identifier, not the secret). Never returned to the client. */
  @Column({ name: 'portal_username', type: 'varchar' })
  portalUsername!: string;

  /** Master-key version the password was sealed with (supports key rotation). */
  @Column({ name: 'key_version', type: 'int' })
  keyVersion!: number;

  /** base64 GCM nonce. */
  @Column({ name: 'password_iv', type: 'varchar' })
  passwordIv!: string;

  /** base64 AES-256-GCM ciphertext of the portal password. */
  @Column({ name: 'password_ciphertext', type: 'text' })
  passwordCiphertext!: string;

  /** base64 GCM authentication tag. */
  @Column({ name: 'password_auth_tag', type: 'varchar' })
  passwordAuthTag!: string;

  @Column({ name: 'last_tested_at', type: 'timestamptz', nullable: true })
  lastTestedAt!: Date | null;

  @Column({ name: 'last_test_success', type: 'boolean', nullable: true })
  lastTestSuccess!: boolean | null;

  @Column({ name: 'last_test_message', type: 'varchar', nullable: true })
  lastTestMessage!: string | null;
}

/**
 * A durable, on-approval GST execution job (GW-1). When a human APPROVES a GST
 * action (IRN / e-way generate, cancel, update, extend), a job is enqueued here
 * instead of the request thread calling the slow, rate-limited portal inline. A
 * background worker (or an operator drain) processes queued jobs by running the
 * idempotent {@link GstExecutionService.execute}, retrying transient failures with
 * backoff and dead-lettering after `max_attempts`. One job per approval.
 *
 * Tenant-scoped under FORCE RLS with the same NULLIF-guarded clause as the other
 * tenant tables, PLUS an `app.platform` clause so the cross-tenant worker can scan
 * for due jobs. The invoice mutations still happen tenant-scoped inside execute().
 */
@Entity('gst_execution_jobs')
@Unique('uq_gst_execution_jobs_approval', ['approvalId'])
@Index('idx_gst_execution_jobs_due', ['status', 'nextRunAt'])
export class GstExecutionJob extends TenantScopedEntity {
  /** The approval this job executes (one job per approval). */
  @Column({ name: 'approval_id', type: 'uuid' })
  approvalId!: string;

  /** The invoice the action targets. */
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string;

  /** einvoice_irn | eway_bill | einvoice_cancel | eway_cancel | eway_update_vehicle | eway_extend. */
  @Column({ name: 'action_kind', type: 'varchar' })
  actionKind!: string;

  /** queued | running | done | failed | dead. */
  @Column({ name: 'status', type: 'varchar', default: 'queued' })
  status!: string;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  maxAttempts!: number;

  /** The execute() outcome status of the last run (generated/cancelled/failed/…). */
  @Column({ name: 'last_outcome', type: 'varchar', nullable: true })
  lastOutcome!: string | null;

  @Column({ name: 'last_error', type: 'varchar', nullable: true })
  lastError!: string | null;

  /** When this job is next eligible to run (backoff pushes it forward on failure). */
  @Column({ name: 'next_run_at', type: 'timestamptz', default: () => 'now()' })
  nextRunAt!: Date;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy!: string | null;
}
