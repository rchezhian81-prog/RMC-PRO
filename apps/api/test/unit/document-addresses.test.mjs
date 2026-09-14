/**
 * The documents say where. A tax invoice must carry the recipient's name,
 * address and GSTIN (CGST Rule 46(c)/(d)) and the place of supply with its
 * state; ours printed the name and GSTIN and no address at all. A delivery
 * challan is what the driver navigates by; ours named the site and gave no
 * address and nobody to call.
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
const invoice = {
  companyName: 'Mix Nova RMC', invoiceNo: 'INV-0001', invoiceStatus: 'issued', customerName: 'BuildCo', isInterstate: false,
  items: [{ description: 'M25', hsnSac: '3824', uom: 'm3', quantity: 8, rate: 6000, taxableAmount: 48000, gstRate: 18, cgstAmount: 4320, sgstAmount: 4320, igstAmount: 0, lineTotal: 56640 }],
  taxableAmount: 48000, cgstAmount: 4320, sgstAmount: 4320, igstAmount: 0, cessAmount: 0, roundOff: 0, totalAmount: 56640,
};

test('the invoice prints the recipient address, the ship-to site, and the place of supply with its state code', async () => {
  const text = pdfText(await svc.invoicePdf({
    ...invoice, customerGstin: '33AAACB1234C1Z5', customerAddress: '12 Anna Salai, Chennai, Tamil Nadu, 600002',
    shipToName: 'Tower B site', shipToAddress: 'OMR, Sholinganallur, Chennai, Tamil Nadu, 600119', placeOfSupply: 'Tamil Nadu', placeOfSupplyCode: '33',
  }));
  for (const s of ['Bill to:', 'BuildCo', '12 Anna Salai, Chennai, Tamil Nadu, 600002', 'GSTIN: 33AAACB1234C1Z5', 'Ship to:', 'Tower B site',
    'OMR, Sholinganallur, Chennai, Tamil Nadu, 600119', 'Place of supply: Tamil Nadu (33)']) {
    assert.ok(text.includes(s), `invoice must print "${s}"`);
  }
});

test('an invoice with no site and no known state prints neither a ship-to block nor an empty code', async () => {
  const text = pdfText(await svc.invoicePdf({ ...invoice, placeOfSupply: 'Somewhere' }));
  assert.ok(!text.includes('Ship to:'), 'no site, no Ship to');
  assert.ok(text.includes('Place of supply: Somewhere'), 'the place of supply is still named');
  assert.ok(!text.includes('Somewhere ('), 'and no empty "()" code after it');
});

test('the challan prints the site address and a contact for the driver', async () => {
  const base = { companyName: 'Mix Nova RMC', challanNo: 'DC-001', challanStatus: 'issued', customerName: 'BuildCo', siteName: 'Tower B site', vehicleNo: 'TN01AB1234', driverName: 'R. Kumar', gradeLabel: 'M25', quantityM3: 8 };
  const text = pdfText(await svc.challanPdf({ ...base, siteAddress: 'OMR, Sholinganallur, Chennai, Tamil Nadu, 600119', siteContact: 'Site engineer Ravi · 9876543210' }));
  assert.ok(text.includes('Site address:'), 'a Site address row');
  assert.ok(text.includes('OMR, Sholinganallur, Chennai, Tamil Nadu, 600119'));
  assert.ok(text.includes('Site contact:') && text.includes('Site engineer Ravi · 9876543210'));
  const bare = pdfText(await svc.challanPdf(base));
  assert.ok(!bare.includes('Site address:') && !bare.includes('Site contact:'), 'no empty rows when the site has none');
});

test('the services feed the documents the address, the site and the state code', () => {
  const inv = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/billing/invoice.service.ts'), 'utf8'));
  assert.match(inv, /getRepository\(Site\)\.findOne\(\{ where: \{ id: full\.siteId \} \}\)/, 'the invoice loads its site');
  assert.match(inv, /customerAddress: joinAddress\(full\.billingAddress/, 'the address snapshotted on the invoice comes first');
  assert.match(inv, /placeOfSupplyCode: resolveGstStateCode\(full\.placeOfSupply\)/, 'the state code comes from the shared table, not a local map');
  const ch = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/dispatch/delivery-challan.service.ts'), 'utf8'));
  assert.match(ch, /siteAddress: site \?/, 'the challan carries the site address');
  assert.match(ch, /siteContact: site \?/, 'and the site contact');
});
