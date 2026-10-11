/**
 * Minimal, dependency-free .xlsx writer for the export menu.
 *
 * An .xlsx file is a ZIP of XML parts. This writes a store-only ZIP (no
 * compression, so no inflate code is needed) with correct CRC-32s and
 * local / central headers, holding the five parts Excel needs to open a
 * one-sheet workbook: the content types, the package relationships, the
 * workbook, its relationships, the sheet itself, plus a minimal styles part
 * so the header row is bold. Strings are inline (no shared-string table),
 * numbers are written as numbers so Excel sums them, booleans as booleans.
 *
 * Runs in the browser (Blob download) and in Node (returns a Uint8Array), so
 * a script can write a file and prove it unzips.
 */

export interface XlsxColumn {
  key: string;
  label: string;
}

export interface XlsxSheet {
  /** Sheet tab name — trimmed to Excel's 31 characters and its forbidden characters removed. */
  name?: string;
  columns: XlsxColumn[];
  rows: Array<Record<string, unknown>>;
}

// ---- ZIP (store only) -------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard CRC-32 (IEEE 802.3), as the ZIP format requires. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const utf8 = (s: string): Uint8Array => encoder.encode(s);

/** MS-DOS time and date fields for the ZIP headers (local time, 2-second resolution). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

class ByteSink {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  u16(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** Pack named text parts into a store-only ZIP. */
export function zipStore(files: Array<{ name: string; data: string | Uint8Array }>, now: Date = new Date()): Uint8Array {
  const out = new ByteSink();
  const central = new ByteSink();
  const { time, date } = dosDateTime(now);
  let entries = 0;
  for (const f of files) {
    const name = utf8(f.name);
    const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
    const crc = crc32(data);
    const offset = out.length;
    // Local file header.
    out.u32(0x04034b50);
    out.u16(20); // version needed: 2.0
    out.u16(0x0800); // flags: names are UTF-8
    out.u16(0); // method: store
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(data.length);
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0); // extra
    out.push(name);
    out.push(data);
    // Central directory header.
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0x0800);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(name.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(offset);
    central.push(name);
    entries++;
  }
  const cdOffset = out.length;
  const cd = central.bytes();
  out.push(cd);
  // End of central directory.
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(entries);
  out.u16(entries);
  out.u32(cd.length);
  out.u32(cdOffset);
  out.u16(0);
  return out.bytes();
}

// ---- Workbook XML -------------------------------------------------------------

/** Escape for XML text and attributes; characters XML 1.0 cannot carry are dropped. */
function xml(s: string): string {
  let clean = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const control = c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d;
    if (control || c === 0xfffe || c === 0xffff) continue;
    clean += ch;
  }
  return clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * A value Excel should hold as a number: a finite number, or a plain decimal
 * string as the API sends numeric columns ("4800.00"). Codes with leading
 * zeros, phone numbers and anything over 15 digits stay text — Excel would
 * mangle them.
 */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!/^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cell(ref: string, v: unknown, style?: number): string {
  const s = style ? ` s="${style}"` : '';
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${s}><v>${v ? 1 : 0}</v></c>`;
  const n = asNumber(v);
  if (n !== null) return `<c r="${ref}"${s}><v>${n}</v></c>`;
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const rows: string[] = [];
  const header = sheet.columns.map((c, i) => cell(`${columnLetter(i)}1`, c.label, 1)).join('');
  rows.push(`<row r="1">${header}</row>`);
  sheet.rows.forEach((r, ri) => {
    const n = ri + 2;
    const cells = sheet.columns.map((c, ci) => cell(`${columnLetter(ci)}${n}`, r[c.key])).join('');
    rows.push(`<row r="${n}">${cells}</row>`);
  });
  const last = `${columnLetter(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}`;
  // Column widths from the longest value, within reason, so the sheet opens readable.
  const cols = sheet.columns
    .map((c, i) => {
      const longest = sheet.rows.reduce((m, r) => Math.max(m, String(r[c.key] ?? '').length), c.label.length);
      return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(48, Math.max(8, longest + 2))}" customWidth="1"/>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function sheetName(name: string | undefined): string {
  const cleaned = (name ?? 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || 'Sheet1';
}

/** Build the workbook bytes for one sheet. */
export function buildXlsx(sheet: XlsxSheet, now: Date = new Date()): Uint8Array {
  const name = xml(sheetName(sheet.name));
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(sheet) },
    { name: 'xl/styles.xml', data: STYLES_XML },
  ];
  return zipStore(files, now);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build the workbook and hand it to the browser as a download. */
export function downloadXlsx(filename: string, sheet: XlsxSheet): void {
  const bytes = buildXlsx(sheet);
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
