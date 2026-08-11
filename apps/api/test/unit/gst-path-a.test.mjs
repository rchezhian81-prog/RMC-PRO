/**
 * Path A tests (runbook 02 §4): generate the e-way bill INSIDE the IRN call by
 * embedding EwbDtls in the INV-01, and read the e-way back from the IRN response.
 * Covers the pure builder (EwbDtls), the response mapper (mapIrnData), and the
 * fake provider round-trip — all without a live portal.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIrnRequest } from '../../dist/compliance/gst-payload.util.js';
import { mapIrnData } from '../../dist/compliance/nic-protocol.util.js';
import { FakeGstProvider } from '../../dist/compliance/fake.provider.js';

const seller = { gstin: '33ABCDE1234F1Z5', legalName: 'Mix Nova RMC', address1: 'Plant Rd', location: 'Chennai', pincode: '600001', stateCode: '33' };
const buyer = { gstin: '33XYZAB6789K1Z2', legalName: 'BuildCo', posStateCode: '33', address1: 'Site 1', location: 'Chennai', pincode: '600002', stateCode: '33' };
const header = {
  docNo: 'INV-001', docDate: '2026-08-01', taxable: 250000, cgst: 22500, sgst: 22500, igst: 0, cess: 0, roundOff: 0,
  total: 295000, distanceKm: 350, transportMode: 'road', vehicleNo: 'TN01AB1234', transporterName: 'Mix Nova Transport',
};
const lines = [
  { slNo: 1, hsn: '38245010', qty: 50, unit: 'CUM', unitPrice: 5000, taxable: 250000, gstRate: 18, cgst: 22500, sgst: 22500, igst: 0, cess: 0, total: 295000 },
];

test('buildIrnRequest omits EwbDtls by default', () => {
  const req = buildIrnRequest(header, lines, seller, buyer);
  assert.ok(!('EwbDtls' in req), 'no e-way requested unless asked');
});

test('buildIrnRequest embeds EwbDtls (road Part B) when includeEwb is set', () => {
  const req = buildIrnRequest(header, lines, seller, buyer, { includeEwb: true });
  assert.ok(req.EwbDtls, 'EwbDtls present');
  assert.equal(req.EwbDtls.TransMode, '1'); // road
  assert.equal(req.EwbDtls.Distance, 350);
  assert.equal(req.EwbDtls.VehNo, 'TN01AB1234');
  assert.equal(req.EwbDtls.VehType, 'R');
  assert.equal(req.EwbDtls.TransName, 'Mix Nova Transport');
  const wire = JSON.parse(JSON.stringify(req.EwbDtls));
  assert.ok(!('TransDocNo' in wire), 'road move carries no transport document');
});

test('EwbDtls for rail carries the transport doc, not a vehicle number', () => {
  const rail = { ...header, transportMode: 'rail', vehicleNo: null, transDocNo: 'RR-77', transDocDate: '2026-08-01' };
  const req = buildIrnRequest(rail, lines, seller, buyer, { includeEwb: true, vehicleType: 'O' });
  assert.equal(req.EwbDtls.TransMode, '2');
  assert.equal(req.EwbDtls.TransDocNo, 'RR-77');
  assert.equal(req.EwbDtls.TransDocDt, '01/08/2026');
  assert.equal(req.EwbDtls.VehType, 'O');
  assert.ok(!('VehNo' in JSON.parse(JSON.stringify(req.EwbDtls))));
});

test('mapIrnData reads the e-way bill back when the IRP returns it', () => {
  const withEwb = mapIrnData({ Irn: 'a'.repeat(64), AckNo: '112', AckDt: '2026-08-01', SignedQRCode: 'QR', EwbNo: '123456789012', EwbDt: '2026-08-01', EwbValidTill: '2026-08-03' });
  assert.equal(withEwb.ewayBillNo, '123456789012');
  assert.equal(withEwb.ewayBillDate, '2026-08-01');
  assert.equal(withEwb.validUpto, '2026-08-03');

  const irnOnly = mapIrnData({ Irn: 'b'.repeat(64), AckNo: '113', AckDt: '2026-08-01', SignedQRCode: 'QR' });
  assert.equal(irnOnly.ewayBillNo, undefined, 'no e-way fields when the portal did not return one');
});

test('fake provider returns the e-way in the IRN call only when EwbDtls is sent', async () => {
  const p = new FakeGstProvider();
  const s = await p.authenticate('tenant-1', seller.gstin);

  const both = await p.generateIrn(s, buildIrnRequest(header, lines, seller, buyer, { includeEwb: true }));
  assert.equal(both.irn.length, 64);
  assert.equal(both.ewayBillNo.length, 12, 'e-way returned alongside the IRN');
  assert.ok(both.validUpto);

  const irnOnly = await p.generateIrn(s, buildIrnRequest(header, lines, seller, buyer));
  assert.equal(irnOnly.ewayBillNo, undefined, 'no e-way when EwbDtls was not included');
});
