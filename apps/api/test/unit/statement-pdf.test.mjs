/**
 * The customer statement of account can be printed — the ledger a customer
 * reconciles against and a collections call is made from. It had a screen
 * and a CSV, and nothing a person could hand over or attach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfService } from '../../dist/sales/pdf.service.js';
import { pdfText } from '../helpers/pdf-text.mjs';

const svc = new PdfService();
const base = {
  companyName: 'Mix Nova RMC', companyGstin: '33AABCA1234B1ZO', customerName: 'BuildCo Constructions', customerGstin: '33AAACB1234C1Z5',
  customerAddress: '12 Anna Salai, Chennai', from: '2026-04-01', to: '2026-09-30', opening: 12000,
  rows: [
    { date: '2026-04-03', particulars: 'Invoice INV-0001', ref: 'INV-0001', debit: 56640, credit: 0, balance: 68640 },
    { date: '2026-04-20', particulars: 'Receipt RCPT0001/26-27 (neft)', ref: 'RCPT0001/26-27', debit: 0, credit: 50000, balance: 18640 },
  ],
  totalDebit: 56640, totalCredit: 50000, closing: 18640,
};
const pages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test('the statement prints the period, the party, opening, every line, totals and the closing due', async () => {
  const text = pdfText(await svc.statementPdf(base));
  for (const s of ['STATEMENT OF ACCOUNT', 'Period: 2026-04-01 to 2026-09-30', 'BuildCo Constructions', '12 Anna Salai, Chennai', 'GSTIN: 33AAACB1234C1Z5',
    'Opening balance', '12,000.00', 'Invoice INV-0001', '56,640.00', 'Receipt RCPT0001/26-27 (neft)', '50,000.00', 'Totals for the period',
    'Closing balance', '18,640.00', 'Amount due from you: INR 18,640.00', 'report any discrepancy within 7 days', 'For Mix Nova RMC', 'Authorised Signatory']) {
    assert.ok(text.includes(s), `statement must print "${s}"`);
  }
});

test('a balance in the customer\'s favour, and a nil balance, are said that way', async () => {
  const credit = pdfText(await svc.statementPdf({ ...base, closing: -2500 }));
  assert.ok(credit.includes('Balance in your favour: INR 2,500.00'));
  const nil = pdfText(await svc.statementPdf({ ...base, closing: 0 }));
  assert.ok(nil.includes('No balance outstanding.'));
});

test('a long ledger runs to more pages and repeats the column headings', async () => {
  const rows = Array.from({ length: 90 }, (_, i) => ({ date: '2026-05-01', particulars: `Invoice INV-${String(i + 1).padStart(4, '0')}`, ref: `INV-${i + 1}`, debit: 1000, credit: 0, balance: 12000 + (i + 1) * 1000 }));
  const buf = await svc.statementPdf({ ...base, rows, totalDebit: 90000, totalCredit: 0, closing: 102000 });
  assert.ok(pages(buf) >= 3, `90 rows need several pages (got ${pages(buf)})`);
  const text = pdfText(buf);
  assert.ok((text.match(/\nParticulars\n/g) ?? []).length >= 3, 'the heading row is repeated on each page');
  assert.ok(text.includes('Closing balance') && text.includes('1,02,000.00'), 'and the closing survives the page breaks');
});
