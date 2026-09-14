/**
 * A purchase order can be printed and sent. The PO is the document a
 * supplier's dispatch works from; ours could be issued (a status change) and
 * nothing more — no print, no share.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfService } from '../../dist/sales/pdf.service.js';
import { purchaseOrderShareMessage } from '../../dist/common/share-messages.util.js';
import { pdfText } from '../helpers/pdf-text.mjs';

const svc = new PdfService();
const base = {
  companyName: 'Mix Nova RMC', companyGstin: '33AABCA1234B1ZO', poNo: 'PO-0012', orderDate: '2026-09-14', expectedDate: '2026-09-16', status: 'issued',
  supplierName: 'Chettinad Cement Agencies', supplierGstin: '33AAACC1234D1Z9', supplierContact: 'Mani · 98765 43210', deliverTo: 'Sriperumbudur plant, Sriperumbudur',
  items: [
    { materialLabel: 'OPC 53 grade cement', uom: 'MT', quantity: 30, rate: 6200, gstRate: 28, taxableAmount: 186000, taxAmount: 52080, lineTotal: 238080 },
    { materialLabel: 'M-sand', uom: 'MT', quantity: 100, rate: 900, gstRate: 5, taxableAmount: 90000, taxAmount: 4500, lineTotal: 94500 },
  ],
  taxableAmount: 276000, taxAmount: 56580, totalAmount: 332580, remarks: 'Delivery between 8 am and 5 pm.',
};

test('the PO says what, from whom, delivered where and by when, with totals in figures and words', async () => {
  const text = pdfText(await svc.purchaseOrderPdf(base));
  for (const s of ['PURCHASE ORDER', 'No: PO-0012', 'Date: 2026-09-14', 'Deliver by: 2026-09-16', 'To:', 'Chettinad Cement Agencies', 'GSTIN: 33AAACC1234D1Z9', 'Mani · 98765 43210',
    'Deliver to:', 'Sriperumbudur plant, Sriperumbudur', 'OPC 53 grade cement', 'M-sand', '1,86,000.00', '2,38,080.00', 'Total   INR 3,32,580.00',
    'Amount in words: Rupees Three Lakh Thirty-Two Thousand Five Hundred Eighty Only', 'Delivery between 8 am and 5 pm.', 'Please quote the PO number', 'For Mix Nova RMC', 'Authorised Signatory']) {
    assert.ok(text.includes(s), `PO must print "${s}"`);
  }
  assert.ok(!text.includes('CANCELLED'), 'a live order carries no cancellation banner');
});

test('a cancelled PO says so in red and asks the supplier not to supply', async () => {
  const text = pdfText(await svc.purchaseOrderPdf({ ...base, status: 'cancelled' }));
  // pdfkit wraps the sentence, so the two halves are checked separately.
  assert.ok(text.includes('CANCELLED') && text.includes('do not supply against it'), 'the banner is on the page');
});

test('the share text tells the supplier what to send, by when, and to quote the PO number', () => {
  assert.equal(
    purchaseOrderShareMessage({ companyName: 'Mix Nova RMC', poNo: 'PO-0012', orderDate: '2026-09-14', expectedDate: '2026-09-16', totalAmount: 332580, status: 'issued', lines: ['OPC 53 grade cement 30 MT @ ₹6200', 'M-sand 100 MT @ ₹900'] }),
    'Mix Nova RMC: Purchase order PO-0012 dated 14/09/2026 — OPC 53 grade cement 30 MT @ ₹6200; M-sand 100 MT @ ₹900, total ₹3,32,580.00, deliver by 16/09/2026. Please quote the PO number on your challan and invoice.',
  );
  assert.equal(
    purchaseOrderShareMessage({ companyName: 'Mix Nova RMC', poNo: 'PO-0012', orderDate: '2026-09-14', totalAmount: 1, status: 'cancelled', lines: [] }),
    'Mix Nova RMC: Purchase order PO-0012 dated 14/09/2026 has been CANCELLED. Please do not supply against it.',
  );
});
