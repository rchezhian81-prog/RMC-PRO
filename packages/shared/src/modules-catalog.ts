/**
 * Platform module catalog (Design Doc 6 §4.3, Doc 9 §8.3). A tenant's plan
 * decides which modules are enabled; the API enforces MODULE_NOT_ENABLED.
 */
export interface ModuleDef {
  key: string;
  name: string;
  phase: 1 | 2 | 3 | 4 | 5;
}

export const MODULE_CATALOG: ModuleDef[] = [
  { key: 'masters', name: 'Master Data', phase: 1 },
  { key: 'sales', name: 'Sales & Quotations', phase: 1 },
  { key: 'orders', name: 'Orders', phase: 1 },
  { key: 'production', name: 'Production & Batching', phase: 1 },
  { key: 'dispatch', name: 'Dispatch & Delivery', phase: 1 },
  { key: 'inventory', name: 'Inventory', phase: 1 },
  { key: 'weighbridge', name: 'Weighbridge', phase: 1 },
  { key: 'billing', name: 'Billing', phase: 1 },
  { key: 'tally_export', name: 'Tally Export', phase: 1 },
  { key: 'whatsapp_api', name: 'WhatsApp API', phase: 1 },
  { key: 'reports', name: 'Reports', phase: 1 },
  { key: 'approvals', name: 'Approvals', phase: 1 },
  { key: 'offline_sync', name: 'Offline Sync', phase: 1 },
  { key: 'driver_app', name: 'Driver App', phase: 2 },
  { key: 'gps', name: 'GPS Tracking', phase: 2 },
  { key: 'batching_integration', name: 'Batching Integration', phase: 2 },
  { key: 'qc', name: 'QC / Lab', phase: 2 },
  { key: 'purchase', name: 'Purchase', phase: 2 },
  { key: 'fleet', name: 'Fleet Maintenance & Fuel', phase: 2 },
  { key: 'expenses', name: 'Expenses', phase: 2 },
  { key: 'customer_portal', name: 'Customer Portal', phase: 4 },
];

export const MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);
