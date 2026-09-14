/**
 * The delivery challan prints its times on the plant's clock, and prints the
 * two that matter on site: when the load was batched, and when it must be
 * placed by.
 *
 * The defect these pin: the challan formatted its dispatch time with
 * toISOString() — UTC — so a load dispatched at 02:00 IST was printed as the
 * previous evening on the document the site engineer signs. The e-way "valid
 * till" was formatted the same way. And the ticket carried no batching time
 * and no use-by at all, though ready-mix has a working life from batching
 * (IS 4926) and the batch ticket is one lookup from the challan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { plantDateTime, addMinutes } from '../../dist/common/business-date.util.js';
import { PdfService } from '../../dist/sales/pdf.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * pdfkit deflates its content streams and writes text as hex glyph strings in
 * `[<..> kern <..>] TJ` arrays; inflate, then decode the hex and drop the
 * kerning numbers so a line reads back as the string it was drawn from.
 */
function pdfText(buf) {
  const src = buf.toString('latin1');
  const lines = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(src))) {
    let content;
    try { content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { content = m[1]; }
    for (const [, arr] of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...arr.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('');
      lines.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
  }
  return lines.join('\n');
}

const withZone = (tz, fn) => {
  const prev = process.env.PLANT_TIMEZONE;
  process.env.PLANT_TIMEZONE = tz;
  try { return fn(); } finally { if (prev === undefined) delete process.env.PLANT_TIMEZONE; else process.env.PLANT_TIMEZONE = prev; }
};

test('a moment is printed as the plant sees it, not as UTC', () => {
  // 20:30 UTC on the 13th is 02:00 IST on the 14th.
  const at = new Date('2026-09-13T20:30:00Z');
  assert.equal(withZone('Asia/Kolkata', () => plantDateTime(at)), '14/09/2026 02:00');
  assert.equal(withZone('Pacific/Midway', () => plantDateTime(at)), '13/09/2026 09:30', 'follows PLANT_TIMEZONE');
  assert.equal(plantDateTime(null), null);
  assert.equal(plantDateTime(''), null);
  assert.equal(plantDateTime('not a date'), null);
});

test('use-by is batched plus the working life', () => {
  const batched = new Date('2026-09-14T04:35:00Z'); // 10:05 IST
  const useBy = addMinutes(batched, 120);
  assert.equal(withZone('Asia/Kolkata', () => plantDateTime(useBy)), '14/09/2026 12:05');
  assert.equal(addMinutes(null, 120), null);
});

test('the challan prints Batched, Dispatched and a Use by line, and the e-way validity', async () => {
  const svc = new PdfService();
  const base = { companyName: 'Mix Nova RMC', challanNo: 'DC-001', challanStatus: 'issued', customerName: 'BuildCo', vehicleNo: 'TN01AB1234', driverName: 'R. Kumar', gradeLabel: 'M25', quantityM3: 8 };
  const buf = await svc.challanPdf({ ...base, batchedAt: '14/09/2026 10:05', dispatchTime: '14/09/2026 10:20', useBy: '14/09/2026 12:05', ewayBillNo: '231234567890', ewayValidUntil: '15/09/2026 23:59' });
  const text = pdfText(buf);
  for (const s of ['Batched: 14/09/2026 10:05', 'Dispatched: 14/09/2026 10:20', 'Use by: 14/09/2026 12:05', 'valid till 15/09/2026 23:59']) {
    assert.ok(text.includes(s), `challan must print "${s}"`);
  }
  const bare = pdfText(await svc.challanPdf(base));
  assert.ok(!bare.includes('Use by'), 'no use-by when the challan has no batch ticket behind it');
});

test('the challan service formats no time as UTC and takes the working life from one place', () => {
  const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/dispatch/delivery-challan.service.ts'), 'utf8'));
  assert.doesNotMatch(src, /toISOString\(\)\.(slice|replace)\(/, 'toISOString() is UTC — use plantDateTime()');
  assert.match(src, /plantDateTime\(challan\.dispatchTime\)/, 'dispatch time on the plant clock');
  assert.match(src, /plantDateTime\(eway\?\.ewayValidUntil\)/, 'e-way validity on the plant clock');
  assert.match(src, /addMinutes\(batchedAt, CONCRETE_SLA_MINUTES\)/, 'use-by from the shared working-life constant, not a literal');
  assert.doesNotMatch(src, /addMinutes\([^,]+,\s*\d+\)/, 'no second copy of the working life as a number');
});
