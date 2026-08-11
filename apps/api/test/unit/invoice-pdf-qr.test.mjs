/**
 * Rendering tests for the invoice PDF's e-invoice signed-QR block (runbook 01 §5).
 * Renders real PDFs via PdfService and asserts: a valid PDF is produced with and
 * without an IRN, the QR block adds content when the signed QR is present, and a
 * blank/absent signed QR degrades gracefully (never throws, still a valid PDF).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfService } from '../../dist/sales/pdf.service.js';

const svc = new PdfService();

const base = {
  companyName: 'Mix Nova RMC',
  companyGstin: '33ABCDE1234F1Z5',
  invoiceNo: 'INV-001',
  invoiceStatus: 'issued',
  customerName: 'BuildCo',
  isInterstate: false,
  items: [
    { description: 'M25 concrete', hsnSac: '38245010', uom: 'CUM', quantity: 50, rate: 5000, taxableAmount: 250000, gstRate: 18, cgstAmount: 22500, sgstAmount: 22500, igstAmount: 0, lineTotal: 295000 },
  ],
  taxableAmount: 250000, cgstAmount: 22500, sgstAmount: 22500, igstAmount: 0, cessAmount: 0, roundOff: 0, totalAmount: 295000,
};

const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === '%PDF-';

test('invoicePdf renders a valid PDF with no IRN (no QR block)', async () => {
  const buf = await svc.invoicePdf(base);
  assert.ok(isPdf(buf), 'starts with the %PDF- signature');
  assert.ok(buf.length > 500);
});

test('the signed-QR block is drawn when an IRN + signed QR are present', async () => {
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.' + 'AbC012_-'.repeat(90) + '.' + 'Zz9y8x7w'.repeat(10);
  const withQr = await svc.invoicePdf({
    ...base,
    irn: 'a1b2'.repeat(16),
    signedQrCode: jwt,
    ackNo: '112420036259',
    ackDate: '2026-08-01 10:00',
  });
  const without = await svc.invoicePdf(base);
  assert.ok(isPdf(withQr));
  assert.ok(withQr.length > without.length, 'the QR rectangles add content vs. the same invoice without an IRN');
});

test('a blank signed QR draws no block and still renders (graceful)', async () => {
  const buf = await svc.invoicePdf({ ...base, signedQrCode: '', irn: null });
  assert.ok(isPdf(buf));
});
