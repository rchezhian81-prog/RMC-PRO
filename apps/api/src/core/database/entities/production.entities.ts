import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 6 — Production planning + batching (Design Doc 6 §10). Consumes
 * CONFIRMED orders, produces batch tickets, and reduces inventory. Dispatch,
 * delivery challan, QC, weighbridge and offline sync are OUT OF SCOPE.
 */

/** Daily production plan (Doc 6 §10.1). */
@Entity('production_plans')
@Unique('uq_production_plans_no', ['tenantId', 'planNo'])
export class ProductionPlan extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'plan_no', type: 'varchar' }) planNo!: string;
  @Column({ name: 'plan_date', type: 'date', nullable: true }) planDate!: string | null;
  @Column({ name: 'shift', type: 'varchar', nullable: true }) shift!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'notes', type: 'text', nullable: true }) notes!: string | null;
}

/** Planned order/load line (Doc 6 §10.2). */
@Entity('production_plan_items')
export class ProductionPlanItem extends TenantScopedEntity {
  @Column({ name: 'production_plan_id', type: 'uuid' }) productionPlanId!: string;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'order_item_id', type: 'uuid', nullable: true }) orderItemId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'sequence_no', type: 'int', default: 0 }) sequenceNo!: number;
  @Column({ name: 'planned_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) plannedQuantityM3!: string;
  @Column({ name: 'priority', type: 'varchar', nullable: true }) priority!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'planned' }) status!: string;
}

/** Loads waiting for batching (Doc 6 §10.3). */
@Entity('batch_queue')
export class BatchQueueEntry extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'order_item_id', type: 'uuid', nullable: true }) orderItemId!: string | null;
  @Column({ name: 'production_plan_item_id', type: 'uuid', nullable: true }) productionPlanItemId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'mix_design_id', type: 'uuid', nullable: true }) mixDesignId!: string | null;
  @Column({ name: 'planned_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) plannedQuantityM3!: string;
  @Column({ name: 'produced_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) producedQuantityM3!: string;
  @Column({ name: 'queue_status', type: 'varchar', default: 'waiting' }) queueStatus!: string;
}

/** Batch production record (Doc 6 §10.4). */
@Entity('batch_tickets')
@Unique('uq_batch_tickets_no', ['tenantId', 'batchTicketNo'])
export class BatchTicket extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'batch_ticket_no', type: 'varchar' }) batchTicketNo!: string;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'batch_queue_id', type: 'uuid', nullable: true }) batchQueueId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'mix_design_id', type: 'uuid', nullable: true }) mixDesignId!: string | null;
  @Column({ name: 'batch_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) batchQuantityM3!: string;
  @Column({ name: 'batch_start_time', type: 'timestamptz', nullable: true }) batchStartTime!: Date | null;
  @Column({ name: 'batch_end_time', type: 'timestamptz', nullable: true }) batchEndTime!: Date | null;
  @Column({ name: 'operator_user_id', type: 'uuid', nullable: true }) operatorUserId!: string | null;
  @Column({ name: 'source_type', type: 'varchar', default: 'manual' }) sourceType!: string;
  @Column({ name: 'variance_exceeded', type: 'boolean', default: false }) varianceExceeded!: boolean;
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'notes', type: 'text', nullable: true }) notes!: string | null;
  // Batching integration (Plan A4): which controller the actuals were ingested
  // from, the controller's own batch reference, and when they were ingested.
  @Column({ name: 'controller_id', type: 'uuid', nullable: true }) controllerId!: string | null;
  @Column({ name: 'controller_batch_ref', type: 'varchar', nullable: true }) controllerBatchRef!: string | null;
  @Column({ name: 'ingested_at', type: 'timestamptz', nullable: true }) ingestedAt!: Date | null;
}

/** Material target vs actual consumption for a batch (Doc 6 §10.5). */
@Entity('batch_ticket_materials')
export class BatchTicketMaterial extends TenantScopedEntity {
  @Column({ name: 'batch_ticket_id', type: 'uuid' }) batchTicketId!: string;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'target_quantity', type: 'numeric', precision: 14, scale: 3, default: 0 }) targetQuantity!: string;
  @Column({ name: 'actual_quantity', type: 'numeric', precision: 14, scale: 3, default: 0 }) actualQuantity!: string;
  @Column({ name: 'variance_quantity', type: 'numeric', precision: 14, scale: 3, default: 0 }) varianceQuantity!: string;
  @Column({ name: 'variance_percentage', type: 'numeric', precision: 8, scale: 2, default: 0 }) variancePercentage!: string;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'tolerance_percentage', type: 'numeric', precision: 6, scale: 2, default: 2 }) tolerancePercentage!: string;
  @Column({ name: 'within_tolerance', type: 'boolean', default: true }) withinTolerance!: boolean;
  // Moisture correction (Plan A2) — snapshot of the material's batching props +
  // the corrected (moist) target the operator should weigh out.
  @Column({ name: 'material_type', type: 'varchar', nullable: true }) materialType!: string | null;
  @Column({ name: 'water_absorption_pct', type: 'numeric', precision: 6, scale: 3, nullable: true }) waterAbsorptionPct!: string | null;
  @Column({ name: 'measured_moisture_pct', type: 'numeric', precision: 6, scale: 3, nullable: true }) measuredMoisturePct!: string | null;
  @Column({ name: 'corrected_target_quantity', type: 'numeric', precision: 14, scale: 3, nullable: true }) correctedTargetQuantity!: string | null;
  @Column({ name: 'free_water_quantity', type: 'numeric', precision: 14, scale: 3, nullable: true }) freeWaterQuantity!: string | null;
}

/**
 * A plant batching controller (Plan A4) — the digital head that prints the
 * per-batch actuals report. `connectionType='simulated'` drives the
 * deterministic test/demo source; `tcp`/`file` carry the real connection
 * details a plant-side agent uses to fetch the batch log. Configuration only;
 * an ingest never mutates it.
 */
@Entity('batching_controllers')
@Unique('uq_batching_controllers_name', ['tenantId', 'name'])
export class BatchingController extends TenantScopedEntity {
  @Column({ name: 'name', type: 'varchar' }) name!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'connection_type', type: 'varchar', default: 'simulated' }) connectionType!: string;
  @Column({ name: 'host', type: 'varchar', nullable: true }) host!: string | null;
  @Column({ name: 'port', type: 'int', nullable: true }) port!: number | null;
  // For 'file' connectors: where the plant-side agent drops the batch log.
  @Column({ name: 'log_path', type: 'varchar', nullable: true }) logPath!: string | null;
  @Column({ name: 'make', type: 'varchar', nullable: true }) make!: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
}
