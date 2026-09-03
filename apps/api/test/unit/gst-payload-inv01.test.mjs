/**
 * Full INV-01 (e-invoice) payload mapping tests — the complete NIC schema the
 * live IRP call requires, beyond the "essentials" covered in gst-payload.test.mjs.
 *
 * Pins the mapping documented in INTEGRATION-RUNBOOK-01 §3 so a change that would
 * make the portal reject a real invoice is caught here, fast, without a live GSP:
 * per-item IsServc / CesRt / gross TotAmt vs assessable AssAmt / Discount,
 * TranDtls.IgstOnIntra, DocDtls.Typ, numeric Pin, and the intrastate/interstate/
 * URP/cess variants.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIrnRequest, pinNum } from '../../dist/compliance/gst-payload.util.js';

const seller = {
  gstin: '33ABCDE1234F1Z5', legalName: 'Mix Nova RMC', tradeName: 'MixNova',
  address1: 'Plant Rd', address2: 'Zone 2', location: 'Chennai', pincode: '600001', stateCode: '33',
};
const buyer = {
  gstin: '33XYZAB6789K1Z2', legalName: 'BuildCo', posStateCode: '33',
  address1: 'Site 1', location: 'Chennai', pincode: '600002', stateCode: '33',
};
// The UAT ₹2,95,000 intra-state invoice (50 m³ × ₹5,000 @ 18%).
const header = {
  docNo: 'INV-001', docDate: '2026-08-01', taxable: 250000, cgst: 22500, sgst: 22500,
  igst: 0, cess: 0, roundOff: 0, total: 295000,
};
const lines = [
  { slNo: 1, hsn: '38245010', qty: 50, unit: 'CUM', unitPrice: 5000, taxable: 250000, gstRate: 18, cgst: 22500, sgst: 22500, igst: 0, cess: 0, total: 295000 },
];

test('pinNum returns a 6-digit number, or undefined for anything malformed', () => {
  assert.equal(pinNum('600001'), 600001);
  assert.equal(typeof pinNum('600001'), 'number');
  assert.equal(pinNum(''), undefined);
  assert.equal(pinNum('12345'), undefined);
  assert.equal(pinNum('ABCDEF'), undefined);
  assert.equal(pinNum(null), undefined);
});

test('TranDtls + DocDtls carry the transaction and document group', () => {
  const req = buildIrnRequest(header, lines, seller, buyer);
  assert.deepEqual(req.TranDtls, { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' });
  assert.equal(req.DocDtls.Typ, 'INV');
  assert.equal(req.DocDtls.No, 'INV-001');
  assert.equal(req.DocDtls.Dt, '01/08/2026'); // dd/mm/yyyy
});

test('reverse-charge, IGST-on-intra and credit-note flags map through', () => {
  const req = buildIrnRequest(
    { ...header, reverseCharge: true, igstOnIntra: true, docType: 'CRN' },
    lines, seller, buyer,
  );
  assert.equal(req.TranDtls.RegRev, 'Y');
  assert.equal(req.TranDtls.IgstOnIntra, 'Y');
  assert.equal(req.DocDtls.Typ, 'CRN');
});

test('Seller/Buyer Pin is a NUMBER (NIC rejects a string pincode)', () => {
  const req = buildIrnRequest(header, lines, seller, buyer);
  assert.equal(req.SellerDtls.Pin, 600001);
  assert.equal(typeof req.SellerDtls.Pin, 'number');
  assert.equal(req.BuyerDtls.Pin, 600002);
  assert.equal(req.SellerDtls.Stcd, '33');
  assert.equal(req.BuyerDtls.Pos, '33');
});

test('a missing buyer pincode is dropped from the JSON, not sent as a bad value', () => {
  const req = buildIrnRequest(header, lines, seller, { ...buyer, pincode: '' });
  const wire = JSON.parse(JSON.stringify(req));
  assert.equal(wire.BuyerDtls.Pin, undefined);
  assert.ok(!('Pin' in wire.BuyerDtls), 'Pin key absent on the wire');
});

test('a buyer with no GSTIN is sent as URP', () => {
  const req = buildIrnRequest(header, lines, seller, { ...buyer, gstin: null });
  assert.equal(req.BuyerDtls.Gstin, 'URP');
});

test('ItemList entry carries the full NIC-mandatory item shape', () => {
  const req = buildIrnRequest(header, lines, seller, buyer);
  const it = req.ItemList[0];
  assert.equal(it.SlNo, '1'); // string
  assert.equal(it.IsServc, 'N'); // concrete is goods
  assert.equal(it.HsnCd, '38245010');
  assert.equal(it.Qty, 50);
  assert.equal(it.Unit, 'CBM'); // 'CUM'/'m3' map to the NIC UQC for cubic metres
  assert.equal(it.UnitPrice, 5000);
  assert.equal(it.TotAmt, 250000); // gross = qty × unitPrice
  assert.equal(it.Discount, 0);
  assert.equal(it.AssAmt, 250000); // assessable
  assert.equal(it.GstRt, 18);
  assert.equal(it.CgstAmt, 22500);
  assert.equal(it.SgstAmt, 22500);
  assert.equal(it.IgstAmt, 0);
  assert.equal(it.CesRt, 0);
  assert.equal(it.CesAmt, 0);
  assert.equal(it.TotItemVal, 295000);
});

test('per-item value reconciles: AssAmt + all taxes + cess = TotItemVal', () => {
  const it = buildIrnRequest(header, lines, seller, buyer).ItemList[0];
  const sum = it.AssAmt + it.CgstAmt + it.SgstAmt + it.IgstAmt + it.CesAmt;
  assert.equal(sum, it.TotItemVal);
});

test('TotAmt (gross) is distinct from AssAmt when a line is discounted', () => {
  // 10 × ₹100 = ₹1,000 gross, but only ₹900 assessable (a ₹100 discount).
  const discounted = [
    { slNo: 1, hsn: '38245010', qty: 10, unit: 'NOS', unitPrice: 100, taxable: 900, gstRate: 18, cgst: 81, sgst: 81, igst: 0, cess: 0, total: 1062 },
  ];
  const it = buildIrnRequest({ ...header, taxable: 900, cgst: 81, sgst: 81, total: 1062 }, discounted, seller, buyer).ItemList[0];
  assert.equal(it.TotAmt, 1000); // gross
  assert.equal(it.AssAmt, 900); // assessable
});

test('IsServc is Y for a service line', () => {
  const svc = [{ ...lines[0], isService: true }];
  assert.equal(buildIrnRequest(header, svc, seller, buyer).ItemList[0].IsServc, 'Y');
});

test('cess rate is derived from cess ÷ assessable, or taken from the line when given', () => {
  const cessLine = [
    { slNo: 1, hsn: '24022090', qty: 10, unit: 'NOS', unitPrice: 100, taxable: 1000, gstRate: 18, cgst: 90, sgst: 90, igst: 0, cess: 120, total: 1300 },
  ];
  const h = { ...header, taxable: 1000, cgst: 90, sgst: 90, cess: 120, total: 1300 };
  const derived = buildIrnRequest(h, cessLine, seller, buyer).ItemList[0];
  assert.equal(derived.CesRt, 12); // 120 / 1000 × 100
  assert.equal(derived.CesAmt, 120);

  const explicit = buildIrnRequest(h, [{ ...cessLine[0], cessRate: 15 }], seller, buyer).ItemList[0];
  assert.equal(explicit.CesRt, 15); // line-supplied rate wins over the derived one
});

test('inter-state supply uses IGST only (CGST/SGST zero) in items and ValDtls', () => {
  const interHeader = { docNo: 'INV-002', docDate: '2026-08-02', taxable: 45000, cgst: 0, sgst: 0, igst: 8100, cess: 0, roundOff: 0, total: 53100 };
  const interLines = [
    { slNo: 1, hsn: '38245010', qty: 10, unit: 'CUM', unitPrice: 4500, taxable: 45000, gstRate: 18, cgst: 0, sgst: 0, igst: 8100, cess: 0, total: 53100 },
  ];
  const interBuyer = { ...buyer, gstin: '29XYZAB6789K1Z2', posStateCode: '29', stateCode: '29' };
  const req = buildIrnRequest(interHeader, interLines, seller, interBuyer);
  const it = req.ItemList[0];
  assert.equal(it.IgstAmt, 8100);
  assert.equal(it.CgstAmt, 0);
  assert.equal(it.SgstAmt, 0);
  assert.equal(req.ValDtls.IgstVal, 8100);
  assert.equal(req.ValDtls.CgstVal, 0);
  assert.equal(req.ValDtls.SgstVal, 0);
  assert.equal(req.BuyerDtls.Pos, '29');
});

test('ValDtls totals equal the header and reconcile to TotInvVal', () => {
  const v = buildIrnRequest(header, lines, seller, buyer).ValDtls;
  assert.deepEqual(v, {
    AssVal: 250000, CgstVal: 22500, SgstVal: 22500, IgstVal: 0, CesVal: 0, RndOffAmt: 0, TotInvVal: 295000,
  });
  assert.equal(v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + v.CesVal + v.RndOffAmt, v.TotInvVal);
});
