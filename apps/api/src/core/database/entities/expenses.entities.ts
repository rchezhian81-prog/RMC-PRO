import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Expense capture (Plan D4). Day-to-day cash/bank spend — driver bata, fuel,
 * plant & site expenses — booked as vouchers whose lines each carry a cost
 * allocation (to a plant, vehicle or site) so spend can be reported per cost
 * object. Two masters (`expense_groups` → `expense_heads`) categorise it. All
 * tenant-scoped under the same FORCE-RLS policy; money columns numeric(16,2).
 */

/** Top-level expense category (e.g. "Fuel & Lubricants", "Salaries & Wages"). */
@Entity('expense_groups')
@Unique('uq_expense_groups_code', ['tenantId', 'groupCode'])
export class ExpenseGroup extends TenantScopedEntity {
  @Column({ name: 'group_code', type: 'varchar' }) groupCode!: string;
  @Column({ name: 'group_name', type: 'varchar' }) groupName!: string;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** An individual expense type under a group (e.g. "Driver Bata", "Diesel"). */
@Entity('expense_heads')
@Unique('uq_expense_heads_code', ['tenantId', 'headCode'])
export class ExpenseHead extends TenantScopedEntity {
  @Column({ name: 'head_code', type: 'varchar' }) headCode!: string;
  @Column({ name: 'head_name', type: 'varchar' }) headName!: string;
  @Column({ name: 'group_id', type: 'uuid', nullable: true }) groupId!: string | null;
  /** Suggested cost object for lines of this head: plant | vehicle | site | general. */
  @Column({ name: 'default_cost_type', type: 'varchar', nullable: true }) defaultCostType!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Expense voucher header — one payment, one or more allocated lines. */
@Entity('expense_vouchers')
@Unique('uq_expense_vouchers_no', ['tenantId', 'voucherNo'])
export class ExpenseVoucher extends TenantScopedEntity {
  @Column({ name: 'voucher_no', type: 'varchar' }) voucherNo!: string;
  @Column({ name: 'voucher_date', type: 'date', nullable: true }) voucherDate!: string | null;
  @Column({ name: 'payee', type: 'varchar', nullable: true }) payee!: string | null;
  /** cash | bank | upi | cheque. */
  @Column({ name: 'payment_mode', type: 'varchar', nullable: true }) paymentMode!: string | null;
  /** Booking plant (the plant whose petty cash / account this is paid from). */
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'narration', type: 'varchar', nullable: true }) narration!: string | null;
  @Column({ name: 'total_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) totalAmount!: string;
  /** draft → posted; or cancelled. */
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** One expense line — a head, an amount, and the cost object it is charged to. */
@Entity('expense_voucher_lines')
export class ExpenseVoucherLine extends TenantScopedEntity {
  @Column({ name: 'expense_voucher_id', type: 'uuid' }) expenseVoucherId!: string;
  @Column({ name: 'expense_head_id', type: 'uuid', nullable: true }) expenseHeadId!: string | null;
  @Column({ name: 'expense_head_label', type: 'varchar', nullable: true }) expenseHeadLabel!: string | null;
  @Column({ name: 'description', type: 'varchar', nullable: true }) description!: string | null;
  @Column({ name: 'amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) amount!: string;
  /** Cost object type: plant | vehicle | site | general. */
  @Column({ name: 'allocation_type', type: 'varchar', default: 'general' }) allocationType!: string;
  /** Id of the plant / vehicle / site charged (null for general). */
  @Column({ name: 'allocation_id', type: 'uuid', nullable: true }) allocationId!: string | null;
  /** Denormalised cost-object label for display + reporting. */
  @Column({ name: 'allocation_label', type: 'varchar', nullable: true }) allocationLabel!: string | null;
}
