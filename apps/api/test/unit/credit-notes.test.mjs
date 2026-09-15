/**
 * GST credit / debit notes (CGST Rule 53), the parts that need no database:
 * the note arithmetic, the one invoice-balance formula now that notes are in
 * it, the printed note, and the guards that keep the feature wired end to
 * end (invoice cancel refuses with a live note; every balance recompute
 * passes the notes; the reports net them; the web has the screens).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { computeNoteLines, noteTotals, creditHeadroom, NOTE_REASONS, NOTE_TYPES } from '../../dist/billing/credit-note.util.js';
import { invoiceBalanceAfter } from '../../dist/billing/receipt-allocation.util.js';
import { PdfService } from '../../dist/sales/pdf.service.js';
import { pdfText } from '../helpers/pdf-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const count = (src, needle) => src.split(needle).length - 1;

test('a note line is taxed like an invoice line: CGST+SGST within the state, IGST across it', () => {
  const [intra] = computeNoteLines([{ description: 'M25 rate difference', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 500, gstRate: 18 }], false);
  assert.equal(intra.taxableAmount, 4000);
  assert.equal(intra.cgstAmount, 360);
  assert.equal(intra.sgstAmount, 360);
  assert.equal(intra.igstAmount, 0);
  assert.equal(intra.lineTotal, 4720);
  const [inter] = computeNoteLines([{ quantity: '8', rate: '500', gstRate: '18' }], true);
  assert.equal(inter.igstAmount, 720);
  assert.equal(inter.cgstAmount, 0);
  assert.equal(inter.lineTotal, 4720);
  const [neg] = computeNoteLines([{ quantity: -2, rate: -100, gstRate: 18 }], false);
  assert.equal(neg.taxableAmount, 200, 'a sign typed on a note is ignored — the note type carries the direction');
});

test('the note total is rounded to the rupee the way the invoice is, with the round-off shown', () => {
  const lines = computeNoteLines([{ quantity: 1.5, rate: 3333, gstRate: 18 }], false);
  const t = noteTotals(lines);
  assert.equal(t.taxableAmount, 4999.5);
  assert.equal(Number.isInteger(t.totalAmount), true);
  assert.ok(Math.abs(t.roundOff) <= 0.5, `round-off ${t.roundOff} is under half a rupee`);
  assert.equal(Math.round((t.taxableAmount + t.cgstAmount + t.sgstAmount + t.roundOff) * 100) / 100, t.totalAmount);
});

test('what a credit note may still credit: the invoice total plus debits, less what earlier credit notes took', () => {
  assert.equal(creditHeadroom(47200, 0), 47200);
  assert.equal(creditHeadroom('47200.00', '4720.00'), 42480);
  assert.equal(creditHeadroom(47200, 4720, 1180), 43660);
  assert.deepEqual(NOTE_TYPES, ['credit', 'debit']);
  assert.equal(NOTE_REASONS.rate_difference, 'Rate difference');
  assert.ok(Object.keys(NOTE_REASONS).length >= 6, 'enough reasons for an auditor');
});

test('the one balance formula: notes move the outstanding and the status, and a receipt cannot undo them', () => {
  // A credit note for the whole invoice with nothing received: settled by credit.
  assert.deepEqual(invoiceBalanceAfter(47200, 0, 0, { credited: 47200 }), { outstanding: 0, paymentStatus: 'credited' });
  // Part credited, part paid: still partly paid, the credit is in the figure.
  assert.deepEqual(invoiceBalanceAfter(47200, 10000, 0, { credited: 4720 }), { outstanding: 32480, paymentStatus: 'partially_paid' });
  // A debit note raises what is owed.
  assert.deepEqual(invoiceBalanceAfter(47200, 0, 0, { debited: 1180 }), { outstanding: 48380, paymentStatus: 'unpaid' });
  // Money received closes it as paid even when a credit helped.
  assert.deepEqual(invoiceBalanceAfter(47200, 42480, 0, { credited: 4720 }), { outstanding: 0, paymentStatus: 'paid' });
  // No notes: exactly as before.
  assert.deepEqual(invoiceBalanceAfter('47200.00', '47200.00', 0), { outstanding: 0, paymentStatus: 'paid' });
  assert.deepEqual(invoiceBalanceAfter(47200, 0, 0), { outstanding: 47200, paymentStatus: 'unpaid' });
});

test('the printed credit note: title, number, the invoice it amends, the reason, totals in figures and words, the signatory', async () => {
  const svc = new PdfService();
  const base = {
    companyName: 'Mix Nova RMC', companyGstin: '33AABCA1234B1ZO', noteNo: 'CN-0001', noteDate: '2026-09-15', status: 'issued',
    invoiceNo: 'INV-0017', invoiceDate: '2026-09-14', reason: 'Rate difference', remarks: 'Agreed rate was 4,500',
    customerName: 'BuildCo', customerAddress: '12 Anna Salai, Chennai', customerGstin: '33AAACB1234C1Z5',
    placeOfSupply: 'Tamil Nadu', placeOfSupplyCode: '33', isInterstate: false,
    items: [{ description: 'M25 rate difference', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 500, taxableAmount: 4000, gstRate: 18, cgstAmount: 360, sgstAmount: 360, igstAmount: 0, lineTotal: 4720 }],
    taxableAmount: 4000, cgstAmount: 360, sgstAmount: 360, igstAmount: 0, cessAmount: 0, roundOff: 0, totalAmount: 4720,
  };
  const credit = pdfText(await svc.creditNotePdf({ ...base, noteType: 'credit' }));
  for (const s of ['CREDIT NOTE', 'No: CN-0001', 'Date: 2026-09-15', 'Against invoice: INV-0017 dated 2026-09-14', 'Credited to', 'BuildCo',
    '12 Anna Salai, Chennai', 'GSTIN: 33AAACB1234C1Z5', 'Place of supply: Tamil Nadu (33)', 'Rate difference', 'M25 rate difference', '3824',
    'Total credited   INR 4,720.00', 'Amount in words: Rupees Four Thousand Seven Hundred Twenty Only', 'Agreed rate was 4,500',
    'For Mix Nova RMC', 'Authorised Signatory', 'System-generated credit note.']) {
    assert.ok(credit.includes(s), `credit note prints "${s}"`);
  }
  assert.ok(!credit.includes('DRAFT') && !credit.includes('CANCELLED'), 'an issued note carries no banner');
  const debit = pdfText(await svc.creditNotePdf({ ...base, noteType: 'debit', noteNo: 'DN-0001', reason: 'Additional charge' }));
  assert.ok(debit.includes('DEBIT NOTE') && debit.includes('Debited to') && debit.includes('Total debited   INR 4,720.00'), 'a debit note says so');
  const draft = pdfText(await svc.creditNotePdf({ ...base, noteType: 'credit', noteNo: 'DRAFT', status: 'draft' }));
  assert.ok(draft.includes('DRAFT') && draft.includes('not yet issued'), 'a draft says it has no effect yet');
  const cancelled = pdfText(await svc.creditNotePdf({ ...base, noteType: 'credit', status: 'cancelled' }));
  assert.ok(cancelled.includes('CANCELLED') && cancelled.includes('this note has no effect'), 'a cancelled note says so in the body');
});

test('wired end to end: cancel refuses with a live note, every balance recompute carries the notes, the reports net them', () => {
  const invoice = codeOnly(read('apps/api/src/billing/invoice.service.ts'));
  assert.match(invoice, /CreditNoteService\.liveNoteCount\(m, id\)/, 'invoice cancel asks for live notes');
  for (const f of ['apps/api/src/billing/invoice.service.ts', 'apps/api/src/billing/receipt.service.ts']) {
    const src = codeOnly(read(f));
    const calls = count(src, 'invoiceBalanceAfter(');
    assert.ok(calls >= 1, `${f} settles through the formula`);
    assert.equal(count(src, 'credited: '), calls, `${f}: every one of ${calls} recompute(s) passes the invoice's credit / debit notes`);
  }
  const reports = codeOnly(read('apps/api/src/billing/billing-reports.service.ts'));
  assert.match(reports, /invoices\[h\] - creditNotes\[h\] \+ debitNotes\[h\]/, 'GST summary is net of notes and returns the parts');
  assert.match(reports, /FROM credit_note_items ni/, 'HSN summary carries the notes');
  assert.match(reports, /'Credit Note'/, 'Tally export has a Credit Note voucher');
  assert.match(reports, /'debit_note' : 'credit_note'/, 'the customer statement lists notes');
  const audit = codeOnly(read('apps/api/src/audit/audit.service.ts'));
  for (const a of ["'credit_note.issue'", "'debit_note.issue'", "'credit_note.cancel'"]) assert.ok(audit.includes(a), `audit action ${a}`);
  assert.match(read('apps/api/src/core/database/data-source.ts'), /CreditNotes1720000070000/, 'migration registered');
  assert.match(read('apps/api/src/core/database/entity-list.ts'), /CreditNoteItem/, 'entities registered');
  assert.match(read('apps/api/src/billing/billing.module.ts'), /CreditNoteController/, 'controller mounted');
});

test('the screens: a Credit notes entry in Billing, notes on the invoice, the notes card and net GST on Reports, the RBAC matrix', () => {
  assert.match(read('apps/web/src/app/app/layout.tsx'), /href: '\/app\/billing\/credit-notes', label: 'Credit notes'/);
  const inv = read('apps/web/src/app/app/billing/invoices/[id]/page.tsx');
  assert.match(inv, /creditNotesApi\.forInvoice\(id\)/, 'the invoice loads its notes');
  assert.match(inv, /openNoteForm\('credit'\)/, 'and offers a credit note');
  assert.match(inv, /openNoteForm\('debit'\)/, 'and a debit note');
  assert.match(inv, /creditNotesApi\.invoiceLines\(id\)/, 'prefilled from its own lines');
  const list = read('apps/web/src/app/app/billing/credit-notes/page.tsx');
  assert.match(list, /openPdf\(`\/credit-notes\/\$\{id\}\/pdf`, no \|\|/, 'Print names the tab after the note');
  assert.match(list, /creditNotesApi\.share\(id, m\)/, 'Share goes through the shared WhatsApp opener');
  const reports = read('apps/web/src/app/app/billing/reports/page.tsx');
  assert.match(reports, /GSTR-1 Table 9B/, 'the notes card names the return table');
  assert.match(reports, /net of credit \/ debit notes/, 'the GST card says it is net');
  assert.match(reports, /'customerName', 'gstin'/, 'the sales register export carries the customer name');
  assert.match(read('apps/web/src/components/ui/Badge.tsx'), /'credited'\]/, 'a credited invoice reads as settled, not as a warning');
  const rbac = read('tests/rbac-authorization.mjs');
  for (const r of ["'/credit-notes'", "/credit-notes/00000000-0000-0000-0000-000000000000/issue", "/credit-notes/00000000-0000-0000-0000-000000000000/cancel", "/credit-notes/00000000-0000-0000-0000-000000000000/share"]) {
    assert.ok(rbac.includes(r), `RBAC matrix covers ${r}`);
  }
  assert.match(read('apps/api/test/run-integration.mjs'), /credit-notes\.test\.mjs/, 'the integration test runs in CI');
});
