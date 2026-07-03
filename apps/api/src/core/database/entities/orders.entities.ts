import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 4 — Order DRAFT entities only (Design Doc 6 §9.1, Doc 6.1 R1).
 * These exist purely as a sales→operations handoff. Confirmed-order workflow,
 * credit hold, production planning, dispatch, batching and billing are OUT OF
 * SCOPE for Sprint 4 and are introduced in later sprints. Orders created here
 * always start (and remain) in order_status = 'draft'.
 */

/** Order header — draft handoff from sales (Doc 6 §9.1). */
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
  @Column({ name: 'pricing_source', type: 'varchar', nullable: true }) pricingSource!: string | null;
  @Column({ name: 'credit_status', type: 'varchar', default: 'not_checked' }) creditStatus!: string;
  @Column({ name: 'order_status', type: 'varchar', default: 'draft' }) orderStatus!: string;
  @Column({ name: 'special_instructions', type: 'text', nullable: true }) specialInstructions!: string | null;
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
  @Column({ name: 'slump_required', type: 'varchar', nullable: true }) slumpRequired!: string | null;
  @Column({ name: 'pump_required', type: 'boolean', default: false }) pumpRequired!: boolean;
  @Column({ name: 'required_datetime', type: 'timestamptz', nullable: true }) requiredDatetime!: Date | null;
  @Column({ name: 'delivery_interval_minutes', type: 'int', nullable: true }) deliveryIntervalMinutes!: number | null;
  @Column({ name: 'line_status', type: 'varchar', default: 'draft' }) lineStatus!: string;
}
