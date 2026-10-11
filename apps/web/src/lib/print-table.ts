/**
 * "Export → PDF" for any list: open a clean print page in a new window with
 * the same columns and rows, and ask the browser to print it. Every browser's
 * print dialog offers "Save as PDF", which is the file; nothing is rendered
 * server-side and no PDF library is shipped to the browser.
 *
 * The page carries the company name, the list title, the date printed and
 * the row count; wide lists (more than six columns) print landscape.
 */

export interface PrintColumn {
  key: string;
  label: string;
}

export interface PrintTableOptions {
  title: string;
  columns: PrintColumn[];
  rows: Array<Record<string, unknown>>;
  companyName?: string | null;
  /** Shown under the title — the period, the filter, whatever bounds the list. */
  subtitle?: string | null;
}

function esc(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const NUMERIC = /^-?\d{1,15}(\.\d+)?$/;
const isNumeric = (v: unknown): boolean => typeof v === 'number' || (typeof v === 'string' && NUMERIC.test(v.trim()));

/** The HTML of the print page — exported so a script can check it without a window. */
export function printTableHtml(o: PrintTableOptions, printedAt: Date = new Date()): string {
  const landscape = o.columns.length > 6;
  const when = printedAt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // A column is right-aligned when every non-blank value in it is a number.
  const numericCol = o.columns.map((c) => {
    const vals = o.rows.map((r) => r[c.key]).filter((v) => v !== null && v !== undefined && v !== '');
    return vals.length > 0 && vals.every(isNumeric);
  });
  const head = o.columns.map((c, i) => `<th${numericCol[i] ? ' class="n"' : ''}>${esc(c.label)}</th>`).join('');
  const body = o.rows
    .map((r) => `<tr>${o.columns.map((c, i) => `<td${numericCol[i] ? ' class="n"' : ''}>${esc(r[c.key])}</td>`).join('')}</tr>`)
    .join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title>` +
    `<style>` +
    `@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:12mm}` +
    `*{box-sizing:border-box}` +
    `body{font:11px/1.4 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:16px}` +
    `header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}` +
    `h1{font-size:18px;margin:0 0 2px}.co{font-size:13px;font-weight:600;margin:0}.meta{font-size:10px;color:#555;text-align:right;white-space:nowrap}.sub{color:#555;margin:0}` +
    `table{width:100%;border-collapse:collapse;page-break-inside:auto}` +
    `thead{display:table-header-group}tr{page-break-inside:avoid}` +
    `th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}` +
    `th{background:#eef1f6;font-weight:700;border-bottom:1px solid #999}` +
    `.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}` +
    `footer{margin-top:10px;font-size:10px;color:#777}` +
    `@media screen{body{max-width:1100px;margin:0 auto}}` +
    `</style></head><body>` +
    `<header><div>${o.companyName ? `<p class="co">${esc(o.companyName)}</p>` : ''}<h1>${esc(o.title)}</h1>${o.subtitle ? `<p class="sub">${esc(o.subtitle)}</p>` : ''}</div>` +
    `<div class="meta">Printed ${esc(when)}<br>${o.rows.length} ${o.rows.length === 1 ? 'row' : 'rows'}</div></header>` +
    `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${o.columns.length}">No rows.</td></tr>`}</tbody></table>` +
    `<footer>Use the browser's print dialog and choose Save as PDF.</footer>` +
    `</body></html>`
  );
}

/** Open the print page and bring up the browser's print dialog. */
export function printTable(o: PrintTableOptions): void {
  const w = window.open('', '_blank');
  if (!w) throw new Error('The print window was blocked. Allow pop-ups for this site and try again.');
  w.document.open();
  w.document.write(printTableHtml(o));
  w.document.close();
  // Let the new document lay out before the dialog opens.
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 250);
}
