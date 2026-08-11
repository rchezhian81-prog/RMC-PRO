/**
 * Full e-way bill (EWB) Part A/B mapping + pre-flight tests — the NIC EWB schema
 * a live GENEWAYBILL call requires, beyond the essentials in gst-payload.test.mjs.
 *
 * Pins runbook 02 §2–§3: itemList (HSN + rates), the value breakdown, numeric
 * pincodes, Part B by transport mode (road vehicle vs rail/air/ship transport
 * doc), configurable docType/subSupply/vehicleType, and the pre-flight gates
 * (threshold, HSN, non-road transport doc, intra-state exemption).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEwbRequest, validateEwbPreflight } from '../../dist/compliance/gst-payload.util.js';

const seller = { gstin: '33ABCDE1234F1Z5', legalName: 'Mix Nova RMC', address1: 'Plant Rd', location: 'Chennai', pincode: '600001', stateCode: '33' };
const buyer = { gstin: '33XYZAB6789K1Z2', legalName: 'BuildCo', posStateCode: '33', address1: 'Site 1', location: 'Chennai', pincode: '600002', stateCode: '33' };
const header = {
  docNo: 'INV-001', docDate: '2026-08-01', taxable: 250000, cgst: 22500, sgst: 22500, igst: 0, cess: 0, roundOff: 0,
  total: 295000, distanceKm: 350, transportMode: 'road', vehicleNo: 'TN01AB1234',
};
const lines = [
  { slNo: 1, hsn: '38245010', qty: 50, unit: 'CUM', unitPrice: 5000, taxable: 250000, gstRate: 18, cgst: 22500, sgst: 22500, igst: 0, cess: 0, total: 295000, description: 'M25 concrete' },
];

test('Part A carries supply/doc/party/value details', () => {
  const req = buildEwbRequest(header, lines, seller, buyer);
  assert.equal(req.supplyType, 'O');
  assert.equal(req.subSupplyType, '1');
  assert.equal(req.docType, 'INV');
  assert.equal(req.docNo, 'INV-001');
  assert.equal(req.docDate, '01/08/2026');
  assert.equal(req.fromGstin, '33ABCDE1234F1Z5');
  assert.equal(req.toGstin, '33XYZAB6789K1Z2');
  assert.equal(req.fromStateCode, '33');
  assert.equal(req.toStateCode, '33');
  assert.equal(req.transDistance, 350);
  assert.equal(req.totInvValue, 295000);
});

test('pincodes are numeric (NIC rejects a string pincode); missing → dropped', () => {
  const req = buildEwbRequest(header, lines, seller, buyer);
  assert.equal(req.fromPincode, 600001);
  assert.equal(req.toPincode, 600002);
  assert.equal(typeof req.fromPincode, 'number');
  const wire = JSON.parse(JSON.stringify(buildEwbRequest(header, lines, seller, { ...buyer, pincode: '' })));
  assert.ok(!('toPincode' in wire), 'a missing pincode is not sent as a bad value');
});

test('value breakdown reconciles to the invoice total', () => {
  const req = buildEwbRequest(header, lines, seller, buyer);
  assert.equal(req.totalValue, 250000); // assessable
  assert.equal(req.cgstValue, 22500);
  assert.equal(req.sgstValue, 22500);
  assert.equal(req.igstValue, 0);
  assert.equal(req.cessValue, 0);
  assert.equal(req.otherValue, 0);
  assert.equal(req.totalValue + req.cgstValue + req.sgstValue + req.igstValue + req.cessValue + req.otherValue, req.totInvValue);
});

test('itemList maps each line with a numeric HSN and split rates (intra-state)', () => {
  const it = buildEwbRequest(header, lines, seller, buyer).itemList[0];
  assert.equal(it.hsnCode, 38245010); // numeric
  assert.equal(typeof it.hsnCode, 'number');
  assert.equal(it.quantity, 50);
  assert.equal(it.qtyUnit, 'CUM');
  assert.equal(it.taxableAmount, 250000);
  assert.equal(it.cgstRate, 9);
  assert.equal(it.sgstRate, 9);
  assert.equal(it.igstRate, 0);
  assert.equal(it.cessRate, 0);
  assert.equal(it.productName, 'M25 concrete');
});

test('inter-state supply uses IGST rate/value only', () => {
  const interHeader = { ...header, taxable: 45000, cgst: 0, sgst: 0, igst: 8100, total: 53100 };
  const interLines = [{ ...lines[0], taxable: 45000, cgst: 0, sgst: 0, igst: 8100, total: 53100 }];
  const interBuyer = { ...buyer, gstin: '29XYZAB6789K1Z2', stateCode: '29', posStateCode: '29' };
  const req = buildEwbRequest(interHeader, interLines, seller, interBuyer);
  assert.equal(req.itemList[0].igstRate, 18);
  assert.equal(req.itemList[0].cgstRate, 0);
  assert.equal(req.itemList[0].sgstRate, 0);
  assert.equal(req.igstValue, 8100);
  assert.equal(req.cgstValue, 0);
});

test('Part B for road: mode 1, vehicle type R, vehicle number, no transport doc', () => {
  const req = buildEwbRequest(header, lines, seller, buyer);
  assert.equal(req.transMode, '1');
  assert.equal(req.vehicleType, 'R');
  assert.equal(req.vehicleNo, 'TN01AB1234');
  const wire = JSON.parse(JSON.stringify(req));
  assert.ok(!('transDocNo' in wire), 'road move carries no transport document');
});

test('Part B for rail: mode 2, transport doc no + date, no vehicle number', () => {
  const railHeader = { ...header, transportMode: 'rail', vehicleNo: null, transDocNo: 'RR-99881', transDocDate: '2026-08-01' };
  const req = buildEwbRequest(railHeader, lines, seller, buyer);
  assert.equal(req.transMode, '2');
  assert.equal(req.transDocNo, 'RR-99881');
  assert.equal(req.transDocDate, '01/08/2026');
  const wire = JSON.parse(JSON.stringify(req));
  assert.ok(!('vehicleNo' in wire), 'rail move carries no vehicle number');
});

test('options set docType (challan), sub-supply and vehicle type', () => {
  const req = buildEwbRequest(header, lines, seller, buyer, { docType: 'CHL', subSupplyType: '3', vehicleType: 'O' });
  assert.equal(req.docType, 'CHL');
  assert.equal(req.subSupplyType, '3');
  assert.equal(req.vehicleType, 'O');
});

test('validity is 1 day per 200 km (min 1)', () => {
  assert.equal(buildEwbRequest(header, lines, seller, buyer).validityDays, 2); // ceil(350/200)
  assert.equal(buildEwbRequest({ ...header, distanceKm: 200 }, lines, seller, buyer).validityDays, 1);
});

// ── pre-flight ────────────────────────────────────────────────────────────────

test('pre-flight passes a clean road dispatch', () => {
  assert.deepEqual(validateEwbPreflight(header, lines, seller, buyer), { ok: true });
});

test('pre-flight rejects value at/below the threshold (state-configurable)', () => {
  assert.equal(validateEwbPreflight({ ...header, total: 40000 }, lines, seller, buyer).ok, false);
  // a state that sets ₹1,00,000 → a ₹95,000 consignment is below it.
  assert.equal(validateEwbPreflight({ ...header, total: 95000 }, lines, seller, buyer, { thresholdValue: 100000 }).ok, false);
});

test('pre-flight rejects missing distance, missing HSN, and missing destination state', () => {
  assert.equal(validateEwbPreflight({ ...header, distanceKm: 0 }, lines, seller, buyer).ok, false);
  assert.match(validateEwbPreflight(header, [{ ...lines[0], hsn: null }], seller, buyer).errors.join(' '), /HSN/);
  assert.match(validateEwbPreflight(header, lines, seller, { ...buyer, stateCode: '' }).errors.join(' '), /state code/);
});

test('pre-flight: road needs a vehicle or transporter; a transporter id suffices', () => {
  assert.equal(validateEwbPreflight({ ...header, vehicleNo: null }, lines, seller, buyer).ok, false);
  assert.equal(validateEwbPreflight({ ...header, vehicleNo: null, transporterId: 'TRANS01' }, lines, seller, buyer).ok, true);
});

test('pre-flight: rail/air/ship need a transport document number and date', () => {
  const rail = { ...header, transportMode: 'rail', vehicleNo: null };
  assert.match(validateEwbPreflight(rail, lines, seller, buyer).errors.join(' '), /transport document/);
  assert.equal(validateEwbPreflight({ ...rail, transDocNo: 'RR1', transDocDate: '2026-08-01' }, lines, seller, buyer).ok, true);
});

test('pre-flight: intra-state short-haul exemption (config) skips the e-way', () => {
  const near = { ...header, distanceKm: 20 }; // same-state (33→33)
  // Without config the move is still required (fails on nothing else).
  assert.equal(validateEwbPreflight(near, lines, seller, buyer).ok, true);
  // With a 50 km intra-state exemption, a 20 km same-state move is not required.
  assert.equal(validateEwbPreflight(near, lines, seller, buyer, { intraStateExemptBelowKm: 50 }).ok, false);
  // An inter-state 20 km move is NOT exempt.
  const interBuyer = { ...buyer, stateCode: '29' };
  assert.equal(validateEwbPreflight(near, lines, seller, interBuyer, { intraStateExemptBelowKm: 50 }).ok, true);
});
