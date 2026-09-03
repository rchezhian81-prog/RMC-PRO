/**
 * End-to-end Purchase / AP-lite integration test (Plan D2).
 *
 * Drives the real API through the procurement cycle and asserts each stage:
 *   supplier → purchase order (issue) → goods receipt (post → STOCK INCREASES)
 *   → vendor bill (3-way matched) → approve → vendor payment (bill settled).
 *
 * The headline assertion is that posting the GRN increases stock via the shared
 * ledger (DoD: "GRN posts to stock").
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD,
 * TEST_MATERIAL_ID, TEST_PLANT_ID. The `purchase` module is enabled for the
 * pilot tenant by the orchestrator before this runs.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const MATERIAL_ID = process.env.TEST_MATERIAL_ID;
const PLANT_ID = process.env.TEST_PLANT_ID;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

let TOKEN = '';
async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}
// A POST that reports success/failure instead of throwing — for firing two at once.
async function rawPost(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json().catch(() => null);
  return res.ok && data?.success === true;
}

if (!LOGIN || !PASSWORD || !MATERIAL_ID) {
  console.log('(skipping purchase-cycle — LOGIN/RMC_PASSWORD/TEST_MATERIAL_ID not set)');
  process.exit(0);
}

console.log('=== purchase cycle (PO → GRN → bill → payment) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

// Current stock for the material (from the valuation report) before receiving.
const materials = await api('GET', '/materials');
const material = materials.find((mt) => mt.id === MATERIAL_ID) ?? materials[0];
const label = material.materialName;
const stockOf = async () => {
  const { rows } = await api('GET', '/inventory-reports/valuation');
  const row = rows.find((r) => r.material === label);
  return row ? Number(row.currentQuantity) : 0;
};
const before = await stockOf();

// ---- A. Supplier ----
const supplier = await api('POST', '/suppliers', {
  supplierCode: `SUP-${Date.now().toString().slice(-6)}`, supplierName: 'Test Cement Co', state: 'Tamil Nadu',
});
ok('supplier created', !!supplier.id);

// ---- B. Purchase order ----
const QTY = 10, RATE = 500;
let po = await api('POST', '/purchase-orders', {
  supplierId: supplier.id, plantId: PLANT_ID, orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, quantity: QTY, rate: RATE, gstRate: 18 }],
});
ok('PO created with a line', po.items.length === 1);
ok('PO total = taxable + GST (5000 + 900)', near(po.totalAmount, 5900));
po = await api('POST', `/purchase-orders/${po.id}/issue`);
ok('PO issued', po.status === 'issued');
const poItemId = po.items[0].id;

// ---- C. Goods receipt (multi-line GRN) → posts to stock ----
let grn = await api('POST', '/goods-receipts', {
  purchaseOrderId: po.id, plantId: PLANT_ID, receiptDate: new Date().toISOString().slice(0, 10),
  lines: [{ purchaseOrderItemId: poItemId, materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, receivedQuantity: QTY, acceptedQuantity: QTY, rate: RATE }],
});
ok('GRN created (draft)', grn.status === 'draft');
grn = await api('POST', `/goods-receipts/${grn.id}/post`);
ok('GRN posted', grn.status === 'posted');

const after = await stockOf();
ok(`GRN increased stock by ${QTY} (${before} → ${after})`, near(after, before + QTY));

po = await api('GET', `/purchase-orders/${po.id}`);
ok('PO now fully received', po.status === 'received');
ok('PO line received qty rolled up', near(po.items[0].receivedQuantity, QTY));

// A5 — a GRN that would receive far more than the PO ordered is rejected
// (PO already fully received; another full QTY would be 2× the order).
let overReceiveBlocked = false;
try {
  await api('POST', '/goods-receipts', {
    purchaseOrderId: po.id, plantId: PLANT_ID, receiptDate: new Date().toISOString().slice(0, 10),
    lines: [{ purchaseOrderItemId: poItemId, materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, receivedQuantity: QTY, acceptedQuantity: QTY, rate: RATE }],
  });
} catch {
  overReceiveBlocked = true;
}
ok('GRN over-receiving beyond the PO is blocked', overReceiveBlocked);

// ---- C2. A row lock serializes concurrent posts (Tier-A A1/A2): only one wins,
// stock moves exactly once. Uses an ad-hoc GRN (no PO) so the PO-line lock path is
// skipped and the GRN-row lock is the only thing standing between a double-submit
// and doubled stock.
const DBL = 4;
const adhocGrn = await api('POST', '/goods-receipts', {
  plantId: PLANT_ID, receiptDate: new Date().toISOString().slice(0, 10),
  lines: [{ materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, receivedQuantity: DBL, acceptedQuantity: DBL, rate: RATE }],
});
ok('ad-hoc GRN created (no PO)', adhocGrn.status === 'draft');
const grnBefore = await stockOf();
const grnPosts = await Promise.all([rawPost(`/goods-receipts/${adhocGrn.id}/post`), rawPost(`/goods-receipts/${adhocGrn.id}/post`)]);
ok('exactly one of two concurrent GRN posts succeeds', grnPosts.filter(Boolean).length === 1);
ok(`concurrent GRN double-post moved stock by exactly ${DBL} once`, near(await stockOf(), grnBefore + DBL));

// Material inward post has the same guard.
const inw = await api('POST', '/material-inwards', {
  plantId: PLANT_ID, materialId: MATERIAL_ID, materialLabel: label, uom: material.uom,
  quantityReceived: DBL, quantityAccepted: DBL, rate: RATE,
});
ok('material inward created (draft)', inw.status === 'draft');
const inwBefore = await stockOf();
const inwPosts = await Promise.all([rawPost(`/material-inwards/${inw.id}/post`), rawPost(`/material-inwards/${inw.id}/post`)]);
ok('exactly one of two concurrent inward posts succeeds', inwPosts.filter(Boolean).length === 1);
ok(`concurrent inward double-post moved stock by exactly ${DBL} once`, near(await stockOf(), inwBefore + DBL));

// ---- D. Vendor bill (3-way matched) ----
let bill = await api('POST', '/vendor-bills', {
  supplierId: supplier.id, purchaseOrderId: po.id, goodsReceiptId: grn.id,
  supplierBillNo: 'VINV-001', billDate: new Date().toISOString().slice(0, 10),
});
ok('bill created from GRN with one line', bill.items.length === 1);
ok('bill total matches PO (5900)', near(bill.totalAmount, 5900));
ok('3-way match is matched', bill.matchStatus === 'matched');

// Tier-3B: a bill for a DIFFERENT supplier cannot reference this supplier's GRN.
const supplier2 = await api('POST', '/suppliers', {
  supplierCode: `SUP2-${Date.now().toString().slice(-6)}`, supplierName: 'Other Vendor Co', state: 'Tamil Nadu',
});
let crossSupplierBlocked = false;
try {
  await api('POST', '/vendor-bills', {
    supplierId: supplier2.id, goodsReceiptId: grn.id,
    supplierBillNo: 'X-CROSS', billDate: new Date().toISOString().slice(0, 10),
  });
} catch { crossSupplierBlocked = true; }
ok('a bill for a different supplier cannot reference this GRN', crossSupplierBlocked);
bill = await api('POST', `/vendor-bills/${bill.id}/approve`);
ok('bill approved', bill.status === 'approved');
ok('bill outstanding = total before payment', near(bill.outstandingAmount, 5900));

// ---- E. Vendor payment (settles the bill) ----
const payment = await api('POST', '/vendor-payments', {
  supplierId: supplier.id, amount: 5900, paymentMode: 'neft', bankReference: 'UTR-TEST',
  allocations: [{ billId: bill.id, amount: 5900 }],
});
ok('payment records the allocation', near(payment.allocatedAmount, 5900));
ok('payment fully allocated (nothing left)', near(payment.unallocatedAmount, 0));

bill = await api('GET', `/vendor-bills/${bill.id}`);
ok('bill is now paid', bill.paymentStatus === 'paid');
ok('bill outstanding is zero', near(bill.outstandingAmount, 0));

// ---- E2. Reverse the payment (#9): the bill's outstanding is restored. ----
const reversed = await api('POST', `/vendor-payments/${payment.id}/reverse`, { reason: 'wrong bill' });
ok('the payment is reversed', reversed.status === 'reversed');
bill = await api('GET', `/vendor-bills/${bill.id}`);
ok('the bill outstanding is restored after reversal', near(bill.outstandingAmount, 5900));
ok('the bill is unpaid again after reversal', bill.paymentStatus === 'unpaid');

// ---- F. Duplicate-invoice guard (#6) ----
let dupBlocked = false;
try {
  await api('POST', '/vendor-bills', {
    supplierId: supplier.id, purchaseOrderId: po.id, supplierBillNo: 'VINV-001',
    lines: [{ purchaseOrderItemId: poItemId, materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, quantity: 1, rate: RATE }],
  });
} catch { dupBlocked = true; }
ok('a duplicate supplier invoice number is rejected', dupBlocked);

// ---- G. Double-billing guard (#7): the PO line is fully billed, so a second
//         bill against it fails the 3-way match and cannot be approved. ----
const second = await api('POST', '/vendor-bills', {
  supplierId: supplier.id, purchaseOrderId: po.id, goodsReceiptId: grn.id, supplierBillNo: 'VINV-002',
});
ok('a second bill for the already-billed line fails the match', second.matchStatus === 'over_tolerance');
let secondApproveBlocked = false;
try { await api('POST', `/vendor-bills/${second.id}/approve`); } catch { secondApproveBlocked = true; }
ok('the double-billing bill cannot be approved without override', secondApproveBlocked);

// ---- H. Over-receipt re-check at POST (#8): two full-qty drafts both pass
//         create (received still 0); once the first posts, the second is blocked
//         at post even though it passed the create-time cap. ----
let po2 = await api('POST', '/purchase-orders', {
  supplierId: supplier.id, plantId: PLANT_ID, orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, quantity: QTY, rate: RATE, gstRate: 18 }],
});
po2 = await api('POST', `/purchase-orders/${po2.id}/issue`);
const po2ItemId = po2.items[0].id;
const grnLine = { purchaseOrderItemId: po2ItemId, materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, receivedQuantity: QTY, acceptedQuantity: QTY, rate: RATE };
const g1 = await api('POST', '/goods-receipts', { purchaseOrderId: po2.id, plantId: PLANT_ID, lines: [grnLine] });
const g2 = await api('POST', '/goods-receipts', { purchaseOrderId: po2.id, plantId: PLANT_ID, lines: [grnLine] });
ok('two full-qty drafts both pass the create-time cap', !!g1.id && !!g2.id);
await api('POST', `/goods-receipts/${g1.id}/post`);
let secondPostBlocked = false;
try { await api('POST', `/goods-receipts/${g2.id}/post`); } catch { secondPostBlocked = true; }
ok('the second GRN is blocked at POST by the over-receipt re-check', secondPostBlocked);

// ---- I. ITC eligibility (#11): a blocked-credit (itcEligible:false) bill is
//         excluded from the ITC register; an eligible one is included. ----
const eligibleBill = await api('POST', '/vendor-bills', {
  supplierId: supplier.id, supplierBillNo: 'VINV-ELIG',
  lines: [{ materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, quantity: 1, rate: 100, gstRate: 18 }],
});
await api('POST', `/vendor-bills/${eligibleBill.id}/approve`);
const blockedBill = await api('POST', '/vendor-bills', {
  supplierId: supplier.id, supplierBillNo: 'VINV-BLOCK', itcEligible: false,
  lines: [{ materialId: MATERIAL_ID, materialLabel: label, uom: material.uom, quantity: 1, rate: 200, gstRate: 18 }],
});
ok('a bill can be flagged ITC-ineligible', blockedBill.itcEligible === false);
await api('POST', `/vendor-bills/${blockedBill.id}/approve`);
const itc = await api('GET', '/purchase-reports/itc-register');
const itcNums = (itc.rows ?? []).map((r) => r.billNo);
ok('an eligible bill appears in the ITC register', itcNums.includes(eligibleBill.billNo));
ok('a blocked-credit bill is excluded from the ITC register', !itcNums.includes(blockedBill.billNo));

console.log(`\nPURCHASE CYCLE TEST: ${pass} passed ✓`);
process.exit(0);
