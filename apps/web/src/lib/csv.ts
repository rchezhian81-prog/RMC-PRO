/**
 * Minimal, dependency-free CSV for import/export. Generates Excel-friendly
 * output (UTF-8 BOM + CRLF) and parses quoted/escaped fields correctly.
 */

/** Serialize rows to CSV using the given column keys as the header. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(esc).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\r\n');
  return rows.length ? `${header}\r\n${body}` : header;
}

/** Trigger a browser download of CSV text (BOM prepended so Excel reads UTF-8). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Parse CSV text into objects keyed by the header row. Blank lines are skipped. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = tokenize(text);
  if (!rows.length) return [];
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (r[i] ?? '').trim();
      });
      return obj;
    });
}

/** Split CSV into rows of fields, honouring quotes and "" escapes. */
function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  const s = text.replace(/\r\n?/g, '\n');
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
