import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 6 — Mix design master (Design Doc 6 §7.7 / §7.8). A recipe of material
 * proportions per m³ for a grade. Batching may only use an APPROVED mix design
 * (validated in BatchTicketService).
 */
@Entity('mix_designs')
@Unique('uq_mix_designs_code', ['tenantId', 'mixCode', 'versionNo'])
export class MixDesign extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'mix_code', type: 'varchar' }) mixCode!: string;
  @Column({ name: 'version_no', type: 'int', default: 1 }) versionNo!: number;
  @Column({ name: 'slump_min', type: 'int', nullable: true }) slumpMin!: number | null;
  @Column({ name: 'slump_max', type: 'int', nullable: true }) slumpMax!: number | null;
  @Column({ name: 'cement_type', type: 'varchar', nullable: true }) cementType!: string | null;
  @Column({ name: 'water_cement_ratio', type: 'numeric', precision: 6, scale: 3, nullable: true }) waterCementRatio!: string | null;
  @Column({ name: 'pumpable', type: 'boolean', default: false }) pumpable!: boolean;
  @Column({ name: 'approval_status', type: 'varchar', default: 'draft' }) approvalStatus!: string;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'is_active_version', type: 'boolean', default: true }) isActiveVersion!: boolean;
  @Column({ name: 'notes', type: 'text', nullable: true }) notes!: string | null;
}

/** Material proportions of a mix design — target per m³ (Doc 6 §7.8). */
@Entity('mix_design_materials')
export class MixDesignMaterial extends TenantScopedEntity {
  @Column({ name: 'mix_design_id', type: 'uuid' }) mixDesignId!: string;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'target_quantity', type: 'numeric', precision: 14, scale: 3, default: 0 }) targetQuantity!: string;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'tolerance_percentage', type: 'numeric', precision: 6, scale: 2, default: 2 }) tolerancePercentage!: string;
  @Column({ name: 'sequence_no', type: 'int', default: 0 }) sequenceNo!: number;
}
