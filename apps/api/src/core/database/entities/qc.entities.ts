import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * QC / Lab (Plan A3). A slump test on fresh concrete and cube-strength sets with
 * their 7/28-day results, assessed against the grade's characteristic strength.
 */

/** Fresh-concrete slump test (Doc 6 §10.6 / IS 1199). */
@Entity('qc_slump_tests')
export class QcSlumpTest extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'batch_ticket_id', type: 'uuid', nullable: true }) batchTicketId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'sample_ref', type: 'varchar', nullable: true }) sampleRef!: string | null;
  @Column({ name: 'measured_slump_mm', type: 'int' }) measuredSlumpMm!: number;
  @Column({ name: 'target_min_mm', type: 'int', nullable: true }) targetMinMm!: number | null;
  @Column({ name: 'target_max_mm', type: 'int', nullable: true }) targetMaxMm!: number | null;
  @Column({ name: 'passed', type: 'boolean', default: true }) passed!: boolean;
  @Column({ name: 'tested_at', type: 'timestamptz', default: () => 'now()' }) testedAt!: Date;
  @Column({ name: 'tested_by', type: 'uuid', nullable: true }) testedBy!: string | null;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** A set of cubes cast from one sample, assessed at 28 days (IS 456 §15.4). */
@Entity('qc_cube_sets')
@Unique('uq_qc_cube_sets_no', ['tenantId', 'setNo'])
export class QcCubeSet extends TenantScopedEntity {
  @Column({ name: 'set_no', type: 'varchar' }) setNo!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'batch_ticket_id', type: 'uuid', nullable: true }) batchTicketId!: string | null;
  @Column({ name: 'mix_design_id', type: 'uuid', nullable: true }) mixDesignId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'cast_date', type: 'date' }) castDate!: string;
  @Column({ name: 'specimen_count', type: 'int', default: 3 }) specimenCount!: number;
  @Column({ name: 'cube_size_mm', type: 'int', default: 150 }) cubeSizeMm!: number;
  /** Characteristic strength fck (N/mm²) the set is judged against. */
  @Column({ name: 'target_strength_mpa', type: 'numeric', precision: 8, scale: 2 }) targetStrengthMpa!: string;
  @Column({ name: 'sampling_ref', type: 'varchar', nullable: true }) samplingRef!: string | null;
  @Column({ name: 'mean_strength_mpa', type: 'numeric', precision: 8, scale: 2, nullable: true }) meanStrengthMpa!: string | null;
  /** null until 28-day results are in, then 'accepted' | 'rejected'. */
  @Column({ name: 'acceptance_status', type: 'varchar', nullable: true }) acceptanceStatus!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'open' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** One cube's crushing result at a given age. */
@Entity('qc_cube_results')
export class QcCubeResult extends TenantScopedEntity {
  @Column({ name: 'cube_set_id', type: 'uuid' }) cubeSetId!: string;
  @Column({ name: 'test_age_days', type: 'int' }) testAgeDays!: number;
  @Column({ name: 'specimen_no', type: 'int' }) specimenNo!: number;
  @Column({ name: 'tested_on', type: 'date', nullable: true }) testedOn!: string | null;
  @Column({ name: 'load_kn', type: 'numeric', precision: 10, scale: 2, nullable: true }) loadKn!: string | null;
  @Column({ name: 'compressive_strength_mpa', type: 'numeric', precision: 8, scale: 2 }) compressiveStrengthMpa!: string;
  @Column({ name: 'passed', type: 'boolean', nullable: true }) passed!: boolean | null;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}
