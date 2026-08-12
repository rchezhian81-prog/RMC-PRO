/**
 * Bulk import framework — pure helpers (Plan F1). No NestJS/DB imports so each is
 * unit-testable in isolation (the .mjs tests import the compiled dist).
 *
 *   - `IMPORT_DEFS`     — the importable masters and their columns (the single
 *     source of truth for both the download template and the upload mapping).
 *   - `parseCsv`        — a dependency-free CSV parser (quoted fields, embedded
 *     commas/newlines, escaped quotes, CRLF, skips blank lines).
 *   - `rowsToObjects`   — pair parsed rows with the header row.
 *   - `buildTemplateCsv`— emit the download template (header + one example row).
 */

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  /** 'number' fields are coerced to Number() on import; everything else stays text. */
  type?: 'number';
  example?: string;
}

export interface ImportDef {
  key: string;
  label: string;
  columns: ImportColumn[];
}

/**
 * The importable masters. Column `key`s ARE the entity field names, so a parsed
 * row maps straight onto the master's create DTO. Required columns mirror each
 * master service's required list; the rest are optional.
 */
export const IMPORT_DEFS: ImportDef[] = [
  {
    key: 'customers',
    label: 'Customers',
    columns: [
      { key: 'customerCode', label: 'Customer Code', required: true, example: 'CUST-100' },
      { key: 'customerName', label: 'Customer Name', required: true, example: 'Acme Constructions' },
      { key: 'gstin', label: 'GSTIN', example: '33ABCDE1234F1Z5' },
      { key: 'customerType', label: 'Customer Type', example: 'credit' },
      { key: 'city', label: 'City', example: 'Chennai' },
      { key: 'state', label: 'State', example: 'Tamil Nadu' },
      { key: 'pincode', label: 'PIN Code', example: '600001' },
      { key: 'mobile', label: 'Mobile', example: '9876543210' },
      { key: 'email', label: 'Email', example: 'accounts@acme.example' },
      { key: 'creditLimit', label: 'Credit Limit', type: 'number', example: '500000' },
      { key: 'creditDays', label: 'Credit Days', type: 'number', example: '30' },
    ],
  },
  {
    key: 'materials',
    label: 'Materials',
    columns: [
      { key: 'materialCode', label: 'Material Code', required: true, example: 'CEM-OPC53' },
      { key: 'materialName', label: 'Material Name', required: true, example: 'OPC 53 Grade Cement' },
      { key: 'category', label: 'Category', example: 'cement' },
      { key: 'uom', label: 'Unit (UOM)', example: 'MT' },
      { key: 'hsnCode', label: 'HSN Code', example: '2523' },
      { key: 'materialType', label: 'Material Type', example: 'cement' },
      { key: 'minimumStock', label: 'Minimum Stock', type: 'number', example: '10' },
      { key: 'reorderLevel', label: 'Reorder Level', type: 'number', example: '20' },
      { key: 'standardRate', label: 'Standard Rate', type: 'number', example: '5200' },
    ],
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    columns: [
      { key: 'supplierCode', label: 'Supplier Code', required: true, example: 'SUP-100' },
      { key: 'supplierName', label: 'Supplier Name', required: true, example: 'Ultra Cement Dealers' },
      { key: 'gstin', label: 'GSTIN', example: '33ABCDE1234F1Z5' },
      { key: 'contactPerson', label: 'Contact Person', example: 'R. Kumar' },
      { key: 'mobile', label: 'Mobile', example: '9876543210' },
      { key: 'email', label: 'Email', example: 'sales@ultra.example' },
      { key: 'state', label: 'State', example: 'Tamil Nadu' },
      { key: 'paymentTerms', label: 'Payment Terms', example: '30 days' },
    ],
  },
];

/** Look up an import definition by its entity-type key. */
export function getImportDef(key: string): ImportDef | undefined {
  return IMPORT_DEFS.find((d) => d.key === key);
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Parse CSV text into a header row and data rows. Handles quoted fields with
 * embedded commas, newlines and escaped quotes (`""`), tolerates CRLF or LF, and
 * skips wholly-blank lines. A field is unquoted-trimmed; quoted content is taken
 * verbatim (minus the surrounding quotes).
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;
  const src = String(text ?? '');

  const pushField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    // Skip a record that is entirely empty (e.g. a trailing newline).
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; fieldWasQuoted = true; continue; }
    if (c === ',') { pushField(); continue; }
    if (c === '\r') continue; // handled by the following \n (or ignored)
    if (c === '\n') { pushRecord(); continue; }
    field += c;
  }
  // Flush the final field/record if the text didn't end in a newline.
  if (field !== '' || record.length) pushRecord();

  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0] ?? [];
  const rows = records.slice(1);
  return { headers, rows };
}

/** Pair each parsed row with the header row into a {header: value} object. */
export function rowsToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

/**
 * Build the download template for an import definition: a header row of the
 * column keys plus one example row, CSV-escaped.
 */
export function buildTemplateCsv(def: ImportDef): string {
  const esc = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = def.columns.map((c) => c.key).join(',');
  const example = def.columns.map((c) => esc(c.example ?? '')).join(',');
  return `${header}\n${example}\n`;
}
