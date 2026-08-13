import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 7 — Dispatch & delivery challan (Design Doc 6 §11). Consumes CONFIRMED
 * batch tickets, moves loads across the dispatch board, and issues delivery
 * challans. Billing/invoicing, QC, weighbridge, GPS and offline sync are OUT OF
 * SCOPE (later sprints); GPS lat/long columns exist but are not populated here.
 */

/** Dispatch header for each load/trip (Doc 6 §11.1). */
@Entity('dispatches')
@Unique('uq_dispatches_no', ['tenantId', 'dispatchNo'])
export class Dispatch extends TenantScopedEntity {
  @Column({ name: 'dispatch_no', type: 'varchar' }) dispatchNo!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'batch_ticket_id', type: 'uuid', nullable: true }) batchTicketId!: string | null;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true }) vehicleId!: string | null;
  @Column({ name: 'driver_id', type: 'uuid', nullable: true }) driverId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) quantityM3!: string;
  @Column({ name: 'dispatch_status', type: 'varchar', default: 'waiting' }) dispatchStatus!: string;
  @Column({ name: 'dispatch_time', type: 'timestamptz', nullable: true }) dispatchTime!: Date | null;
  @Column({ name: 'site_arrival_time', type: 'timestamptz', nullable: true }) siteArrivalTime!: Date | null;
  @Column({ name: 'pour_start_time', type: 'timestamptz', nullable: true }) pourStartTime!: Date | null;
  @Column({ name: 'pour_end_time', type: 'timestamptz', nullable: true }) pourEndTime!: Date | null;
  @Column({ name: 'return_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) returnQuantityM3!: string;
  /** Why concrete came back / was short-loaded (Plan B3). */
  @Column({ name: 'return_reason', type: 'varchar', nullable: true }) returnReason!: string | null;
  @Column({ name: 'delay_reason', type: 'varchar', nullable: true }) delayReason!: string | null;
  /** Latest GPS fix, denormalised from `dispatch_location_pings` for the board. */
  @Column({ name: 'last_latitude', type: 'numeric', precision: 10, scale: 6, nullable: true }) lastLatitude!: string | null;
  @Column({ name: 'last_longitude', type: 'numeric', precision: 10, scale: 6, nullable: true }) lastLongitude!: string | null;
  @Column({ name: 'last_location_at', type: 'timestamptz', nullable: true }) lastLocationAt!: Date | null;
  @Column({ name: 'last_speed_kmph', type: 'numeric', precision: 6, scale: 2, nullable: true }) lastSpeedKmph!: string | null;
}

/** Delivery challan / e-ticket (Doc 6 §11.2). */
@Entity('delivery_challans')
@Unique('uq_delivery_challans_no', ['tenantId', 'challanNo'])
export class DeliveryChallan extends TenantScopedEntity {
  @Column({ name: 'challan_no', type: 'varchar' }) challanNo!: string;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'dispatch_id', type: 'uuid', nullable: true }) dispatchId!: string | null;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'batch_ticket_id', type: 'uuid', nullable: true }) batchTicketId!: string | null;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true }) vehicleId!: string | null;
  @Column({ name: 'driver_id', type: 'uuid', nullable: true }) driverId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) quantityM3!: string;
  @Column({ name: 'slump', type: 'varchar', nullable: true }) slump!: string | null;
  @Column({ name: 'dispatch_time', type: 'timestamptz', nullable: true }) dispatchTime!: Date | null;
  @Column({ name: 'receiver_name', type: 'varchar', nullable: true }) receiverName!: string | null;
  @Column({ name: 'return_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) returnQuantityM3!: string;
  /** Returned / short-load concrete (Plan B3): reason + valuation of the wasted qty. */
  @Column({ name: 'return_reason', type: 'varchar', nullable: true }) returnReason!: string | null;
  @Column({ name: 'return_cost_per_m3', type: 'numeric', precision: 14, scale: 2, default: 0 }) returnCostPerM3!: string;
  @Column({ name: 'return_cost', type: 'numeric', precision: 16, scale: 2, default: 0 }) returnCost!: string;
  @Column({ name: 'invoice_status', type: 'varchar', default: 'not_invoiced' }) invoiceStatus!: string;
  @Column({ name: 'challan_status', type: 'varchar', default: 'draft' }) challanStatus!: string;
}

/** Delivery / challan movement history (Doc 6 §11.3). */
@Entity('delivery_status_history')
export class DeliveryStatusHistory extends TenantScopedEntity {
  @Column({ name: 'dispatch_id', type: 'uuid', nullable: true }) dispatchId!: string | null;
  @Column({ name: 'challan_id', type: 'uuid', nullable: true }) challanId!: string | null;
  @Column({ name: 'old_status', type: 'varchar', nullable: true }) oldStatus!: string | null;
  @Column({ name: 'new_status', type: 'varchar' }) newStatus!: string;
  @Column({ name: 'location_latitude', type: 'numeric', precision: 10, scale: 6, nullable: true }) locationLatitude!: string | null;
  @Column({ name: 'location_longitude', type: 'numeric', precision: 10, scale: 6, nullable: true }) locationLongitude!: string | null;
  @Column({ name: 'changed_by', type: 'uuid', nullable: true }) changedBy!: string | null;
  @Column({ name: 'note', type: 'varchar', nullable: true }) note!: string | null;
}
