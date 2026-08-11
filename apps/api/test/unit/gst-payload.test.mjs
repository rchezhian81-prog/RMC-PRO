/**
 * Unit tests for the pure GST payload builders + pre-flight validators (no I/O).
 * These are the deterministic transforms that turn an assembled invoice into the
 * INV-01 / EWB request shapes, and reject master-data problems before any portal
 * call. The fake provider is used to prove the shapes round-trip a "transmission".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGstin, stateCodeOf, ewayValidityDays, toPortalDate,
  validateIrnPreflight, validateEwbPreflight, buildIrnRequest, buildEwbRequest,
} from '../../dist/compliance/gst-payload.util.js';
import { FakeGstProvider } from '../../dist/compliance/fake.provider.js';
import { DisabledGstProvider } from '../../dist/compliance/disabled.provider.js';

const seller = {
  gstin: '33ABCDE1234F1Z5', legalName: 'Mix Nova RMC', address1: 'Plant Rd', location: 'Chennai',
  pincode: '600001', stateCode: '33',
};
const buyer = {
  gstin: '33XYZAB6789K1Z2', legalName: 'BuildCo', posStateCode: '33', address1: 'Site 1',
  location: 'Chennai', pincode: '600002', stateCode: '33',
};
const header = {
  docNo: 'INV-001', docDate: '2026-08-01', taxable: 250000, cgst: 22500, sgst: 22500,
  igst: 0, cess: 0, roundOff: 0, total: 295000, distanceKm: 350, transportMode: 'road', vehicleNo: 'TN01AB1234',
};
const lines = [
  { slNo: 1, hsn: '38245010', qty: 50, unit: 'CUM', unitPrice: 5000, taxable: 250000, gstRate: 18, cgst: 22500, sgst: 22500, igst: 0, cess: 0, total: 295000 },
];

test('GSTIN + state-code + validity + date helpers', () => {
  assert.equal(isGstin('33ABCDE1234F1Z5'), true);
  assert.equal(isGstin('nope'), false);
  assert.equal(stateCodeOf('33ABCDE1234F1Z5'), '33');
  assert.equal(ewayValidityDays(350), 2); // ceil(350/200)
  assert.equal(ewayValidityDays(200), 1);
  assert.equal(ewayValidityDays(0), 1);
  assert.equal(toPortalDate('2026-08-01'), '01/08/2026');
});

test('IRN pre-flight passes a clean invoice', () => {
  assert.deepEqual(validateIrnPreflight(header, lines, seller, buyer), { ok: true });
});

test('IRN pre-flight rejects missing HSN, bad GSTIN, and non-reconciling totals', () => {
  const badLines = [{ ...lines[0], hsn: null }];
  const r1 = validateIrnPreflight(header, badLines, seller, buyer);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(' '), /HSN/);

  const r2 = validateIrnPreflight(header, lines, { ...seller, gstin: 'BAD' }, buyer);
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join(' '), /seller GSTIN/);

  const r3 = validateIrnPreflight({ ...header, total: 999999 }, lines, seller, buyer);
  assert.equal(r3.ok, false);
  assert.match(r3.errors.join(' '), /reconcile/);
});

test('e-way pre-flight enforces threshold, distance, and Part-B for road', () => {
  assert.deepEqual(validateEwbPreflight(header, seller, buyer), { ok: true });
  // at/below threshold
  assert.equal(validateEwbPreflight({ ...header, total: 40000 }, seller, buyer).ok, false);
  // no distance
  assert.equal(validateEwbPreflight({ ...header, distanceKm: 0 }, seller, buyer).ok, false);
  // road with no vehicle and no transporter
  assert.equal(validateEwbPreflight({ ...header, vehicleNo: null }, seller, buyer).ok, false);
});

test('buildIrnRequest emits INV-01 essentials', () => {
  const req = buildIrnRequest(header, lines, seller, buyer);
  assert.equal(req.Version, '1.1');
  assert.equal(req.DocDtls.No, 'INV-001');
  assert.equal(req.DocDtls.Dt, '01/08/2026');
  assert.equal(req.SellerDtls.Gstin, '33ABCDE1234F1Z5');
  assert.equal(req.BuyerDtls.Pos, '33');
  assert.equal(req.ItemList[0].HsnCd, '38245010');
  assert.equal(req.ValDtls.TotInvVal, 295000);
});

test('buildEwbRequest carries Part-A/B + computed validity', () => {
  const req = buildEwbRequest(header, seller, buyer);
  assert.equal(req.docNo, 'INV-001');
  assert.equal(req.transMode, '1'); // road
  assert.equal(req.vehicleNo, 'TN01AB1234');
  assert.equal(req.validityDays, 2);
  assert.equal(req.totInvValue, 295000);
});

test('fake provider round-trips a deterministic IRN + e-way (and reconciles a duplicate)', async () => {
  const p = new FakeGstProvider();
  const s = await p.authenticate('tenant-1', seller.gstin);
  const irn = await p.generateIrn(s, buildIrnRequest(header, lines, seller, buyer));
  assert.equal(irn.irn.length, 64); // SHA-256 hex, like a real IRN
  assert.equal(irn.irn, (await p.generateIrn(s, buildIrnRequest(header, lines, seller, buyer))).irn); // deterministic
  const ewb = await p.generateEwayBill(s, buildEwbRequest(header, seller, buyer));
  assert.equal(ewb.ewayBillNo.length, 12);

  const dup = new FakeGstProvider({ duplicate: true });
  await assert.rejects(
    () => dup.generateIrn(s, buildIrnRequest(header, lines, seller, buyer)),
    (e) => e.code === 'DUPLICATE_IRN' && typeof e.detail.irn === 'string',
  );
});

test('disabled provider is off and throws if invoked', async () => {
  const p = new DisabledGstProvider();
  assert.equal(p.isConfigured(), false);
  await assert.rejects(() => p.authenticate('tenant-1', '33ABCDE1234F1Z5'), (e) => e.code === 'PROVIDER_DISABLED');
});
