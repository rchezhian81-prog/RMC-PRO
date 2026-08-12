import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Excel / CSV bulk import framework (Plan F1). A tracked import job: which master
 * was imported, how many rows succeeded vs failed, and the per-row errors — an
 * onboarding accelerator so a new tenant can load customers / materials /
 * suppliers from a spreadsheet instead of keying them one by one. Tenant-scoped
 * under the same FORCE-RLS policy; row-level errors kept as a jsonb array.
 */
@Entity('import_jobs')
export class ImportJob extends TenantScopedEntity {
  /** The importable master key: customers | materials | suppliers. */
  @Column({ name: 'entity_type', type: 'varchar' }) entityType!: string;
  @Column({ name: 'file_name', type: 'varchar', nullable: true }) fileName!: string | null;
  /** completed (rows processed, some may have failed) | failed (the file itself was unreadable). */
  @Column({ name: 'status', type: 'varchar', default: 'completed' }) status!: string;
  @Column({ name: 'total_rows', type: 'int', default: 0 }) totalRows!: number;
  @Column({ name: 'success_count', type: 'int', default: 0 }) successCount!: number;
  @Column({ name: 'error_count', type: 'int', default: 0 }) errorCount!: number;
  /** [{ row: number, message: string }] — the rows that were rejected and why. */
  @Column({ name: 'errors', type: 'jsonb', default: () => "'[]'::jsonb" }) errors!: Array<{ row: number; message: string }>;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
}
