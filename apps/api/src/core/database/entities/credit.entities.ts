import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 5 — Order lifecycle + credit control (Design Doc 6 §9, DEV-PLAN M6/B8).
 * Money columns use numeric(16,2). All tenant-scoped and RLS-enforced.
 */

/**
 * Credit-hold request raised when a booking would breach the customer credit
 * limit. An approver with `credit_hold.approve` decides; the decision and every
 * snapshot value are retained as the credit audit trail (Doc 11 §5.2).
 */
@Entity('credit_hold_requests')
export class CreditHoldRequest extends TenantScopedEntity {
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'requested_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) requestedAmount!: string;
  @Column({ name: 'credit_limit', type: 'numeric', precision: 16, scale: 2, default: 0 }) creditLimit!: string;
  @Column({ name: 'outstanding_before', type: 'numeric', precision: 16, scale: 2, default: 0 }) outstandingBefore!: string;
  @Column({ name: 'exposure_after', type: 'numeric', precision: 16, scale: 2, default: 0 }) exposureAfter!: string;
  @Column({ name: 'reason', type: 'varchar', nullable: true }) reason!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'pending' }) status!: string;
  @Column({ name: 'requested_by', type: 'uuid', nullable: true }) requestedBy!: string | null;
  @Column({ name: 'decided_by', type: 'uuid', nullable: true }) decidedBy!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  @Column({ name: 'decision_note', type: 'varchar', nullable: true }) decisionNote!: string | null;
}

/** Immutable order status-transition trail (Doc 6 §9.1 order_status_history). */
@Entity('order_status_history')
export class OrderStatusHistory extends TenantScopedEntity {
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'from_status', type: 'varchar', nullable: true }) fromStatus!: string | null;
  @Column({ name: 'to_status', type: 'varchar' }) toStatus!: string;
  @Column({ name: 'action', type: 'varchar' }) action!: string;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId!: string | null;
  @Column({ name: 'note', type: 'varchar', nullable: true }) note!: string | null;
}
