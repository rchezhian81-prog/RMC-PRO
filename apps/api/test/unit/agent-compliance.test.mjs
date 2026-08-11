/**
 * Unit tests for the M5 compliance payload builders — deterministic transforms
 * over an invoice, no I/O. Covers e-way validity (1 day / 200 km) and the
 * e-invoice / e-way payload shapes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ewayValidityDays, buildEinvoicePayload, buildEwayPayload, invoiceNeedsEway,
  buildEinvoiceCancelPayload, buildEwayCancelPayload, cancelReasonCode,
} from '../../dist/agents/compliance.util.js';

test('e-way validity is 1 day per 200 km, minimum 1', () => {
  assert.equal(ewayValidityDays(200), 1);
  assert.equal(ewayValidityDays(201), 2);
  assert.equal(ewayValidityDays(350), 2);
  assert.equal(ewayValidityDays(0), 1);
  assert.equal(ewayValidityDays(null), 1);
  assert.equal(ewayValidityDays(undefined), 1);
});

const inv = {
  invoiceNo: 'INV0001', invoiceDate: '2026-08-01',
  totalAmount: '295000.00', taxableAmount: '250000.00',
  cgstAmount: '0', sgstAmount: '0', igstAmount: '45000.00', cessAmount: '0',
  placeOfSupply: '33', gstin: '33ABCDE1234F1Z5', distanceKm: 350,
  transportMode: 'road', vehicleNo: 'TN01AB1234',
};

test('e-invoice payload carries the INV-01 essentials as numbers', () => {
  const p = buildEinvoicePayload(inv);
  assert.equal(p.schema, 'INV-01');
  assert.equal(p.docNo, 'INV0001');
  assert.equal(p.totalAmount, 295000);
  assert.equal(p.igst, 45000);
  assert.match(String(p.note), /READY-ONLY/);
});

test('invoiceNeedsEway flags Path A only for an over-threshold moving consignment', () => {
  assert.equal(invoiceNeedsEway(inv), true); // ₹2,95,000 over 350 km
  assert.equal(invoiceNeedsEway({ ...inv, totalAmount: '40000' }), false); // below ₹50,000
  assert.equal(invoiceNeedsEway({ ...inv, distanceKm: 0 }), false); // no movement
  assert.equal(invoiceNeedsEway({ ...inv, totalAmount: '120000' }, 100000), true); // configurable threshold
});

test('e-invoice payload flags includeEway (Path A) when the invoice also needs an e-way', () => {
  assert.equal(buildEinvoicePayload(inv).includeEway, true);
  assert.match(String(buildEinvoicePayload(inv).note), /Path A/);
  // A small local-delivery invoice under the threshold → IRN only.
  const small = buildEinvoicePayload({ ...inv, totalAmount: '40000' });
  assert.equal(small.includeEway, false);
  assert.doesNotMatch(String(small.note), /Path A/);
});

test('cancelReasonCode accepts 1–4 and rejects anything else', () => {
  for (const c of ['1', '2', '3', '4']) assert.equal(cancelReasonCode(c), c);
  assert.equal(cancelReasonCode(3), '3'); // coerces a number
  for (const bad of ['0', '5', '9', '', null, undefined, 'x']) {
    assert.throws(() => cancelReasonCode(bad), /invalid cancellation reason code/);
  }
});

test('cancel payloads carry the reason + remarks and a READY-ONLY note', () => {
  const irn = buildEinvoiceCancelPayload(inv, '3', 'order cancelled');
  assert.equal(irn.action, 'cancel');
  assert.equal(irn.docNo, 'INV0001');
  assert.equal(irn.reasonCode, '3');
  assert.equal(irn.remarks, 'order cancelled');
  assert.match(String(irn.note), /cancel IRN/);

  const eway = buildEwayCancelPayload(inv, '2'); // no remarks → null
  assert.equal(eway.reasonCode, '2');
  assert.equal(eway.remarks, null);
  assert.match(String(eway.note), /cancel e-way/);

  // An invalid reason code is rejected at prepare time (before any approval).
  assert.throws(() => buildEinvoiceCancelPayload(inv, '9'), /invalid cancellation reason code/);
});

test('e-way payload carries consignment value + computed validity', () => {
  const p = buildEwayPayload(inv);
  assert.equal(p.docNo, 'INV0001');
  assert.equal(p.consignmentValue, 295000);
  assert.equal(p.validityDays, 2); // ceil(350/200)
  assert.equal(p.vehicleNo, 'TN01AB1234');
  assert.match(String(p.note), /held for deployment/);
});
