import { GST_STATE_NAMES, MATERIAL_TYPES, UOM_CATEGORIES } from '@rmc/shared';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'boolean';
  required?: boolean;
  /** One plain sentence under the input: what the value is used for. */
  help?: string;
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

// The state decides CGST + SGST vs IGST on every quotation, order, invoice and
// vendor bill, so it is chosen rather than typed. Free text let the same state
// be written four ways, and only some of them resolved.
const STATE_OPTIONS = GST_STATE_NAMES.map((name) => ({ value: name, label: name }));

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
  'purchase_payment', 'expense_voucher', 'maintenance_job', 'qc_cube_set', 'lead', 'pump_job',
] as const;
const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map((d) => ({ value: d, label: titleCase(d.replace(/_/g, ' ')) }));

export interface EntityConfig {
  path: string; // API path AND URL slug
  title: string;
  /** One record, for buttons and empty states ("New material"). */
  singular?: string;
  /** One plain sentence under the title: what this master is for. */
  description?: string;
  /** The column that names a record on its row (default: the second column,
   * the first being the code). Vehicles lead with the registration number. */
  nameKey?: string;
  columns: string[];
  fields: FieldDef[];
}

export const ENTITY_CONFIG: Record<string, EntityConfig> = {
  customers: {
    path: 'customers',
    title: 'Customers',
    singular: 'customer',
    description: 'Who you sell to.',
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
      { key: 'state', label: 'State', required: true, options: STATE_OPTIONS },
      { key: 'pincode', label: 'PIN code' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'creditLimit', label: 'Credit limit', type: 'number', help: 'Orders stop on credit hold once the exposure passes this. Leave blank for no limit.' },
      { key: 'creditDays', label: 'Credit days', type: 'number', help: 'Days after the invoice date before it is overdue.' },
      // Pre-existing receivable at go-live — the first term of the customer's
      // credit exposure, so it must be capturable.
      { key: 'openingBalance', label: 'Opening balance (₹)', type: 'number', help: 'What they already owed when you started using Mix Nova.' },
    ],
  },
  sites: {
    path: 'sites',
    title: 'Sites / Projects',
    singular: 'site',
    description: 'Where the concrete goes: each customer\'s project sites, with the contact on site and whether a pump is needed. An order is booked against a site.',
    columns: ['siteCode', 'siteName', 'city', 'state', 'status'],
    fields: [
      { key: 'siteCode', label: 'Code', required: true },
      { key: 'siteName', label: 'Name', required: true },
      { key: 'customerId', label: 'Customer', ref: { path: 'customers', value: 'id', label: 'customerName' } },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State', options: STATE_OPTIONS },
      { key: 'pincode', label: 'PIN code' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'pumpRequired', label: 'Pump required', type: 'boolean', default: false, help: 'Orders for this site default to pumped delivery.' },
    ],
  },
  materials: {
    path: 'materials',
    title: 'Materials',
    singular: 'material',
    description: 'What goes into the mix: cement, aggregates, water, admixtures. The unit, the standard rate and the reorder level drive stock, valuation and the low-stock warnings.',
    columns: ['materialCode', 'materialName', 'materialType', 'uom', 'standardRate', 'reorderLevel', 'hsnCode', 'status'],
    fields: [
      { key: 'materialCode', label: 'Code', required: true },
      { key: 'materialName', label: 'Name', required: true },
      { key: 'materialType', label: 'Type', options: MATERIAL_TYPE_OPTIONS },
      { key: 'category', label: 'Category' },
      { key: 'uom', label: 'UOM', ref: { path: 'uoms', value: 'uomCode', label: 'uomName' } },
      { key: 'hsnCode', label: 'HSN' },
      { key: 'reorderLevel', label: 'Reorder level', type: 'number', help: 'Stock at or below this shows as low stock and on the inventory reports.' },
      { key: 'standardRate', label: 'Standard rate', type: 'number', help: 'Per unit; values the stock and the material consumed in a batch.' },
      { key: 'specificGravity', label: 'Specific gravity', type: 'number' },
      { key: 'bulkDensity', label: 'Bulk density (kg/m³)', type: 'number' },
      { key: 'waterAbsorptionPct', label: 'Water absorption %', type: 'number' },
      { key: 'defaultMoisturePct', label: 'Default moisture %', type: 'number' },
    ],
  },
  uoms: {
    path: 'uoms',
    title: 'Units (UOM)',
    singular: 'unit',
    description: 'The units the yard counts in (ton, bag, litre, m³). Every material is booked in one of these.',
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
    singular: 'conversion',
    description: 'How one unit turns into another (1 ton = 1,000 kg), so a delivery weighed in tons can be booked against a material kept in bags or kg.',
    columns: ['fromUom', 'toUom', 'factor'],
    fields: [
      { key: 'fromUom', label: 'From UOM', required: true },
      { key: 'toUom', label: 'To UOM', required: true },
      { key: 'factor', label: 'Factor (1 from = ? to)', type: 'number', required: true, help: 'For ton to kg the factor is 1000.' },
    ],
  },
  suppliers: {
    path: 'suppliers',
    title: 'Suppliers',
    singular: 'supplier',
    description: 'Who you buy from: GSTIN and state for the purchase bills, a contact, and the payment terms agreed.',
    columns: ['supplierCode', 'supplierName', 'gstin', 'state', 'status'],
    fields: [
      { key: 'supplierCode', label: 'Code', required: true },
      { key: 'supplierName', label: 'Name', required: true },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'pan', label: 'PAN' },
      { key: 'state', label: 'State', options: STATE_OPTIONS },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'paymentTerms', label: 'Payment terms', help: 'As agreed, e.g. 30 days or advance.' },
    ],
  },
  vehicles: {
    path: 'vehicles',
    title: 'Vehicles',
    singular: 'vehicle',
    nameKey: 'vehicleNo',
    description: 'The fleet: transit mixers, pumps and tippers, with the papers that expire. A vehicle with lapsed insurance or fitness is flagged here before it is sent out.',
    columns: ['vehicleNo', 'vehicleType', 'capacityM3', 'insuranceExpiry', 'fitnessExpiry', 'status'],
    fields: [
      { key: 'vehicleNo', label: 'Vehicle No', required: true },
      { key: 'vehicleType', label: 'Type', options: VEHICLE_TYPE_OPTIONS },
      { key: 'driverId', label: 'Assigned driver', ref: { path: 'drivers', value: 'id', label: 'driverName' } },
      { key: 'capacityM3', label: 'Capacity (m³)', type: 'number', help: 'Drum capacity; a dispatch cannot load more than this.' },
      { key: 'ownershipType', label: 'Ownership', options: OWNERSHIP_OPTIONS },
      { key: 'insuranceExpiry', label: 'Insurance expiry', type: 'date' },
      { key: 'fitnessExpiry', label: 'Fitness (FC) expiry', type: 'date' },
      { key: 'permitExpiry', label: 'Permit expiry', type: 'date' },
      { key: 'pollutionExpiry', label: 'Pollution (PUC) expiry', type: 'date' },
      { key: 'roadTaxExpiry', label: 'Road tax expiry', type: 'date' },
      { key: 'gpsDeviceId', label: 'GPS device ID (IMEI)' },
    ],
  },
  drivers: {
    path: 'drivers',
    title: 'Drivers',
    singular: 'driver',
    description: 'Who drives: name, mobile and licence, with the licence expiry flagged before it lapses.',
    columns: ['driverCode', 'driverName', 'mobile', 'licenseNo', 'licenseExpiry', 'status'],
    fields: [
      { key: 'driverCode', label: 'Code', required: true },
      { key: 'driverName', label: 'Name', required: true },
      { key: 'mobile', label: 'Mobile' },
      { key: 'licenseNo', label: 'License No' },
      { key: 'licenseExpiry', label: 'License expiry', type: 'date' },
      // The login this driver uses on the phone (My Trips). Options come from
      // Setup → Users; a user without users.manage sees the list empty.
      { key: 'userId', label: 'Login account (for My Trips)', ref: { path: 'users', value: 'id', label: 'email' } },
    ],
  },
  transporters: {
    path: 'transporters',
    title: 'Transporters',
    singular: 'transporter',
    description: 'Hired transport companies and their GST transporter ID, needed on an e-way bill when their vehicle carries the load.',
    columns: ['transporterCode', 'transporterName', 'transin', 'gstin', 'state', 'status'],
    fields: [
      { key: 'transporterCode', label: 'Code', required: true },
      { key: 'transporterName', label: 'Name', required: true },
      { key: 'transin', label: 'GST Transporter ID (TRANSIN)', help: 'Goes on the e-way bill when this transporter carries the load.' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'state', label: 'State', options: STATE_OPTIONS },
    ],
  },
  'concrete-grades': {
    path: 'concrete-grades',
    title: 'Concrete Grades',
    singular: 'grade',
    description: 'The grades you sell (M10 to M60). A mix design gives each grade its recipe; orders and batches are booked by grade.',
    columns: ['gradeCode', 'gradeName', 'strengthClass', 'status'],
    fields: [
      { key: 'gradeCode', label: 'Code', required: true },
      { key: 'gradeName', label: 'Name', required: true },
      { key: 'strengthClass', label: 'Strength class', help: 'The characteristic strength, e.g. 25 MPa for M25.' },
    ],
  },
  plants: {
    path: 'plants',
    title: 'Plants',
    singular: 'plant',
    description: 'Each batching plant you run. Stock, production and number series can be kept per plant.',
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
    singular: 'series',
    description: 'How each document is numbered: the prefix, the padding and the next number, restarting each financial year or running on. One series per document type, or one per plant.',
    columns: ['documentType', 'prefix', 'currentNumber', 'financialYear', 'isActive'],
    fields: [
      { key: 'documentType', label: 'Document type', required: true, options: DOCUMENT_TYPE_OPTIONS },
      { key: 'plantId', label: 'Plant', ref: { path: 'plants', value: 'id', label: 'plantName' } },
      { key: 'prefix', label: 'Prefix', help: 'Text before the number, e.g. INV- gives INV-0001.' },
      { key: 'suffix', label: 'Suffix' },
      { key: 'paddingLength', label: 'Padding', type: 'number', help: 'How many digits, filled with zeros: 4 gives 0001.' },
      { key: 'currentNumber', label: 'Current number', type: 'number', help: 'The last number used; the next document takes the one after it.' },
      { key: 'financialYear', label: 'Financial year', help: 'In the form 2026-27.' },
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
