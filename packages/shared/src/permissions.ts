/**
 * Phase-1 permission keys (Design Addendum: RBAC Role × Permission Matrix §2).
 * Format: module.action. This is the single source of truth shared by API + web.
 */
export const PERMISSIONS = {
  // Platform (super_admin)
  PLATFORM_TENANTS_VIEW: 'platform.tenants.view',
  PLATFORM_TENANTS_MANAGE: 'platform.tenants.manage',
  PLATFORM_PLANS_MANAGE: 'platform.plans.manage',
  PLATFORM_MODULES_MANAGE: 'platform.modules.manage',
  PLATFORM_SAAS_BILLING_MANAGE: 'platform.saas_billing.manage',
  PLATFORM_COUPONS_MANAGE: 'platform.coupons.manage',
  PLATFORM_SUPPORT_ACCESS_GRANT: 'platform.support_access.grant',

  // Settings / admin
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  NUMBER_SERIES_MANAGE: 'number_series.manage',
  INTEGRATIONS_MANAGE: 'integrations.manage',

  // Masters (all master lists: customers, sites, materials, suppliers,
  // vehicles, drivers, concrete grades, plants). Granular CRUD so roles can be
  // restricted to view-only, or allowed to create/edit but not delete.
  MASTERS_VIEW: 'masters.view',
  MASTERS_CREATE: 'masters.create',
  MASTERS_EDIT: 'masters.edit',
  MASTERS_DELETE: 'masters.delete',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',

  // Sales & orders. Approving a quotation or a rate contract commits pricing to
  // a customer, so those are separate keys from creating one — a sales
  // executive can draft, only a manager can approve.
  LEADS_VIEW: 'leads.view',
  LEADS_MANAGE: 'leads.manage',
  QUOTATIONS_VIEW: 'quotations.view',
  QUOTATIONS_CREATE: 'quotations.create',
  QUOTATIONS_APPROVE: 'quotations.approve',
  QUOTATION_DISCOUNT_APPROVE: 'quotation_discount.approve',
  RATE_CONTRACTS_VIEW: 'rate_contracts.view',
  RATE_CONTRACTS_CREATE: 'rate_contracts.create',
  RATE_CONTRACTS_APPROVE: 'rate_contracts.approve',
  ORDERS_VIEW: 'orders.view',
  ORDERS_CREATE: 'orders.create',
  ORDERS_CONFIRM: 'orders.confirm',
  CREDIT_HOLD_APPROVE: 'credit_hold.approve',

  // Production & dispatch
  BATCH_TICKETS_CREATE: 'batch_tickets.create',
  DISPATCH_UPDATE_STATUS: 'dispatch.update_status',
  DELIVERY_CHALLANS_CREATE: 'delivery_challans.create',

  // Inventory
  STOCK_ADJUST: 'stock.adjust',
  STOCK_ADJUSTMENT_APPROVE: 'stock_adjustment.approve',
  NEGATIVE_STOCK_APPROVE: 'negative_stock.approve',

  // Billing
  INVOICES_CREATE: 'invoices.create',
  INVOICE_CANCELLATION_APPROVE: 'invoice_cancellation.approve',
  RECEIPTS_CREATE: 'receipts.create',

  // Masters — QC
  MIX_DESIGN_APPROVE: 'mix_design.approve',

  // Control
  APPROVALS_ACT: 'approvals.act',
  AUDIT_LOGS_VIEW: 'audit_logs.view',
  AUDIT_LOGS_EXPORT: 'audit_logs.export',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  TALLY_EXPORT_GENERATE: 'tally_export.generate',
  WHATSAPP_SEND: 'whatsapp.send',
  SYNC_MANAGE: 'sync.manage',
  DEVICES_MANAGE: 'devices.manage',
  SUPPORT_ACCESS: 'support.access',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** System role keys (Design Addendum §1). */
export const ROLE_KEYS = {
  SUPER_ADMIN: 'super_admin',
  SUPPORT_STAFF: 'support_staff',
  COMPANY_OWNER: 'company_owner',
  COMPANY_ADMIN: 'company_admin',
  PLANT_MANAGER: 'plant_manager',
  SALES_MANAGER: 'sales_manager',
  SALES_EXECUTIVE: 'sales_executive',
  DISPATCH_MANAGER: 'dispatch_manager',
  BATCHING_OPERATOR: 'batching_operator',
  STORE_STAFF: 'store_staff',
  QC_ENGINEER: 'qc_engineer',
  ACCOUNTS_MANAGER: 'accounts_manager',
  FLEET_MANAGER: 'fleet_manager',
  AUDITOR: 'auditor',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];
