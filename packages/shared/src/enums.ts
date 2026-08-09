/**
 * Core status enums (Design Doc 6 §4.1, §9.1, §11.x; Design Doc 9 §7.2).
 */

export type TenantStatus = 'trial' | 'active' | 'grace' | 'suspended' | 'cancelled';

export type UserType =
  | 'super_admin'
  | 'tenant_user'
  | 'support_user'
  | 'customer_user'
  | 'driver_user';

export type OrderStatus =
  | 'draft'
  | 'credit_hold'
  | 'confirmed'
  | 'scheduled'
  | 'in_production'
  | 'partially_dispatched'
  | 'completed'
  | 'cancelled'
  | 'on_hold';

export type CreditStatus = 'not_checked' | 'passed' | 'failed' | 'override_approved';

export type DispatchStatus =
  | 'waiting'
  | 'under_batching'
  | 'loaded'
  | 'left_plant'
  | 'reached_site'
  | 'pouring'
  | 'completed'
  | 'returning'
  | 'delayed'
  | 'rejected'
  | 'cancelled';

export type ApprovalType =
  | 'credit_hold_release'
  | 'negative_stock'
  | 'quotation_discount'
  | 'invoice_cancellation'
  | 'stock_adjustment'
  | 'mix_design_approval';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'conflict';

export type InvoiceItemType = 'concrete' | 'pumping' | 'transport' | 'waiting_charge' | 'other';
