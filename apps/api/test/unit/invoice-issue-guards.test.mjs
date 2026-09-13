/**
 * What must be true before a TAX INVOICE can be issued.
 *
 * Rule 46 makes the SUPPLIER's own GSTIN mandatory on a tax invoice, and the
 * PDF prints that line only when there is one — so a company record with the
 * field left blank produced a clean-looking "TAX INVOICE" carrying no supplier
 * GSTIN at all. It looks right, it is not a valid tax invoice, and the customer
 * cannot claim the credit from it.
 *
 * The company's STATE is mandatory for a different reason: it is the seller
 * side of the CGST + SGST vs IGST decision, and a blank one silently makes
 * every supply local.
 *
 * Both are unset on a newly provisioned tenant — deliberately, since they must
 * be the operator's own numbers — so this was the DEFAULT state of the system,
 * not an unlucky edge case. Found by reading an actual generated PDF, where the
 * company block read "Alpha Ready Mix / TN / State: TN" and no GSTIN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/billing/invoice.service.ts'), 'utf8');
const issue = src.slice(src.indexOf('async issue('), src.indexOf('async cancel(') > 0 ? src.indexOf('async cancel(') : undefined);

test('issuing refuses a missing or invalid company GSTIN', () => {
  assert.match(issue, /isGstin\(company\?\.gstin\)/, 'the supplier GSTIN must be validated, not merely present');
  assert.match(issue, /company GSTIN is missing or not valid/);
  assert.match(issue, /Settings → Company/, 'the message must say where to fix it');
});

test('issuing refuses a company state that names no real state', () => {
  assert.match(issue, /gstStateCode\(company\?\.state/, 'the state must resolve to a GST state code');
  assert.match(issue, /CGST \+ SGST or IGST/, 'the message must say why the state matters');
});

test('the existing HSN guard is still there', () => {
  assert.match(issue, /Every line needs an HSN\/SAC before issuing/);
});

test('the guards run BEFORE a number is drawn', () => {
  // The series must not advance for an invoice that is then refused — that
  // would leave a gap in a GST number series, which is itself a defect.
  const gstinAt = issue.indexOf('isGstin(company?.gstin)');
  const numberAt = issue.indexOf("this.numbering.next(m, tenantId, 'invoice'");
  assert.ok(gstinAt > 0 && numberAt > 0, 'both the guard and the numbering call must be present');
  assert.ok(gstinAt < numberAt, 'a refused invoice must not consume an invoice number');
});

test('the PDF still prints the supplier GSTIN when there is one', () => {
  const pdf = readFileSync(resolve(here, '../../src/sales/pdf.service.ts'), 'utf8');
  assert.match(pdf, /if \(data\.companyGstin\) doc\.text\(`GSTIN: \$\{data\.companyGstin\}`\)/);
});
