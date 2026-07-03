import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 6 — Minimal inventory ledger to support batch consumption
 * (Design Doc 6 §12.1 / §12.2). Sprint 6 only needs opening balances and
 * batch-consumption reductions. Material inward, weighbridge and negative-stock
 * APPROVAL gating are Sprint 8 and intentionally NOT built here.
 */

/** Current material stock per plant (Doc 6 §12.1). */
@Entity('stock_balances')
@Unique('uq_stock_balances_plant_material', ['tenantId', 'plantId', 'materialId'])
export class StockBalance extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'material_id', type: 'uuid' }) materialId!: string;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'current_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) currentQuantity!: string;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'last_updated_at', type: 'timestamptz', nullable: true }) lastUpdatedAt!: Date | null;
}

/** Stock ledger (Doc 6 §12.2). transaction_type: opening | batch_consumption | adjustment. */
@Entity('stock_transactions')
export class StockTransaction extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'material_id', type: 'uuid' }) materialId!: string;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'transaction_type', type: 'varchar' }) transactionType!: string;
  @Column({ name: 'reference_type', type: 'varchar', nullable: true }) referenceType!: string | null;
  @Column({ name: 'reference_id', type: 'uuid', nullable: true }) referenceId!: string | null;
  @Column({ name: 'in_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) inQuantity!: string;
  @Column({ name: 'out_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) outQuantity!: string;
  @Column({ name: 'balance_after', type: 'numeric', precision: 16, scale: 3, default: 0 }) balanceAfter!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
}
