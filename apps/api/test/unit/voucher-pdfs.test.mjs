/**
 * Every document a person might need on paper can be printed from where it
 * is listed, and two that could not be printed at all now can: the expense
 * payment voucher (cash/bank paid out, signed by the payee) and the vendor
 * payment advice (what was paid to a supplier and against which bills).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PdfService } from '../../dist/sales/pdf.service.js';
import { pdfText } from '../helpers/pdf-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const svc = new PdfService();
const co = { companyName: 'Mix Nova RMC', companyGstin: '33AABCA1234B1ZO' };

test('the payment voucher says who was paid, for what, allocated where, with three signatures', async () => {
  const text = pdfText(await svc.expenseVoucherPdf({ ...co, voucherNo: 'EV-0007', voucherDate: '2026-09-14', status: 'posted', payee: 'IOCL Pump', paymentMode: 'cash', plantName: 'Sriperumbudur plant', narration: 'Genset diesel for the week',
    lines: [{ head: 'Diesel', description: 'Genset diesel', allocation: 'Sriperumbudur plant', amount: 6000 }, { head: 'Bata', description: null, allocation: null, amount: 500 }], totalAmount: 6500 }));
  for (const s of ['PAYMENT VOUCHER', 'No: EV-0007', 'Date: 2026-09-14', 'Paid to:', 'IOCL Pump', 'Mode: cash   Plant: Sriperumbudur plant', 'INR 6,500.00', 'Amount in words: Rupees Six Thousand Five Hundred Only',
    'Diesel', 'Genset diesel', 'Bata', '6,000.00', '500.00', 'Total', 'Narration:', 'Genset diesel for the week', 'Prepared by:', 'Authorised by:', 'Received by (payee):']) {
    assert.ok(text.includes(s), `voucher must print "${s}"`);
  }
  assert.ok(!text.includes('DRAFT') && !text.includes('CANCELLED'), 'a posted voucher carries no caveat');
  const draft = pdfText(await svc.expenseVoucherPdf({ ...co, voucherNo: 'EV-0008', status: 'draft', payee: 'Misc', lines: [], totalAmount: 500 }));
  assert.ok(draft.includes('DRAFT'), 'a draft says it is not yet posted');
  const cancelled = pdfText(await svc.expenseVoucherPdf({ ...co, voucherNo: 'EV-0009', status: 'cancelled', payee: 'Misc', lines: [], totalAmount: 500 }));
  assert.ok(cancelled.includes('CANCELLED'), 'a cancelled voucher says so');
});

test('the payment advice tells the supplier what was paid and against which bills; a reversal says the bills remain payable', async () => {
  const text = pdfText(await svc.vendorPaymentPdf({ ...co, paymentNo: 'VP-0003', paymentDate: '2026-09-14', status: 'posted', supplierName: 'Chettinad Cement Agencies', supplierGstin: '33AAACC1234D1Z9', amount: 238080, paymentMode: 'neft', bankReference: 'UTR-77',
    bills: [{ billNo: 'VB-0012', supplierBillNo: 'CCA/2026/881', billDate: '2026-09-10', amount: 200000 }, { billNo: 'VB-0013', supplierBillNo: 'CCA/2026/902', billDate: '2026-09-12', amount: 38080 }], unallocatedAmount: 0 }));
  for (const s of ['PAYMENT ADVICE', 'No: VP-0003', 'Paid to:', 'Chettinad Cement Agencies', 'GSTIN: 33AAACC1234D1Z9', 'INR 2,38,080.00', 'Amount in words: Rupees Two Lakh Thirty-Eight Thousand Eighty Only', 'Mode: neft   Ref: UTR-77',
    'Against your bills', 'VB-0012', 'CCA/2026/881', '2,00,000.00', 'VB-0013', 'CCA/2026/902', '38,080.00', 'For Mix Nova RMC', 'Authorised Signatory']) {
    assert.ok(text.includes(s), `advice must print "${s}"`);
  }
  assert.ok(!text.includes('Unallocated'), 'nothing unallocated, nothing said');
  const adv = pdfText(await svc.vendorPaymentPdf({ ...co, paymentNo: 'VP-0004', status: 'posted', supplierName: 'X', amount: 5000, bills: [], unallocatedAmount: 5000 }));
  assert.ok(adv.includes('Unallocated: INR 5,000.00'), 'an advance says where the money sits');
  const rev = pdfText(await svc.vendorPaymentPdf({ ...co, paymentNo: 'VP-0004', status: 'reversed', supplierName: 'X', amount: 5000, bills: [], unallocatedAmount: 5000 }));
  assert.ok(rev.includes('REVERSED') && rev.includes('remain payable'));
});

test('every document is printable from the screen that lists it — one Print button per row, through openPdf', () => {
  const lists = {
    'billing/invoices/page.tsx': '/invoices/',
    'billing/receipts/page.tsx': '/receipts/',
    'sales/quotations/page.tsx': '/quotations/',
    'dispatch/challans/page.tsx': '/delivery-challans/',
    'purchase/orders/page.tsx': '/purchase-orders/',
    'purchase/bills/page.tsx': '/vendor-payments/',
    'expenses/vouchers/page.tsx': '/expense-vouchers/',
  };
  for (const [f, path] of Object.entries(lists)) {
    const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/web/src/app/app', f), 'utf8'));
    // openPdf(`<path>${…}/pdf`) — the row's id interpolated into the document route.
    const call = 'openPdf(`' + path + '${';
    const at = src.indexOf(call);
    assert.ok(at > 0, `${f} has a Print button for ${path}`);
    assert.ok(src.slice(at, at + 200).includes('}/pdf`'), `${f} points that button at the /pdf route`);
    assert.match(src, />\s*Print\s*</, `${f} calls it Print`);
  }
  for (const f of ['sales/quotations/[id]/page.tsx', 'billing/invoices/[id]/page.tsx', 'dispatch/challans/[id]/page.tsx']) {
    const src = readFileSync(resolve(repoRoot, 'apps/web/src/app/app', f), 'utf8');
    assert.ok(src.includes('Print / PDF') && !src.includes('Download PDF'), `${f} says Print / PDF`);
  }
});
