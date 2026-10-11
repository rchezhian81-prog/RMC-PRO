/**
 * Column headings for an export, from the row keys the screens pass.
 *
 * The lists hand ExportButton their row keys (`customerName`, `totalIn`); a
 * printed heading or a spreadsheet header should read "Customer name" and
 * "Total in". A screen can pass its own `labels` map for the keys whose
 * plain reading is wrong; everything else is derived here, with the trade's
 * acronyms kept upper-case.
 */

const ACRONYMS = new Set(['gst', 'gstin', 'hsn', 'sac', 'uom', 'po', 'grn', 'irn', 'id', 'pan', 'ifsc', 'utr', 'cgst', 'sgst', 'igst', 'tds', 'qc', 'm3', 'kg', 'km']);

export function columnLabel(key: string, labels?: Record<string, string>): string {
  const given = labels?.[key];
  if (given) return given;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .map((w) => (ACRONYMS.has(w) ? (w === 'm3' ? 'm³' : w.toUpperCase()) : w));
  if (!words.length) return key;
  const first = words[0]!;
  words[0] = ACRONYMS.has(first.toLowerCase()) || first === 'm³' ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

export function columnsWithLabels(columns: string[], labels?: Record<string, string>): Array<{ key: string; label: string }> {
  return columns.map((key) => ({ key, label: columnLabel(key, labels) }));
}
