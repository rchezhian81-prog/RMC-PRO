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

const P = PERMISSIONS;

/**
 * Every permission a tenant user can hold — the whole catalogue minus the
 * `platform.*` keys, which govern the SaaS platform itself (creating tenants,
 * editing plans, granting support access) and belong to Mix Nova, never to a
 * customer. This is what "full access inside your own company" means, and it is
 * the most a Company Owner or Company Admin may be granted.
 */
export const TENANT_PERMISSIONS: Permission[] = Object.values(P).filter(
  (k) => !k.startsWith('platform.'),
) as Permission[];

/** Roles every tenant has from the start, over and above the operational ones. */
export const SYSTEM_ROLE_KEYS: string[] = [ROLE_KEYS.COMPANY_OWNER, ROLE_KEYS.COMPANY_ADMIN];

/** True for a key that governs the platform rather than one company's data. */
export const isPlatformPermission = (key: string): boolean => key.startsWith('platform.');

/** Read-only access across the business — the base an auditor gets. */
const VIEW_ONLY: Permission[] = [
  P.MASTERS_VIEW, P.CUSTOMERS_VIEW, P.LEADS_VIEW, P.QUOTATIONS_VIEW,
  P.RATE_CONTRACTS_VIEW, P.ORDERS_VIEW, P.REPORTS_VIEW,
];

/**
 * Default permissions for each operational role.
 *
 * These are starting points sized to the job, not a straitjacket: an owner can
 * retick anything in Setup → Roles, and those edits are never overwritten (the
 * bootstrap only seeds a role the first time it appears).
 *
 * The separations that matter commercially are deliberate:
 *   - A sales executive drafts quotations; only a manager approves them, and
 *     only a manager approves rate contracts (both commit pricing).
 *   - Credit-hold release sits with the plant manager, not with sales.
 *   - Mix-design approval sits with QC alone.
 *   - Nobody but the owner/admin gets users, roles, or settings.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<string, Permission[]> = {
  // Runs the plant day to day: everything operational, no company admin.
  [ROLE_KEYS.PLANT_MANAGER]: [
    P.MASTERS_VIEW, P.CUSTOMERS_VIEW,
    P.LEADS_VIEW, P.QUOTATIONS_VIEW, P.QUOTATIONS_CREATE, P.QUOTATIONS_APPROVE,
    P.RATE_CONTRACTS_VIEW, P.ORDERS_VIEW, P.ORDERS_CREATE, P.ORDERS_CONFIRM,
    P.CREDIT_HOLD_APPROVE, P.APPROVALS_ACT,
    P.BATCH_TICKETS_CREATE, P.DISPATCH_UPDATE_STATUS, P.DELIVERY_CHALLANS_CREATE,
    P.STOCK_ADJUST, P.STOCK_ADJUSTMENT_APPROVE, P.NEGATIVE_STOCK_APPROVE,
    P.INVOICES_CREATE, P.RECEIPTS_CREATE,
    P.REPORTS_VIEW, P.REPORTS_EXPORT, P.WHATSAPP_SEND,
  ],

  // Owns pricing: can approve what an executive drafts.
  [ROLE_KEYS.SALES_MANAGER]: [
    P.MASTERS_VIEW, P.CUSTOMERS_VIEW, P.CUSTOMERS_CREATE, P.CUSTOMERS_EDIT,
    P.LEADS_VIEW, P.LEADS_MANAGE,
    P.QUOTATIONS_VIEW, P.QUOTATIONS_CREATE, P.QUOTATIONS_APPROVE, P.QUOTATION_DISCOUNT_APPROVE,
    P.RATE_CONTRACTS_VIEW, P.RATE_CONTRACTS_CREATE, P.RATE_CONTRACTS_APPROVE,
    P.ORDERS_VIEW, P.ORDERS_CREATE,
    P.REPORTS_VIEW, P.WHATSAPP_SEND,
  ],

  // Drafts and follows up; cannot approve its own pricing.
  [ROLE_KEYS.SALES_EXECUTIVE]: [
    P.MASTERS_VIEW, P.CUSTOMERS_VIEW, P.CUSTOMERS_CREATE,
    P.LEADS_VIEW, P.LEADS_MANAGE,
    P.QUOTATIONS_VIEW, P.QUOTATIONS_CREATE,
    P.RATE_CONTRACTS_VIEW, P.ORDERS_VIEW,
    P.REPORTS_VIEW, P.WHATSAPP_SEND,
  ],

  [ROLE_KEYS.DISPATCH_MANAGER]: [
    P.MASTERS_VIEW, P.ORDERS_VIEW,
    P.DISPATCH_UPDATE_STATUS, P.DELIVERY_CHALLANS_CREATE,
    P.REPORTS_VIEW, P.WHATSAPP_SEND,
  ],

  // At the batching panel: needs the order, the mix and the materials.
  [ROLE_KEYS.BATCHING_OPERATOR]: [
    P.MASTERS_VIEW, P.ORDERS_VIEW, P.BATCH_TICKETS_CREATE, P.REPORTS_VIEW,
  ],

  // Receives material and keeps the stock straight.
  [ROLE_KEYS.STORE_STAFF]: [
    P.MASTERS_VIEW, P.STOCK_ADJUST, P.REPORTS_VIEW,
  ],

  // Owns the recipe: the only role that can approve a mix design.
  [ROLE_KEYS.QC_ENGINEER]: [
    P.MASTERS_VIEW, P.MIX_DESIGN_APPROVE, P.ORDERS_VIEW, P.REPORTS_VIEW,
  ],

  [ROLE_KEYS.ACCOUNTS_MANAGER]: [
    P.MASTERS_VIEW, P.CUSTOMERS_VIEW, P.ORDERS_VIEW,
    P.INVOICES_CREATE, P.INVOICE_CANCELLATION_APPROVE, P.RECEIPTS_CREATE,
    P.TALLY_EXPORT_GENERATE, P.REPORTS_VIEW, P.REPORTS_EXPORT, P.WHATSAPP_SEND,
  ],

  [ROLE_KEYS.FLEET_MANAGER]: [
    P.MASTERS_VIEW, P.MASTERS_EDIT, P.DISPATCH_UPDATE_STATUS, P.REPORTS_VIEW,
  ],

  // Looks, never touches.
  [ROLE_KEYS.AUDITOR]: [
    ...VIEW_ONLY, P.REPORTS_EXPORT, P.AUDIT_LOGS_VIEW, P.AUDIT_LOGS_EXPORT,
  ],
};

/** Human-readable names for the roles seeded into every tenant. */
export const ROLE_LABELS: Record<string, string> = {
  [ROLE_KEYS.COMPANY_OWNER]: 'Company Owner',
  [ROLE_KEYS.COMPANY_ADMIN]: 'Company Admin',
  [ROLE_KEYS.PLANT_MANAGER]: 'Plant Manager',
  [ROLE_KEYS.SALES_MANAGER]: 'Sales Manager',
  [ROLE_KEYS.SALES_EXECUTIVE]: 'Sales Executive',
  [ROLE_KEYS.DISPATCH_MANAGER]: 'Dispatch Manager',
  [ROLE_KEYS.BATCHING_OPERATOR]: 'Batching Operator',
  [ROLE_KEYS.STORE_STAFF]: 'Store Staff',
  [ROLE_KEYS.QC_ENGINEER]: 'QC Engineer',
  [ROLE_KEYS.ACCOUNTS_MANAGER]: 'Accounts Manager',
  [ROLE_KEYS.FLEET_MANAGER]: 'Fleet Manager',
  [ROLE_KEYS.AUDITOR]: 'Auditor',
};
