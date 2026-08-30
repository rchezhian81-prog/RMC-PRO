import { MATERIAL_TYPES, UOM_CATEGORIES } from '@rmc/shared';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'boolean';
  required?: boolean;
  /** Seed for a boolean field on a NEW record, so the checkbox matches the
   * server-side column default (e.g. a series is Active by default). */
  default?: boolean;
  /** When set, the field renders as a dropdown of these options. */
  options?: { value: string; label: string }[];
  /**
   * Renders as a dropdown whose options are fetched from another master.
   * `value`/`label` name the columns to read from each fetched row. Use this
   * for foreign keys (e.g. a site's customer, a series' plant) so the operator
   * picks a real record instead of typing an id.
   */
  ref?: { path: string; value: string; label: string };
}

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const MATERIAL_TYPE_LABELS: Record<string, string> = {
  cement: 'Cement',
  fine_aggregate: 'Fine aggregate (sand)',
  coarse_aggregate: 'Coarse aggregate',
  water: 'Water',
  admixture: 'Admixture',
  additive: 'Additive (fly ash / GGBS)',
  other: 'Other',
};
const MATERIAL_TYPE_OPTIONS = MATERIAL_TYPES.map((t) => ({ value: t, label: MATERIAL_TYPE_LABELS[t] ?? t }));
const UOM_CATEGORY_OPTIONS = UOM_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }));

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'b2b', label: 'B2B (registered)' },
  { value: 'b2c', label: 'B2C (unregistered)' },
  { value: 'government', label: 'Government' },
  { value: 'dealer', label: 'Dealer' },
];
const VEHICLE_TYPE_OPTIONS = [
  { value: 'transit_mixer', label: 'Transit mixer' },
  { value: 'concrete_pump', label: 'Concrete pump' },
  { value: 'tipper', label: 'Tipper' },
  { value: 'other', label: 'Other' },
];
const OWNERSHIP_OPTIONS = [
  { value: 'own', label: 'Own' },
  { value: 'hired', label: 'Hired' },
];

// The document types that actually own a number series (every value the server
// allocates a series for, from the numbering call-sites). A dropdown of these
// stops a typo creating an orphan series no document ever uses. value = the key
// the backend stores; label = a readable form of the same key.
const DOCUMENT_TYPES = [
  'quotation', 'rate_contract', 'order', 'production_plan', 'batch_ticket',
  'dispatch', 'delivery_challan', 'invoice', 'receipt', 'weighbridge',
  'material_inward', 'goods_receipt', 'purchase_order', 'purchase_bill',
  'purchase_payment', 'expense_voucher', 'maintenance_job', 'qc_cube_set', 'lead',
] as const;
const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map((d) => ({ value: d, label: titleCase(d.replace(/_/g, ' ')) }));

export interface EntityConfig {
  path: string; // API path AND URL slug
  title: string;
  columns: string[];
  fields: FieldDef[];
}

export const ENTITY_CONFIG: Record<string, EntityConfig> = {
  customers: {
    path: 'customers',
    title: 'Customers',
    columns: ['customerCode', 'customerName', 'gstin', 'state', 'creditLimit', 'status'],
    fields: [
      { key: 'customerCode', label: 'Code', required: true },
      { key: 'customerName', label: 'Name', required: true },
      { key: 'customerType', label: 'Customer type', options: CUSTOMER_TYPE_OPTIONS },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'pan', label: 'PAN' },
      { key: 'billingAddress', label: 'Billing address' },
      { key: 'city', label: 'City' },
      // State is required: it is the place-of-supply that decides CGST/SGST vs
      // IGST on every quotation, order and invoice — a customer saved without it
      // is silently taxed intra-state.
      { key: 'state', label: 'State', required: true },
      { key: 'pincode', label: 'PIN code' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'creditLimit', label: 'Credit limit', type: 'number' },
      { key: 'creditDays', label: 'Credit days', type: 'number' },
      // Pre-existing receivable at go-live — the first term of the customer's
      // credit exposure, so it must be capturable.
      { key: 'openingBalance', label: 'Opening balance (₹)', type: 'number' },
    ],
  },
  sites: {
    path: 'sites',
    title: 'Sites / Projects',
    columns: ['siteCode', 'siteName', 'city', 'state', 'status'],
    fields: [
      { key: 'siteCode', label: 'Code', required: true },
      { key: 'siteName', label: 'Name', required: true },
      { key: 'customerId', label: 'Customer', ref: { path: 'customers', value: 'id', label: 'customerName' } },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'pincode', label: 'PIN code' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'pumpRequired', label: 'Pump required', type: 'boolean', default: false },
    ],
  },
  materials: {
    path: 'materials',
    title: 'Materials',
    columns: ['materialCode', 'materialName', 'materialType', 'uom', 'hsnCode', 'status'],
    fields: [
      { key: 'materialCode', label: 'Code', required: true },
      { key: 'materialName', label: 'Name', required: true },
      { key: 'materialType', label: 'Type', options: MATERIAL_TYPE_OPTIONS },
      { key: 'category', label: 'Category' },
      { key: 'uom', label: 'UOM', ref: { path: 'uoms', value: 'uomCode', label: 'uomName' } },
      { key: 'hsnCode', label: 'HSN' },
      { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
      { key: 'standardRate', label: 'Standard rate', type: 'number' },
      { key: 'specificGravity', label: 'Specific gravity', type: 'number' },
      { key: 'bulkDensity', label: 'Bulk density (kg/m³)', type: 'number' },
      { key: 'waterAbsorptionPct', label: 'Water absorption %', type: 'number' },
      { key: 'defaultMoisturePct', label: 'Default moisture %', type: 'number' },
    ],
  },
  uoms: {
    path: 'uoms',
    title: 'Units (UOM)',
    columns: ['uomCode', 'uomName', 'uomCategory', 'status'],
    fields: [
      { key: 'uomCode', label: 'Code', required: true },
      { key: 'uomName', label: 'Name', required: true },
      { key: 'uomCategory', label: 'Category', options: UOM_CATEGORY_OPTIONS },
    ],
  },
  'uom-conversions': {
    path: 'uom-conversions',
    title: 'Unit Conversions',
    columns: ['fromUom', 'toUom', 'factor'],
    fields: [
      { key: 'fromUom', label: 'From UOM', required: true },
      { key: 'toUom', label: 'To UOM', required: true },
      { key: 'factor', label: 'Factor (1 from = ? to)', type: 'number', required: true },
    ],
  },
  suppliers: {
    path: 'suppliers',
    title: 'Suppliers',
    columns: ['supplierCode', 'supplierName', 'gstin', 'state', 'status'],
    fields: [
      { key: 'supplierCode', label: 'Code', required: true },
      { key: 'supplierName', label: 'Name', required: true },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'pan', label: 'PAN' },
      { key: 'state', label: 'State' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'paymentTerms', label: 'Payment terms' },
    ],
  },
  vehicles: {
    path: 'vehicles',
    title: 'Vehicles',
    columns: ['vehicleNo', 'vehicleType', 'capacityM3', 'insuranceExpiry', 'fitnessExpiry', 'status'],
    fields: [
      { key: 'vehicleNo', label: 'Vehicle No', required: true },
      { key: 'vehicleType', label: 'Type', options: VEHICLE_TYPE_OPTIONS },
      { key: 'driverId', label: 'Assigned driver', ref: { path: 'drivers', value: 'id', label: 'driverName' } },
      { key: 'capacityM3', label: 'Capacity (m³)', type: 'number' },
      { key: 'ownershipType', label: 'Ownership', options: OWNERSHIP_OPTIONS },
      { key: 'insuranceExpiry', label: 'Insurance expiry', type: 'date' },
      { key: 'fitnessExpiry', label: 'Fitness (FC) expiry', type: 'date' },
      { key: 'permitExpiry', label: 'Permit expiry', type: 'date' },
      { key: 'pollutionExpiry', label: 'Pollution (PUC) expiry', type: 'date' },
      { key: 'roadTaxExpiry', label: 'Road tax expiry', type: 'date' },
    ],
  },
  drivers: {
    path: 'drivers',
    title: 'Drivers',
    columns: ['driverCode', 'driverName', 'mobile', 'licenseNo', 'licenseExpiry', 'status'],
    fields: [
      { key: 'driverCode', label: 'Code', required: true },
      { key: 'driverName', label: 'Name', required: true },
      { key: 'mobile', label: 'Mobile' },
      { key: 'licenseNo', label: 'License No' },
      { key: 'licenseExpiry', label: 'License expiry', type: 'date' },
    ],
  },
  transporters: {
    path: 'transporters',
    title: 'Transporters',
    columns: ['transporterCode', 'transporterName', 'transin', 'gstin', 'state', 'status'],
    fields: [
      { key: 'transporterCode', label: 'Code', required: true },
      { key: 'transporterName', label: 'Name', required: true },
      { key: 'transin', label: 'GST Transporter ID (TRANSIN)' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'state', label: 'State' },
    ],
  },
  'concrete-grades': {
    path: 'concrete-grades',
    title: 'Concrete Grades',
    columns: ['gradeCode', 'gradeName', 'strengthClass', 'status'],
    fields: [
      { key: 'gradeCode', label: 'Code', required: true },
      { key: 'gradeName', label: 'Name', required: true },
      { key: 'strengthClass', label: 'Strength class' },
    ],
  },
  plants: {
    path: 'plants',
    title: 'Plants',
    columns: ['plantCode', 'plantName', 'city', 'status'],
    fields: [
      { key: 'plantCode', label: 'Code', required: true },
      { key: 'plantName', label: 'Name', required: true },
      { key: 'city', label: 'City' },
    ],
  },
  'number-series': {
    path: 'number-series',
    title: 'Number Series',
    columns: ['documentType', 'prefix', 'currentNumber', 'financialYear', 'isActive'],
    fields: [
      { key: 'documentType', label: 'Document type', required: true, options: DOCUMENT_TYPE_OPTIONS },
      { key: 'plantId', label: 'Plant', ref: { path: 'plants', value: 'id', label: 'plantName' } },
      { key: 'prefix', label: 'Prefix' },
      { key: 'suffix', label: 'Suffix' },
      { key: 'paddingLength', label: 'Padding', type: 'number' },
      { key: 'currentNumber', label: 'Current number', type: 'number' },
      { key: 'financialYear', label: 'Financial year' },
      {
        key: 'resetFrequency',
        label: 'Reset',
        options: [
          { value: 'yearly', label: 'Yearly (restart each financial year)' },
          { value: 'never', label: 'Never (continuous)' },
        ],
      },
      { key: 'isActive', label: 'Active', type: 'boolean', default: true },
    ],
  },
};
