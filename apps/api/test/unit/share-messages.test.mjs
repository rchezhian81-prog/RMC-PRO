/**
 * The texts a customer gets on their phone when a document is shared. They
 * used to read "Invoice INV0017 for ₹56640.00. Status: issued. Thank you." —
 * no sender, a raw number, an internal status word. These pin the words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inr, dmy, invoiceShareMessage, receiptShareMessage, challanShareMessage, quotationShareMessage } from '../../dist/common/share-messages.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const co = 'Mix Nova RMC';

test('money and dates read the Indian way', () => {
  assert.equal(inr(56640), '56,640.00');
  assert.equal(inr('1234567.5'), '12,34,567.50');
  assert.equal(inr(null), '0.00');
  assert.equal(dmy('2026-09-14'), '14/09/2026');
  assert.equal(dmy(null), '');
});

test('an invoice names the sender, the date, the amount and the due date; a cancelled one says so', () => {
  assert.equal(
    invoiceShareMessage({ companyName: co, invoiceNo: 'INV-0017', invoiceDate: '2026-09-14', dueDate: '2026-10-14', totalAmount: '56640.00', invoiceStatus: 'issued' }),
    'Mix Nova RMC: Invoice INV-0017 dated 14/09/2026 for ₹56,640.00, due 14/10/2026. Thank you.',
  );
  assert.equal(
    invoiceShareMessage({ companyName: co, invoiceNo: 'INV-0017', invoiceDate: '2026-09-14', totalAmount: 56640, invoiceStatus: 'cancelled' }),
    'Mix Nova RMC: Invoice INV-0017 dated 14/09/2026 has been CANCELLED. Please disregard it.',
  );
});

test('a receipt says what was received and how; a pending cheque is subject to realisation; a reversal says the amount is still due', () => {
  assert.equal(
    receiptShareMessage({ companyName: co, receiptNo: 'RCPT0056/26-27', receiptDate: '2026-09-14', amount: 10000, paymentMode: 'cheque', bankReference: 'CHQ 004512', status: 'posted', clearingStatus: 'pending' }),
    'Mix Nova RMC: Receipt RCPT0056/26-27 — ₹10,000.00 received on 14/09/2026 by cheque (CHQ 004512). Subject to realisation of the cheque. Thank you.',
  );
  assert.equal(
    receiptShareMessage({ companyName: co, receiptNo: 'RCPT0056/26-27', receiptDate: '2026-09-14', amount: 10000, paymentMode: 'cheque', status: 'posted', clearingStatus: 'realised' }),
    'Mix Nova RMC: Receipt RCPT0056/26-27 — ₹10,000.00 received on 14/09/2026 by cheque. Thank you.',
  );
  assert.equal(
    receiptShareMessage({ companyName: co, receiptNo: 'RCPT0056/26-27', receiptDate: '2026-09-14', amount: 10000, status: 'reversed', clearingStatus: 'bounced' }),
    'Mix Nova RMC: Receipt RCPT0056/26-27 for ₹10,000.00 on 14/09/2026 has been REVERSED — the cheque was returned by the bank. The amount remains due.',
  );
});

test('a challan says what is coming, on what, when it left and by when to place it', () => {
  assert.equal(
    challanShareMessage({ companyName: co, challanNo: 'DC-0101', gradeLabel: 'M25', quantityM3: '8.00', vehicleNo: 'TN01AB1234', dispatchedAt: '14/09/2026 10:20', useBy: '14/09/2026 12:05', challanStatus: 'issued' }),
    'Mix Nova RMC: Delivery challan DC-0101 — M25 8 m³ on TN01AB1234, left the plant at 14/09/2026 10:20. Please place by 14/09/2026 12:05.',
  );
  assert.equal(
    challanShareMessage({ companyName: co, challanNo: 'DC-0101', gradeLabel: 'M25', quantityM3: 8, challanStatus: 'cancelled' }),
    'Mix Nova RMC: Delivery challan DC-0101 (M25 8 m³) has been cancelled.',
  );
});

test('a quotation gives its date, revision and validity, and asks for a reply', () => {
  assert.equal(
    quotationShareMessage({ companyName: co, quotationNo: 'QT-0009', revisionNo: 1, quotationDate: '2026-09-14', validUntil: '2026-09-30' }),
    'Mix Nova RMC: Quotation QT-0009 (revision 1) dated 14/09/2026, valid until 30/09/2026. Please review and confirm.',
  );
  assert.equal(
    quotationShareMessage({ companyName: co, quotationNo: 'QT-0009', revisionNo: 0 }),
    'Mix Nova RMC: Quotation QT-0009. Please review and confirm.',
  );
});

test('the five services use the helpers — no inline "Status: …" text left', () => {
  for (const [f, fn] of [['billing/invoice.service.ts', 'invoiceShareMessage'], ['billing/receipt.service.ts', 'receiptShareMessage'], ['dispatch/delivery-challan.service.ts', 'challanShareMessage'], ['sales/quotations.service.ts', 'quotationShareMessage'], ['purchase/purchase-order.service.ts', 'purchaseOrderShareMessage']]) {
    const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src', f), 'utf8'));
    assert.match(src, new RegExp(`\\(dto\\.message as string\\) \\?\\? ${fn}\\(`), `${f} builds its share text with ${fn}`);
    assert.doesNotMatch(src, /Status: \$\{/, `${f} no longer sends an internal status word`);
  }
});
