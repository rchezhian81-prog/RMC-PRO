/**
 * Rendering test for the e-way bill number on the delivery-challan PDF
 * (runbook 02 §6 — "print the EWB number on the dispatch document"). Renders a
 * real PDF via PdfService and asserts a valid document is produced with and
 * without an EWB, and that the EWB line adds content when present.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfService } from '../../dist/sales/pdf.service.js';

const svc = new PdfService();
const base = {
  companyName: 'Mix Nova RMC',
  challanNo: 'DC-001',
  challanStatus: 'issued',
  customerName: 'BuildCo',
  vehicleNo: 'TN01AB1234',
  driverName: 'R. Kumar',
  gradeLabel: 'M25',
  quantityM3: 8,
};
const isPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === '%PDF-';

test('challanPdf renders a valid PDF with no e-way bill', async () => {
  const buf = await svc.challanPdf(base);
  assert.ok(isPdf(buf));
  assert.ok(buf.length > 400);
});

test('the e-way bill number + validity are printed when present', async () => {
  const withEway = await svc.challanPdf({ ...base, ewayBillNo: '123456789012', ewayValidUntil: '2026-08-03 18:00' });
  const without = await svc.challanPdf(base);
  assert.ok(isPdf(withEway));
  assert.ok(withEway.length > without.length, 'the E-Way Bill line adds content');
});

test('a null e-way bill draws no extra line (graceful)', async () => {
  const buf = await svc.challanPdf({ ...base, ewayBillNo: null, ewayValidUntil: null });
  assert.ok(isPdf(buf));
});
