import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Order header (Design Doc 6 §9.1, Doc 6.1 R1).
 * Sprint 4 introduced these as the sales→operations DRAFT handoff. Sprint 5
 * (DEV-PLAN M6/B8) adds the confirmed-order lifecycle + credit control:
 * draft → confirm → (credit ok) confirmed | (limit breach) credit_hold →
 * approve → confirmed. Production planning, dispatch, batching, inventory and
 * billing remain OUT OF SCOPE (later sprints).
 *
 * order_status:  draft | confirmed | credit_hold | cancelled
 * credit_status: not_checked | approved | on_hold | rejected
 */
@Entity('orders')
@Unique('uq_orders_no', ['tenantId', 'orderNo'])
export class Order extends TenantScopedEntity {
  @Column({ name: 'order_no', type: 'varchar' }) orderNo!: string;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'quotation_id', type: 'uuid', nullable: true }) quotationId!: string | null;
  @Column({ name: 'rate_contract_id', type: 'uuid', nullable: true }) rateContractId!: string | null;
  @Column({ name: 'order_date', type: 'date', nullable: true }) orderDate!: string | null;
  @Column({ name: 'required_datetime', type: 'timestamptz', nullable: true }) requiredDatetime!: Date | null;
  @Column({ name: 'estimated_order_value', type: 'numeric', precision: 16, scale: 2, default: 0 }) estimatedOrderValue!: string;
  // GST-inclusive order value — the amount the customer actually owes, used for
  // credit exposure so it reconciles with the quotation/invoice total. Nullable:
  // rows created before this column fall back to estimated_order_value.
  @Column({ name: 'estimated_order_value_incl_gst', type: 'numeric', precision: 16, scale: 2, nullable: true }) estimatedOrderValueInclGst!: string | null;
  @Column({ name: 'pricing_source', type: 'varchar', nullable: true }) pricingSource!: string | null;
  @Column({ name: 'pricing_type', type: 'varchar', default: 'credit' }) pricingType!: string;
  @Column({ name: 'credit_status', type: 'varchar', default: 'not_checked' }) creditStatus!: string;
  @Column({ name: 'order_status', type: 'varchar', default: 'draft' }) orderStatus!: string;
  @Column({ name: 'special_instructions', type: 'text', nullable: true }) specialInstructions!: string | null;
  // Sprint 5 lifecycle fields
  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true }) confirmedBy!: string | null;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @Column({ name: 'cancelled_reason', type: 'varchar', nullable: true }) cancelledReason!: string | null;
  // Returned-concrete billing (Tier 5B): how a short pour / rejected load is
  // billed — 'net' (poured only), 'gross' (full load), or 'net_plus_fee'
  // (poured + a return charge of return_fee_per_m3 × returned m³).
  @Column({ name: 'return_billing_policy', type: 'varchar', default: 'net' }) returnBillingPolicy!: string;
  @Column({ name: 'return_fee_per_m3', type: 'numeric', precision: 14, scale: 2, default: 0 }) returnFeePerM3!: string;
}

/** Order line — grade-wise draft line (Doc 6 §9.1). */
@Entity('order_items')
export class OrderItem extends TenantScopedEntity {
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) quantityM3!: string;
  @Column({ name: 'rate_per_m3', type: 'numeric', precision: 14, scale: 2, default: 0 }) ratePerM3!: string;
  @Column({ name: 'transport_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) transportCharge!: string;
  @Column({ name: 'pump_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) pumpCharge!: string;
  @Column({ name: 'waiting_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) waitingCharge!: string;
  @Column({ name: 'gst_rate', type: 'numeric', precision: 5, scale: 2, default: 18 }) gstRate!: string;
  @Column({ name: 'slump_required', type: 'varchar', nullable: true }) slumpRequired!: string | null;
  @Column({ name: 'pump_required', type: 'boolean', default: false }) pumpRequired!: boolean;
  @Column({ name: 'required_datetime', type: 'timestamptz', nullable: true }) requiredDatetime!: Date | null;
  @Column({ name: 'delivery_interval_minutes', type: 'int', nullable: true }) deliveryIntervalMinutes!: number | null;
  @Column({ name: 'line_status', type: 'varchar', default: 'draft' }) lineStatus!: string;
}

/**
 * Pour schedule slot (Plan B1) — a timed delivery in an order's pour plan:
 * how much concrete, when, at what truck spacing, in what sequence.
 */
@Entity('pour_schedule_slots')
export class PourScheduleSlot extends TenantScopedEntity {
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'slot_date', type: 'date' }) slotDate!: string;
  /** Planned start time as HH:MM (local plant time). */
  @Column({ name: 'start_time', type: 'varchar', nullable: true }) startTime!: string | null;
  @Column({ name: 'quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) quantityM3!: string;
  @Column({ name: 'truck_spacing_minutes', type: 'int', nullable: true }) truckSpacingMinutes!: number | null;
  @Column({ name: 'pump_required', type: 'boolean', default: false }) pumpRequired!: boolean;
  @Column({ name: 'sequence_no', type: 'int', default: 0 }) sequenceNo!: number;
  @Column({ name: 'status', type: 'varchar', default: 'planned' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}
