/**
 * The page a printed document opens in.
 *
 * A PDF fetched with an Authorization header can only be shown from an
 * in-browser blob, and a tab navigated straight to a blob is titled with the
 * blob's random id and saves under it — "3d798575-7587-…pdf" for a receipt.
 * So the tab gets a small page of its own instead: titled with the document
 * number, a Print button that prints the PDF (not the page), a Save button
 * that saves it under its real name, and the PDF filling the rest.
 *
 * Pure functions, shared so the web uses them and the tests can read them.
 */

/** The file name the API attached (Content-Disposition), else a fallback, always ending in .pdf. */
export function documentFilename(contentDisposition: string | null | undefined, fallback?: string | null): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(contentDisposition ?? ''));
  const raw = (m?.[1] ?? fallback ?? 'document').trim();
  const safe = decodeURIComponent(raw).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'document';
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The viewer page: title = the document's name; Print / Save / the PDF. */
export function documentViewerHtml(opts: { url: string; filename: string }): string {
  const name = escapeHtml(opts.filename.replace(/\.pdf$/i, ''));
  const file = escapeHtml(opts.filename);
  const url = escapeHtml(opts.url);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
  html,body{height:100%;margin:0;background:#3a3a3a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1f1f1f;color:#eee;font-size:14px}
  .bar b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar a,.bar button{appearance:none;border:1px solid #666;background:#2c2c2c;color:#fff;padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer;text-decoration:none}
  .bar a:hover,.bar button:hover{background:#3d3d3d}
  iframe{display:block;width:100%;height:calc(100% - 44px);border:0;background:#fff}
</style></head><body>
<div class="bar"><b>${name}</b><button type="button" id="print">Print</button><a id="save" href="${url}" download="${file}">Save as ${file}</a></div>
<iframe id="pdf" src="${url}" title="${name}"></iframe>
<script>
  document.getElementById('print').addEventListener('click', function () {
    var f = document.getElementById('pdf');
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.print(); }
  });
</script>
</body></html>`;
}
