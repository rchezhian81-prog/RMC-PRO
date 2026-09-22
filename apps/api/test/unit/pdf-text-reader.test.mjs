/**
 * The test-side PDF reader must read every stream whatever its bytes are.
 * Three CI runs lost a phrase from a receipt or statement PDF while the
 * document was fine: the reader trimmed a trailing carriage return that was
 * really the last byte of the compressed data, the stream would not inflate,
 * and its text was silently dropped. Streams are now sliced by /Length.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pdfText, pdfTextReport } from '../helpers/pdf-text.mjs';
import { PdfService } from '../../dist/sales/pdf.service.js';

const hex = (t) => Buffer.from(t, 'latin1').toString('hex');
const content = (text) => `BT /F1 12 Tf [<${hex(text)}>] TJ ET`;
const wrap = (data) => Buffer.concat([
  Buffer.from(`%PDF-1.3\n1 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
  data,
  Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
]);

/** Deflate text plus a counter until the compressed bytes end in the given byte. */
function deflatedEndingIn(byte, text) {
  for (let i = 0; i < 200000; i++) {
    const d = deflateSync(Buffer.from(content(`${text} ${i}`)));
    if (d[d.length - 1] === byte) return { data: d, i };
  }
  throw new Error('no candidate found');
}

test('a compressed stream whose last byte is a carriage return is read whole', () => {
  const { data, i } = deflatedEndingIn(0x0d, 'STATEMENT OF ACCOUNT');
  const text = pdfText(wrap(data));
  assert.ok(text.includes(`STATEMENT OF ACCOUNT ${i}`), `text found; report: ${pdfTextReport(wrap(data))}`);
});

test('and one whose last byte is a line feed, and one ending in both', () => {
  for (const byte of [0x0a, 0x0d]) {
    const { data, i } = deflatedEndingIn(byte, 'INSTRUMENT RETURNED');
    assert.ok(pdfText(wrap(data)).includes(`INSTRUMENT RETURNED ${i}`), `byte 0x${byte.toString(16)}`);
  }
});

test('an uncompressed stream and binary that contains "<<" do not confuse the reader', () => {
  const plain = Buffer.from(content('RECEIPT plain'), 'latin1');
  const pdf = Buffer.concat([
    Buffer.from(`%PDF-1.3\n1 0 obj\n<< /Length ${plain.length} >>\nstream\n`, 'latin1'), plain, Buffer.from('\nendstream\nendobj\n', 'latin1'),
    Buffer.from('2 0 obj\n<< /Length 6 /Filter /FlateDecode >>\nstream\n<<junk\nendstream\nendobj\n', 'latin1'),
    wrap(deflateSync(Buffer.from(content('SECOND stream')))).subarray(9),
  ]);
  const text = pdfText(pdf);
  assert.ok(text.includes('RECEIPT plain'), 'uncompressed text read');
  assert.ok(text.includes('SECOND stream'), 'the stream after the binary one is still found');
});

test('a real pdfkit document reads the same as before', async () => {
  const buf = await new PdfService().receiptPdf({ companyName: 'Mix Nova RMC', receiptNo: 'RC-9', status: 'posted', customerName: 'BuildCo', amount: 100, allocations: [], unallocatedAmount: 100 });
  const text = pdfText(buf);
  for (const s of ['RECEIPT', 'No: RC-9', 'BuildCo', 'Authorised Signatory']) assert.ok(text.includes(s), `prints "${s}"`);
});
