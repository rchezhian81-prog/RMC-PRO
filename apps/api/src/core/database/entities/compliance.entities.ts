import { Column, Entity, Unique } from 'typeorm';
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
