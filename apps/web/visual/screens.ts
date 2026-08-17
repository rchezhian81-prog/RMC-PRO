/**
 * The authenticated tenant-owner routes captured by the visual suite, shared by
 * baseline.spec.ts (gated pixel baselines) and evidence.spec.ts (functional
 * fingerprints for flag-OFF↔V2 parity). One entry per route across every nav
 * group, rendered against the seeded VISUAL tenant.
 *
 * The two AI routes render their deterministic "AI unavailable" state when no
 * ANTHROPIC_API_KEY is set (the state they ship in for a tenant without AI), so
 * they are stable to baseline.
 *
 * Excluded here and handled elsewhere: /app/audit + /app/dispatch/tracking
 * (non-deterministic — evidence-only capture in evidence.spec, N/A for a pixel
 * baseline), every [id]/[name] detail route (needs a seeded transactional
 * record), /admin/* (super-admin persona — evidence.spec), and /app (redirect).
 */
export interface Screen {
  name: string;
  path: string;
}

export const SCREENS: Screen[] = [
  // Overview
  { name: 'dashboard', path: '/app/dashboard' },
  { name: 'account', path: '/app/account' },
  { name: 'assistant', path: '/app/assistant' },
  // Setup
  { name: 'setup-company', path: '/app/company' },
  { name: 'users', path: '/app/users' },
  { name: 'roles', path: '/app/roles' },
  { name: 'numbering', path: '/app/numbering' },
  { name: 'imports', path: '/app/imports' },
  { name: 'settings', path: '/app/settings' },
  // Masters (all served by /app/entity/[name])
  { name: 'masters-plants', path: '/app/entity/plants' },
  { name: 'masters-number-series', path: '/app/entity/number-series' },
  { name: 'masters-customers', path: '/app/entity/customers' },
  { name: 'masters-sites', path: '/app/entity/sites' },
  { name: 'masters-materials', path: '/app/entity/materials' },
  { name: 'masters-uoms', path: '/app/entity/uoms' },
  { name: 'masters-uom-conversions', path: '/app/entity/uom-conversions' },
  { name: 'masters-suppliers', path: '/app/entity/suppliers' },
  { name: 'masters-vehicles', path: '/app/entity/vehicles' },
  { name: 'masters-drivers', path: '/app/entity/drivers' },
  { name: 'masters-transporters', path: '/app/entity/transporters' },
  { name: 'masters-grades', path: '/app/entity/concrete-grades' },
  // Sales
  { name: 'sales-leads', path: '/app/sales/leads' },
  { name: 'sales-quotations', path: '/app/sales/quotations' },
  { name: 'sales-rate-contracts', path: '/app/sales/rate-contracts' },
  { name: 'sales-order-drafts', path: '/app/sales/order-drafts' },
  { name: 'sales-import-po', path: '/app/sales/import-po' },
  // Orders
  { name: 'orders', path: '/app/orders' },
  { name: 'credit-holds', path: '/app/credit-holds' },
  // Production
  { name: 'production-mix-designs', path: '/app/production/mix-designs' },
  { name: 'production-plans', path: '/app/production/plans' },
  { name: 'production-batch-queue', path: '/app/production/batch-queue' },
  { name: 'production-batch-tickets', path: '/app/production/batch-tickets' },
  { name: 'production-stock', path: '/app/production/stock' },
  { name: 'production-reports', path: '/app/production/reports' },
  // Quality
  { name: 'qc-slump', path: '/app/qc/slump' },
  { name: 'qc-cubes', path: '/app/qc/cubes' },
  // Dispatch
  { name: 'dispatch-board', path: '/app/dispatch/board' },
  { name: 'dispatch-challans', path: '/app/dispatch/challans' },
  // Inventory
  { name: 'inventory-inward', path: '/app/inventory/inward' },
  { name: 'inventory-weighbridge', path: '/app/inventory/weighbridge' },
  { name: 'inventory-adjustments', path: '/app/inventory/adjustments' },
  { name: 'inventory-negative-stock', path: '/app/inventory/negative-stock' },
  { name: 'inventory-reports', path: '/app/inventory/reports' },
  // Purchase
  { name: 'purchase-orders', path: '/app/purchase/orders' },
  { name: 'purchase-bills', path: '/app/purchase/bills' },
  // Fleet
  { name: 'fleet-maintenance', path: '/app/fleet/maintenance' },
  { name: 'fleet-fuel', path: '/app/fleet/fuel' },
  // Expenses
  { name: 'expenses-vouchers', path: '/app/expenses/vouchers' },
  { name: 'expenses-heads', path: '/app/expenses/heads' },
  // Billing
  { name: 'billing-invoices', path: '/app/billing/invoices' },
  { name: 'billing-receipts', path: '/app/billing/receipts' },
  { name: 'billing-outstanding', path: '/app/billing/outstanding' },
  { name: 'billing-reports', path: '/app/billing/reports' },
  // Control
  { name: 'reports-center', path: '/app/reports' },
  { name: 'corrections', path: '/app/corrections' },
  { name: 'devices-sync', path: '/app/devices' },
];
