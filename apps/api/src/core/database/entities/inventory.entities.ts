import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Inventory (Design Doc 6 §12). Sprint 6 introduced the ledger (stock_balances,
 * stock_transactions) for batch consumption. Sprint 8 adds material inward,
 * weighbridge entries and the negative-stock approval flow on top.
 */

/** Current material stock per plant (Doc 6 §12.1). */
@Entity('stock_balances')
@Unique('uq_stock_balances_plant_material', ['tenantId', 'plantId', 'materialId'])
export class StockBalance extends TenantScopedEntity {
  // plant_id is NOT NULL: a balance is meaningless without a plant, and a null
  // here defeats the unique constraint (Postgres treats NULLs as distinct),
  // which is exactly what created the "ghost" duplicate balance rows.
  @Column({ name: 'plant_id', type: 'uuid' }) plantId!: string;
  @Column({ name: 'material_id', type: 'uuid' }) materialId!: string;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'current_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) currentQuantity!: string;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'last_updated_at', type: 'timestamptz', nullable: true }) lastUpdatedAt!: Date | null;
}

/** Stock ledger (Doc 6 §12.2). transaction_type: opening | batch_consumption | adjustment. */
@Entity('stock_transactions')
export class StockTransaction extends TenantScopedEntity {
  // NOT NULL (migration 17): every movement resolves a plant before it is
  // written (StockService.resolvePlant), so a plant-less ledger row — the other
  // half of the null-plant "ghost row" bug — can no longer be persisted.
  @Column({ name: 'plant_id', type: 'uuid' }) plantId!: string;
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

/** Material inward / GRN (Doc 6 §12.3). Posting increases stock. */
@Entity('material_inwards')
@Unique('uq_material_inwards_no', ['tenantId', 'inwardNo'])
export class MaterialInward extends TenantScopedEntity {
  @Column({ name: 'inward_no', type: 'varchar' }) inwardNo!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'vehicle_no', type: 'varchar', nullable: true }) vehicleNo!: string | null;
  @Column({ name: 'supplier_challan_no', type: 'varchar', nullable: true }) supplierChallanNo!: string | null;
  @Column({ name: 'weighbridge_entry_id', type: 'uuid', nullable: true }) weighbridgeEntryId!: string | null;
  @Column({ name: 'quantity_received', type: 'numeric', precision: 16, scale: 3, default: 0 }) quantityReceived!: string;
  @Column({ name: 'quantity_accepted', type: 'numeric', precision: 16, scale: 3, default: 0 }) quantityAccepted!: string;
  @Column({ name: 'rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) rate!: string;
  @Column({ name: 'amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) amount!: string;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
}

/**
 * Weighbridge transaction (Doc 6 §12.4). Manual entry (net = gross − tare), or
 * captured from a live indicator read (Plan E1). `weightSource` records whether
 * the weights came off the scale head (`device`) or were hand-keyed (`manual`);
 * `manualOverride` is set when an operator edits a device-captured weight.
 */
@Entity('weighbridge_entries')
@Unique('uq_weighbridge_entries_slip', ['tenantId', 'slipNo'])
export class WeighbridgeEntry extends TenantScopedEntity {
  @Column({ name: 'slip_no', type: 'varchar' }) slipNo!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'vehicle_no', type: 'varchar', nullable: true }) vehicleNo!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'gross_weight', type: 'numeric', precision: 16, scale: 3, default: 0 }) grossWeight!: string;
  @Column({ name: 'tare_weight', type: 'numeric', precision: 16, scale: 3, default: 0 }) tareWeight!: string;
  @Column({ name: 'net_weight', type: 'numeric', precision: 16, scale: 3, default: 0 }) netWeight!: string;
  @Column({ name: 'supplier_challan_no', type: 'varchar', nullable: true }) supplierChallanNo!: string | null;
  @Column({ name: 'entry_datetime', type: 'timestamptz', nullable: true }) entryDatetime!: Date | null;
  @Column({ name: 'operator_user_id', type: 'uuid', nullable: true }) operatorUserId!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
  // E1 hardware bridge: provenance of the weights on this entry.
  @Column({ name: 'weight_source', type: 'varchar', default: 'manual' }) weightSource!: string;
  @Column({ name: 'indicator_id', type: 'uuid', nullable: true }) indicatorId!: string | null;
  @Column({ name: 'manual_override', type: 'boolean', default: false }) manualOverride!: boolean;
}

/**
 * A weighbridge indicator device (Plan E1) — the digital head wired to the load
 * cells, reachable over serial/COM or a TCP socket. `connectionType='simulated'`
 * drives the deterministic test/demo source; `tcp`/`serial` carry the real
 * connection details used by a plant-side reader. This is configuration only;
 * a live read never mutates it.
 */
@Entity('weighbridge_indicators')
@Unique('uq_weighbridge_indicators_name', ['tenantId', 'name'])
export class WeighbridgeIndicator extends TenantScopedEntity {
  @Column({ name: 'name', type: 'varchar' }) name!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'connection_type', type: 'varchar', default: 'simulated' }) connectionType!: string;
  @Column({ name: 'host', type: 'varchar', nullable: true }) host!: string | null;
  @Column({ name: 'port', type: 'int', nullable: true }) port!: number | null;
  @Column({ name: 'com_port', type: 'varchar', nullable: true }) comPort!: string | null;
  @Column({ name: 'baud_rate', type: 'int', nullable: true }) baudRate!: number | null;
  @Column({ name: 'unit', type: 'varchar', default: 'kg' }) unit!: string;
  // For simulated devices: the nominal weight the source settles on (kg).
  @Column({ name: 'simulated_weight_kg', type: 'numeric', precision: 16, scale: 3, nullable: true }) simulatedWeightKg!: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
}

/** Negative-stock approval request (Doc 6 §12.5). */
@Entity('negative_stock_requests')
export class NegativeStockRequest extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'available_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) availableQuantity!: string;
  @Column({ name: 'required_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) requiredQuantity!: string;
  @Column({ name: 'negative_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) negativeQuantity!: string;
  @Column({ name: 'reference_type', type: 'varchar', nullable: true }) referenceType!: string | null;
  @Column({ name: 'reference_id', type: 'uuid', nullable: true }) referenceId!: string | null;
  @Column({ name: 'requested_by', type: 'uuid', nullable: true }) requestedBy!: string | null;
  @Column({ name: 'request_reason', type: 'varchar', nullable: true }) requestReason!: string | null;
  @Column({ name: 'approval_status', type: 'varchar', default: 'pending' }) approvalStatus!: string;
  @Column({ name: 'approved_by', type: 'uuid', nullable: true }) approvedBy!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'approval_remarks', type: 'varchar', nullable: true }) approvalRemarks!: string | null;
}
