import { MATERIAL_TYPES, UOM_CATEGORIES } from '@rmc/shared';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date';
  required?: boolean;
  /** When set, the field renders as a dropdown of these options. */
  options?: { value: string; label: string }[];
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
      { key: 'gstin', label: 'GSTIN' },
      { key: 'state', label: 'State' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'creditLimit', label: 'Credit limit', type: 'number' },
      { key: 'creditDays', label: 'Credit days', type: 'number' },
    ],
  },
  sites: {
    path: 'sites',
    title: 'Sites / Projects',
    columns: ['siteCode', 'siteName', 'city', 'state', 'status'],
    fields: [
      { key: 'siteCode', label: 'Code', required: true },
      { key: 'siteName', label: 'Name', required: true },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
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
      { key: 'uom', label: 'UOM' },
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
      { key: 'state', label: 'State' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'paymentTerms', label: 'Payment terms' },
    ],
  },
  vehicles: {
    path: 'vehicles',
    title: 'Vehicles',
    columns: ['vehicleNo', 'vehicleType', 'capacityM3', 'insuranceExpiry', 'fitnessExpiry', 'status'],
    fields: [
      { key: 'vehicleNo', label: 'Vehicle No', required: true },
      { key: 'vehicleType', label: 'Type' },
      { key: 'capacityM3', label: 'Capacity (m³)', type: 'number' },
      { key: 'ownershipType', label: 'Ownership' },
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
      { key: 'documentType', label: 'Document type', required: true },
      { key: 'prefix', label: 'Prefix' },
      { key: 'paddingLength', label: 'Padding', type: 'number' },
      { key: 'financialYear', label: 'Financial year' },
    ],
  },
};
