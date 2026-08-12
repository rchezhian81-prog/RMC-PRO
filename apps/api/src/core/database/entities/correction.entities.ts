import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Document correction / amendment trail (Plan F2). A posted document can't be
 * silently edited; a correction records what changed on it (field, old → new
 * value), why, and by whom — a lightweight amendment log distinct from the
 * system audit trail, surfaced against the document itself. Tenant-scoped under
 * the same FORCE-RLS policy.
 */
@Entity('document_corrections')
export class DocumentCorrection extends TenantScopedEntity {
  /** The corrected document's type, e.g. invoice | delivery_challan | vendor_bill. */
  @Column({ name: 'document_type', type: 'varchar' }) documentType!: string;
  @Column({ name: 'document_id', type: 'uuid' }) documentId!: string;
  /** Human label of the document (its number), denormalised for the trail. */
  @Column({ name: 'document_label', type: 'varchar', nullable: true }) documentLabel!: string | null;
  /** The field/attribute that was corrected. */
  @Column({ name: 'field', type: 'varchar' }) field!: string;
  @Column({ name: 'old_value', type: 'varchar', nullable: true }) oldValue!: string | null;
  @Column({ name: 'new_value', type: 'varchar', nullable: true }) newValue!: string | null;
  @Column({ name: 'reason', type: 'varchar', nullable: true }) reason!: string | null;
  @Column({ name: 'corrected_by', type: 'uuid', nullable: true }) correctedBy!: string | null;
}
