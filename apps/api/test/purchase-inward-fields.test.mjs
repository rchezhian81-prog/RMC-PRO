/**
 * Purchase orders and material inwards as the buyer and the gate key them:
 * an order with a line discount, a line keyed in bags for a tonne material,
 * a backdated order date and a whole-rupee round-off; the vendor bill raised
 * from that order carrying the discount and round-off; a truck with two
 * materials received as one batch (one numbered inward per line, a shared
 * bill number, a converted unit) and posted with "posted by"; the supplier's
 * invoice attached, streamed back, removed, and refused when too large or of
 * the wrong type.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_PLANT_ID.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const PLANT_ID = process.env.TEST_PLANT_ID;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

let TOKEN = '';
async function raw(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function api(method, path, body) {
  const r = await raw(method, path, body);
  if (r.status >= 400 || !r.body?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}

if (!LOGIN || !PASSWORD) {
  console.log('(skipping purchase-inward-fields — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== purchase discount, round-off and units; multi-line inward with bill, attachment and posted-by ===');

const login = await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD });
TOKEN = login.access_token;
const SFX = Date.now().toString(36).slice(-6).toUpperCase();
const BAG = `BAG${SFX}`;

// ---- fixtures: a tonne material, a bag conversion, a supplier ----
const material = await api('POST', '/materials', { materialCode: `PIF-${SFX}`, materialName: `Discount cement ${SFX}`, uom: 'MT', standardRate: 1000 });
// 1 MT = 20 bags (of 50 kg).
await api('POST', '/uom-conversions', { fromUom: 'MT', toUom: BAG, factor: 20 });
const supplier = await api('POST', '/suppliers', { supplierCode: `PIF-${SFX}`, supplierName: `Discount Traders ${SFX}`, state: 'Tamil Nadu' });

// ---- A. Purchase order: discount, converted unit, backdated date, round-off ----
const po = await api('POST', '/purchase-orders', {
  supplierId: supplier.id, plantId: PLANT_ID, orderDate: '2026-01-15',
  lines: [
    { materialId: material.id, quantity: 10, rate: 1000, discountPct: 10, gstRate: 18 },
    { materialId: material.id, enteredUom: BAG, enteredQuantity: 30, rate: 1234.56, gstRate: 5 },
  ],
});
ok('the order keeps the backdated order date', po.orderDate === '2026-01-15');
const [l1, l2] = po.items;
ok('line 1: taxable = qty × rate less 10% (9000)', near(l1.taxableAmount, 9000) && near(l1.discountPct, 10));
ok('line 1: tax on the discounted taxable (1620) and line total 10620', near(l1.taxAmount, 1620) && near(l1.lineTotal, 10620));
ok('line 2: 30 bags converted to 1.5 MT in the material unit', near(l2.quantity, 1.5) && l2.uom === 'MT');
ok('line 2: the keyed unit and figure are stored as entered', l2.enteredUom === BAG && near(l2.enteredQuantity, 30));
ok('line 2: value at the per-MT rate (1851.84 + 92.59)', near(l2.taxableAmount, 1851.84) && near(l2.taxAmount, 92.59));
ok('line 1 has no entered unit (keyed in the material unit)', l1.enteredUom === null && l1.enteredQuantity === null);
ok('PO taxable and tax are the line sums', near(po.taxableAmount, 10851.84) && near(po.taxAmount, 1712.59));
ok('PO round-off is the signed paise to the nearest rupee (−0.43)', near(po.roundOff, -0.43));
ok('PO grand total is a whole rupee (12564)', near(po.totalAmount, 12564));

const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const tooLate = await raw('POST', '/purchase-orders', { supplierId: supplier.id, orderDate: future, lines: [{ materialId: material.id, quantity: 1, rate: 10 }] });
ok('an order dated five days ahead is refused (400)', tooLate.status === 400);
const badDisc = await raw('POST', '/purchase-orders', { supplierId: supplier.id, lines: [{ materialId: material.id, quantity: 1, rate: 10, discountPct: 120 }] });
ok('a discount over 100% is refused (400)', badDisc.status === 400);
const noPath = await raw('POST', '/purchase-orders', { supplierId: supplier.id, lines: [{ materialId: material.id, enteredUom: 'DRUM', enteredQuantity: 3, rate: 10 }] });
ok('a unit with no conversion path is refused (400)', noPath.status === 400 && /No conversion from DRUM/.test(noPath.body?.error?.message ?? ''));
const defaulted = await api('POST', '/purchase-orders', { supplierId: supplier.id, lines: [{ materialId: material.id, quantity: 1, rate: 10 }] });
ok('an order without a date is dated today', /^\d{4}-\d{2}-\d{2}$/.test(defaulted.orderDate ?? ''));
await api('POST', `/purchase-orders/${defaulted.id}/cancel`);

// The printed order carries the discount column and the round-off line.
const pdfRes = await fetch(`${API_BASE}/purchase-orders/${po.id}/pdf`, { headers: { Authorization: `Bearer ${TOKEN}` } });
ok('the PO prints as a PDF', pdfRes.status === 200 && (pdfRes.headers.get('content-type') ?? '').includes('pdf'));

// ---- B. Goods receipt and the vendor bill from it: discount and round-off carried ----
await api('POST', `/purchase-orders/${po.id}/issue`);
let grn = await api('POST', '/goods-receipts', {
  purchaseOrderId: po.id, plantId: PLANT_ID,
  lines: [
    { purchaseOrderItemId: l1.id, materialId: material.id, uom: 'MT', receivedQuantity: 10, acceptedQuantity: 10, rate: 1000 },
    { purchaseOrderItemId: l2.id, materialId: material.id, uom: 'MT', receivedQuantity: 1.5, acceptedQuantity: 1.5, rate: 1234.56 },
  ],
});
grn = await api('POST', `/goods-receipts/${grn.id}/post`);
ok('the receipt against the order is posted', grn.status === 'posted');
const bill = await api('POST', '/vendor-bills', { supplierId: supplier.id, goodsReceiptId: grn.id, purchaseOrderId: po.id, supplierBillNo: `SB-${SFX}` });
const [b1, b2] = bill.items;
ok('the bill line inherits the PO line discount (10%) and its taxable (9000)', near(b1.discountPct, 10) && near(b1.taxableAmount, 9000));
ok('the bill line without a discount carries 0', near(b2.discountPct, 0) && near(b2.taxableAmount, 1851.84));
ok('the bill total is the whole rupee with the same round-off (12564, −0.43)', near(bill.totalAmount, 12564) && near(bill.roundOff, -0.43));
ok('the bill outstanding is the rounded total', near(bill.outstandingAmount, 12564));
ok('the bill matches the order and receipt', bill.matchStatus === 'matched');

// ---- C. Material inward batch: two lines, one truck, posted by ----
const countBefore = (await api('GET', '/material-inwards')).length;
const batch = await api('POST', '/material-inwards/batch', {
  plantId: PLANT_ID, supplierId: supplier.id, vehicleNo: `TN01${SFX}`, supplierChallanNo: `CH-${SFX}`, supplierBillNo: `SB-${SFX}`,
  lines: [
    { materialId: material.id, quantityReceived: 2, rate: 100 },
    { materialId: material.id, enteredUom: BAG, quantityReceived: 40, quantityAccepted: 20, rate: 1000 },
  ],
});
ok('the batch returns one inward per line', Array.isArray(batch) && batch.length === 2);
const [i1, i2] = batch;
ok('each inward has its own number', i1.inwardNo && i2.inwardNo && i1.inwardNo !== i2.inwardNo);
ok('the header is shared: supplier, truck, challan and bill number on both', [i1, i2].every((r) => r.supplierId === supplier.id && r.vehicleNo === `TN01${SFX}` && r.supplierChallanNo === `CH-${SFX}` && r.supplierBillNo === `SB-${SFX}`));
ok('line 2: 40 bags received = 2 MT, 20 bags accepted = 1 MT', near(i2.quantityReceived, 2) && near(i2.quantityAccepted, 1) && i2.uom === 'MT');
ok('line 2: the keyed unit and figure are kept', i2.enteredUom === BAG && near(i2.enteredQuantity, 40));
ok('line 2: value = accepted (MT) × rate (1000)', near(i2.amount, 1000));
ok('both are drafts with nothing posted yet', i1.status === 'draft' && i2.status === 'draft' && i1.postedByUserId === null);
ok('the batch rows carry the list fields and no attachment', i1.hasAttachment === false && i1.supplierName === supplier.supplierName && !('attachmentData' in i1));

const badBatch = await raw('POST', '/material-inwards/batch', {
  plantId: PLANT_ID, lines: [{ materialId: material.id, quantityReceived: 1, rate: 1 }, { materialId: material.id, enteredUom: 'DRUM', quantityReceived: 1, rate: 1 }],
});
ok('a batch with a bad line is refused as a whole (400)', badBatch.status === 400);
ok('…and nothing from it was written', (await api('GET', '/material-inwards')).length === countBefore + 2);
const emptyBatch = await raw('POST', '/material-inwards/batch', { plantId: PLANT_ID, lines: [] });
ok('a batch without lines is refused (400)', emptyBatch.status === 400);

const posted = await api('POST', `/material-inwards/${i1.id}/post`);
ok('posting records who posted it', posted.status === 'posted' && typeof posted.postedByUserId === 'string' && posted.postedByUserId.length > 0);
ok('the posted row names the person', posted.postedByName === 'CI Owner');
const listed = (await api('GET', '/material-inwards')).find((r) => r.id === i1.id);
ok('the list shows "posted by" and no attachment', listed?.postedByName === 'CI Owner' && listed?.hasAttachment === false && !('attachmentData' in listed));
const single = await api('GET', `/material-inwards/${i1.id}`);
ok('GET one carries the same', single.postedByName === 'CI Owner' && single.hasAttachment === false);

// The single-create path still works and still converts.
const one = await api('POST', '/material-inwards', { plantId: PLANT_ID, materialId: material.id, enteredUom: BAG, quantityReceived: 10, rate: 1000, supplierBillNo: `SB1-${SFX}` });
ok('the single create converts a keyed unit and keeps the bill number', near(one.quantityReceived, 0.5) && one.enteredUom === BAG && one.supplierBillNo === `SB1-${SFX}`);

// ---- D. The supplier's invoice: put, get, delete, refusals ----
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const attached = await api('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'invoice photo.png', mime: 'image/png', data: png.toString('base64') });
ok('the attachment is recorded on the row without the bytes', attached.hasAttachment === true && attached.attachmentName === 'invoice photo.png' && attached.attachmentMime === 'image/png' && !('attachmentData' in attached));
const got = await fetch(`${API_BASE}/material-inwards/${i1.id}/attachment`, { headers: { Authorization: `Bearer ${TOKEN}` } });
const gotBytes = Buffer.from(await got.arrayBuffer());
ok('GET streams the bytes with the right content type', got.status === 200 && got.headers.get('content-type') === 'image/png' && gotBytes.equals(png));
ok('…and names the file', (got.headers.get('content-disposition') ?? '').includes('invoice photo.png'));
const inList = (await api('GET', '/material-inwards')).find((r) => r.id === i1.id);
ok('the list says an invoice is attached, never the base64', inList?.hasAttachment === true && !('attachmentData' in inList));

// A PDF, replacing the image.
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32, 1)]);
const asPdf = await api('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'bill', mime: 'application/pdf', data: `data:application/pdf;base64,${pdf.toString('base64')}` });
ok('a PDF replaces the image and gets its extension', asPdf.attachmentMime === 'application/pdf' && asPdf.attachmentName === 'bill.pdf');
const gotPdf = await fetch(`${API_BASE}/material-inwards/${i1.id}/attachment`, { headers: { Authorization: `Bearer ${TOKEN}` } });
ok('GET streams the PDF', gotPdf.status === 200 && gotPdf.headers.get('content-type') === 'application/pdf');

const svg = await raw('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'x.svg', mime: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64') });
ok('an SVG is refused (400)', svg.status === 400);
const mismatch = await raw('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'x.png', mime: 'image/png', data: pdf.toString('base64') });
ok('a type that does not match the bytes is refused (400)', mismatch.status === 400);
const junk = await raw('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'x.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') });
ok('a text file is refused (400)', junk.status === 400);
const big = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024, 2)]);
const oversize = await raw('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'big.png', mime: 'image/png', data: big.toString('base64') });
ok('a file over 3 MB is refused (400)', oversize.status === 400 && /3 MB/.test(oversize.body?.error?.message ?? ''));
const empty = await raw('PUT', `/material-inwards/${i1.id}/attachment`, { name: 'x.png', mime: 'image/png', data: '' });
ok('no file is refused (400)', empty.status === 400);
const stillPdf = await api('GET', `/material-inwards/${i1.id}`);
ok('the refusals left the PDF in place', stillPdf.attachmentMime === 'application/pdf');

const removed = await api('DELETE', `/material-inwards/${i1.id}/attachment`);
ok('DELETE removes the attachment', removed.hasAttachment === false && removed.attachmentName === null);
const gone = await fetch(`${API_BASE}/material-inwards/${i1.id}/attachment`, { headers: { Authorization: `Bearer ${TOKEN}` } });
ok('GET after removal is a 404', gone.status === 404);

await api('POST', `/material-inwards/${i2.id}/cancel`);
const onCancelled = await raw('PUT', `/material-inwards/${i2.id}/attachment`, { name: 'x.png', mime: 'image/png', data: png.toString('base64') });
ok('a cancelled inward cannot carry an invoice (400)', onCancelled.status === 400);

console.log(`\nPURCHASE / INWARD FIELDS TEST: ${pass} passed`);
process.exit(0);
