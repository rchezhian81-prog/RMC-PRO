/**
 * Every commercial document closes with a signature block. CGST Rule 46(q)
 * requires the supplier's (or an authorised representative's) signature on a
 * tax invoice that is not an e-invoice; a customer expects "For <company> /
 * Authorised Signatory" on a quotation and a receipt as much as on an
 * invoice. None of ours had one; the challan had a receiver's line only.
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
const company = 'Mix Nova RMC';

test('invoice, receipt and quotation close with "For <company>" and "Authorised Signatory"', async () => {
  const invoice = pdfText(await svc.invoicePdf({
    companyName: company, invoiceNo: 'INV-0001', invoiceStatus: 'issued', customerName: 'BuildCo', isInterstate: false,
    items: [{ description: 'M25', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 6000, taxableAmount: 48000, gstRate: 18, cgstAmount: 4320, sgstAmount: 4320, igstAmount: 0, lineTotal: 56640 }],
    taxableAmount: 48000, cgstAmount: 4320, sgstAmount: 4320, igstAmount: 0, cessAmount: 0, roundOff: 0, totalAmount: 56640,
  }));
  const receipt = pdfText(await svc.receiptPdf({ companyName: company, receiptNo: 'RC-1', status: 'posted', customerName: 'BuildCo', amount: 100, allocations: [], unallocatedAmount: 100 }));
  const quotation = pdfText(await svc.quotationPdf({ companyName: company, quotationNo: 'QT-1', revisionNo: 0, approvalStatus: 'approved', customerName: 'BuildCo', customerAddress: '12 Anna Salai, Chennai', items: [] }));
  for (const [name, text] of [['invoice', invoice], ['receipt', receipt], ['quotation', quotation]]) {
    assert.ok(text.includes(`For ${company}`), `${name} prints "For ${company}"`);
    assert.ok(text.includes('Authorised Signatory'), `${name} prints "Authorised Signatory"`);
  }
  assert.ok(quotation.includes('12 Anna Salai, Chennai'), 'the quotation prints the customer address');
});

test('the challan has both signatures: the plant on the left, the receiver on the right', async () => {
  const text = pdfText(await svc.challanPdf({ companyName: company, challanNo: 'DC-1', challanStatus: 'issued', customerName: 'BuildCo', gradeLabel: 'M25', quantityM3: 8 }));
  assert.ok(text.includes(`For ${company}:`), 'the plant signs');
  assert.ok(text.includes('Receiver signature:'), 'and the receiver still signs');
});

test('every document opens with the supplier block: name, address, GSTIN and PAN', async () => {
  // CGST Rule 46 (invoice) and Rule 55 (challan) both require the supplier's
  // name, address and GSTIN; the challan and quotation used to print the
  // name and GSTIN only.
  const co = { companyName: company, legalName: 'Mix Nova Concrete Pvt Ltd', companyGstin: '33AABCA1234B1ZO', companyPan: 'AABCA1234B', companyAddress: 'Plot 7, SIPCOT, Sriperumbudur, Tamil Nadu, 602105', companyPhone: '044-2345 6789', companyEmail: 'accounts@mixnova.in' };
  const docs = {
    challan: await svc.challanPdf({ ...co, challanNo: 'DC-1', challanStatus: 'issued', customerName: 'BuildCo', gradeLabel: 'M25', quantityM3: 8 }),
    quotation: await svc.quotationPdf({ ...co, quotationNo: 'QT-1', revisionNo: 0, approvalStatus: 'approved', customerName: 'BuildCo', items: [] }),
    weighbridge: await svc.weighbridgePdf({ ...co, slipNo: 'WB-1', grossWeight: 1, tareWeight: 0, netWeight: 1, status: 'weighed' }),
  };
  for (const [name, buf] of Object.entries(docs)) {
    const text = pdfText(buf);
    for (const s of ['Mix Nova Concrete Pvt Ltd', 'Plot 7, SIPCOT, Sriperumbudur, Tamil Nadu, 602105', 'GSTIN: 33AABCA1234B1ZO   PAN: AABCA1234B', 'Ph: 044-2345 6789   accounts@mixnova.in']) {
      assert.ok(text.includes(s), `${name} prints "${s}"`);
    }
  }
});

test('one company block, built once and drawn once, for all five documents', () => {
  const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/sales/pdf.service.ts'), 'utf8'));
  assert.equal((src.match(/function drawCompanyHeader\(/g) ?? []).length, 1, 'one header drawer');
  assert.equal((src.match(/drawCompanyHeader\(doc, data, left\)/g) ?? []).length, 5, 'invoice, receipt, challan, quotation, weighbridge');
  assert.equal((src.match(/export function companyBlock\(/g) ?? []).length, 1, 'one builder');
  for (const f of ['billing/invoice.service.ts', 'billing/receipt.service.ts', 'dispatch/delivery-challan.service.ts', 'sales/quotations.service.ts', 'inventory/weighbridge.service.ts']) {
    const svcSrc = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src', f), 'utf8'));
    assert.match(svcSrc, /\.\.\.companyBlock\(company\)/, `${f} spreads the shared block`);
    assert.doesNotMatch(svcSrc, /companyGstin: company\?\.gstin/, `${f} no longer assembles the block by hand`);
  }
});

test('one signature block, drawn by one helper, on the three documents that close with it', () => {
  const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/sales/pdf.service.ts'), 'utf8'));
  assert.equal((src.match(/function drawSignatoryBlock\(/g) ?? []).length, 1, 'one definition');
  assert.equal((src.match(/drawSignatoryBlock\(doc, data\.companyName, left, right\)/g) ?? []).length, 3, 'invoice, receipt, quotation');
  assert.equal((src.match(/Authorised Signatory/g) ?? []).length, 1, 'the wording lives in the helper only');
});
