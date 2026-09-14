/**
 * The printed receipt — the customer's evidence that they paid.
 *
 * Until now a receipt could be recorded, shared as a one-line WhatsApp
 * message, and reversed, but never printed: the customer who paid by cheque
 * left with nothing in hand. These pin what the document says, and in
 * particular what it must say when the money is not (or no longer) received:
 * a pending cheque is subject to realisation, and a bounced or reversed
 * receipt announces in red that it discharges nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfService } from '../../dist/sales/pdf.service.js';
import { pdfText } from '../helpers/pdf-text.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const svc = new PdfService();
const base = {
  companyName: 'Mix Nova RMC', companyGstin: '33AABCA1234B1ZO',
  receiptNo: 'RC-0007', receiptDate: '2026-09-14', status: 'posted', clearingStatus: null,
  customerName: 'BuildCo Constructions', customerGstin: '33AAACB1234C1Z5', customerAddress: '12 Anna Salai, Chennai, Tamil Nadu, 600002',
  amount: '12345.50', paymentMode: 'neft', bankReference: 'UTR-77',
  allocations: [{ invoiceNo: 'INV-0001', invoiceDate: '2026-09-10', amount: '10000.00' }, { invoiceNo: 'INV-0002', invoiceDate: '2026-09-12', amount: '2345.50' }],
  unallocatedAmount: '0.00',
};

test('a posted receipt says who paid what, in figures and in words, and what it was set against', async () => {
  const text = pdfText(await svc.receiptPdf(base));
  for (const s of ['RECEIPT', 'No: RC-0007', 'Date: 2026-09-14', 'Received from:', 'BuildCo Constructions', '12 Anna Salai, Chennai, Tamil Nadu, 600002', 'GSTIN: 33AAACB1234C1Z5',
    'INR 12,345.50', 'Amount in words: Rupees Twelve Thousand Three Hundred Forty-Five and Paise Fifty Only',
    'Mode: neft', 'Ref: UTR-77', 'Set against', 'INV-0001', 'INV-0002', '2,345.50']) {
    assert.ok(text.includes(s), `receipt must print "${s}"`);
  }
  for (const s of ['Subject to realisation', 'REVERSED', 'INSTRUMENT RETURNED', 'Unallocated']) {
    assert.ok(!text.includes(s), `a settled receipt must not print "${s}"`);
  }
});

test('a cheque still clearing is subject to realisation; an advance says where the money sits', async () => {
  const text = pdfText(await svc.receiptPdf({ ...base, paymentMode: 'cheque', clearingStatus: 'pending', allocations: [], unallocatedAmount: '12345.50', isAdvance: true }));
  assert.ok(text.includes('Subject to realisation of the cheque / instrument.'));
  assert.ok(text.includes('Unallocated: INR 12,345.50'), 'the unallocated amount is on the document');
  assert.ok(!text.includes('Set against'), 'no allocation table when nothing is allocated');
});

test('a bounced or reversed receipt announces that it discharges nothing', async () => {
  const bounced = pdfText(await svc.receiptPdf({ ...base, paymentMode: 'cheque', clearingStatus: 'bounced' }));
  assert.ok(bounced.includes('INSTRUMENT RETURNED'), 'a bounced cheque');
  assert.ok(!bounced.includes('Subject to realisation'), 'and no longer "subject to realisation"');
  const reversed = pdfText(await svc.receiptPdf({ ...base, status: 'reversed' }));
  assert.ok(reversed.includes('REVERSED'), 'a reversed receipt');
});

test('the tax invoice carries its total in words as well', async () => {
  const text = pdfText(await svc.invoicePdf({
    companyName: 'Mix Nova RMC', invoiceNo: 'INV-0001', invoiceStatus: 'issued', customerName: 'BuildCo', isInterstate: false,
    items: [{ description: 'M25', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 6000, taxableAmount: 48000, gstRate: 18, cgstAmount: 4320, sgstAmount: 4320, igstAmount: 0, lineTotal: 56640 }],
    taxableAmount: 48000, cgstAmount: 4320, sgstAmount: 4320, igstAmount: 0, cessAmount: 0, roundOff: 0, totalAmount: 56640,
  }));
  assert.ok(text.includes('Amount in words: Rupees Fifty-Six Thousand Six Hundred Forty Only'), 'the invoice total in words');
});

test('the receipts screen can record an advance: the button is not inside the "has open invoices" branch', () => {
  // A new customer's first receipt is an advance before the first pour. The
  // Record button used to live inside the open-invoices branch, so a customer
  // with nothing outstanding could not be receipted at all.
  const src = readFileSync(resolve(repoRoot, 'apps/web/src/app/app/billing/receipts/page.tsx'), 'utf8');
  const button = src.indexOf('Record receipt</Button>');
  const noInvoices = src.indexOf('No outstanding invoices for this customer');
  assert.ok(button > 0 && noInvoices > 0, 'both the button and the no-invoices message exist');
  assert.ok(button > noInvoices, 'the Record button is rendered after (outside) the open-invoices ternary');
  assert.match(src, /held as an advance/, 'and the screen says what happens to the money');
});
