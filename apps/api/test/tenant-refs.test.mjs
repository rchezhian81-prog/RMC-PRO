/**
 * Tenant-scoped reference lookups (data-integrity item I19, layer 1).
 *
 * Postgres evaluates foreign keys as the table owner and bypasses row security,
 * so a UUID belonging to ANOTHER tenant satisfies RI while every RLS-scoped read
 * in this tenant returns null. Every create path that persists a reference id
 * must therefore resolve it inside the tenant and refuse with a 400 — this
 * seeds a foreign tenant's masters directly and tries each path with them.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
const PLANT = process.env.TEST_PLANT_ID;
const MATERIAL = process.env.TEST_MATERIAL_ID;
if (!TENANT || !PLANT || !MATERIAL) { console.error('TEST_TENANT_ID, TEST_PLANT_ID, TEST_MATERIAL_ID required'); process.exit(1); }

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  database: process.env.POSTGRES_DB ?? 'rmc',
});
await owner.initialize();
const q = (sql, params) => owner.query(sql, params);
const one = async (sql, params) => (await owner.query(sql, params))[0];
const count = async (sql, params) => Number((await one(sql, params))?.n ?? -1);

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);
const refused = (r, re) => r.status === 400 && re.test(r.msg);

// ── A foreign tenant with its own masters (seeded directly; RLS hides all of it from us) ──
const F = randomUUID();
await q(`INSERT INTO tenants (id, tenant_code, tenant_name, status) VALUES ($1, $2, $3, 'active')`, [F, `TR-${tag}`.toUpperCase(), `Foreign Co ${tag}`]);
const fCustomer = randomUUID(); const fSite = randomUUID(); const fMaterial = randomUUID(); const fPlant = randomUUID(); const fSupplier = randomUUID(); const fGrade = randomUUID();
await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, 'FC-1', 'Foreign Customer')`, [fCustomer, F]);
await q(`INSERT INTO sites (id, tenant_id, customer_id, site_code, site_name) VALUES ($1, $2, $3, 'FS-1', 'Foreign Site')`, [fSite, F, fCustomer]);
await q(`INSERT INTO materials (id, tenant_id, material_code, material_name) VALUES ($1, $2, 'FM-1', 'Foreign Material')`, [fMaterial, F]);
await q(`INSERT INTO plants (id, tenant_id, plant_code, plant_name) VALUES ($1, $2, 'FP-1', 'Foreign Plant')`, [fPlant, F]);
await q(`INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name) VALUES ($1, $2, 'FSU-1', 'Foreign Supplier')`, [fSupplier, F]);
await q(`INSERT INTO concrete_grades (id, tenant_id, grade_code, grade_name) VALUES ($1, $2, 'M25', 'M25')`, [fGrade, F]);
// Our own masters for the "right" cases.
const A = randomUUID(); const B = randomUUID(); const siteA = randomUUID(); const sup = randomUUID(); const sup2 = randomUUID();
await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, 'Refs A')`, [A, TENANT, `TRA-${tag}`]);
await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, 'Refs B')`, [B, TENANT, `TRB-${tag}`]);
await q(`INSERT INTO sites (id, tenant_id, customer_id, site_code, site_name) VALUES ($1, $2, $3, $4, 'Site of A')`, [siteA, TENANT, A, `TRS-${tag}`]);
await q(`INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name) VALUES ($1, $2, $3, 'Refs Supplier')`, [sup, TENANT, `TRSU-${tag}`]);
await q(`INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name) VALUES ($1, $2, $3, 'Refs Supplier 2')`, [sup2, TENANT, `TRSU2-${tag}`]);

console.log('\n[I19] sales: customer / site / lead must resolve in the tenant; site must belong to the customer');
{
  const r1 = await post('/quotations', { customerId: fCustomer, quotationDate: TODAY, validUntil: TODAY });
  ok(refused(r1, /customer not found/i), `quotation for a foreign customer is refused (${r1.status}: ${r1.msg})`);
  const r2 = await post('/quotations', { customerId: B, siteId: siteA, quotationDate: TODAY, validUntil: TODAY });
  ok(refused(r2, /different customer/i), `quotation with another customer's site is refused (${r2.status}: ${r2.msg})`);
  const r3 = await post('/quotations', { customerId: A, siteId: siteA, quotationDate: TODAY, validUntil: TODAY });
  ok(r3.ok, `quotation with a matching customer + site is created (${r3.status} ${r3.msg})`);
  const r4 = await post('/quotations', { customerId: A, siteId: fSite, quotationDate: TODAY, validUntil: TODAY });
  ok(refused(r4, /site not found/i), `quotation with a foreign site is refused (${r4.status}: ${r4.msg})`);
  const r5 = await post('/rate-contracts', { customerId: fCustomer, validFrom: TODAY, validTo: TODAY });
  ok(refused(r5, /customer not found/i), `rate contract for a foreign customer is refused (${r5.status}: ${r5.msg})`);
  ok((await count(`SELECT count(*)::int AS n FROM quotations WHERE tenant_id = $1 AND (customer_id = $2 OR site_id = $3)`, [TENANT, fCustomer, fSite])) === 0, 'no quotation row carries a foreign reference');
}

console.log('\n[I19] orders: a customer that does not resolve blocks confirm');
{
  const O = randomUUID();
  await q(`INSERT INTO orders (id, tenant_id, order_no, order_status, customer_id) VALUES ($1, $2, $3, 'draft', $4)`, [O, TENANT, `TR-ORD-${tag}`, fCustomer]);
  const g = await one(`SELECT id, grade_code FROM concrete_grades WHERE tenant_id = $1 ORDER BY grade_code LIMIT 1`, [TENANT]);
  await q(`INSERT INTO order_items (id, tenant_id, order_id, grade_id, grade_label, quantity_m3) VALUES ($1, $2, $3, $4, $5, 10)`, [randomUUID(), TENANT, O, g.id, g.grade_code]);
  const c = await post(`/orders/${O}/confirm`, {});
  ok(refused(c, /customer not found/i), `confirming an order whose customer is foreign is refused (${c.status}: ${c.msg})`);
  ok((await one(`SELECT order_status FROM orders WHERE id = $1`, [O])).order_status === 'draft', 'the order stays draft');
}

console.log('\n[I19] production / inventory: material, grade and plant ids');
{
  const mx = await post('/mix-designs', { mixCode: `TR-MIX-${tag}`, materials: [{ materialId: fMaterial, materialLabel: 'Ghost', targetQuantity: 100 }] });
  ok(refused(mx, /material not found/i), `mix design with a foreign material is refused (${mx.status}: ${mx.msg})`);
  ok((await count(`SELECT count(*)::int AS n FROM mix_designs WHERE tenant_id = $1 AND mix_code = $2`, [TENANT, `TR-MIX-${tag}`])) === 0, 'the refused mix design was rolled back entirely');
  const mg = await post('/mix-designs', { mixCode: `TR-MIXG-${tag}`, gradeId: fGrade });
  ok(refused(mg, /grade not found/i), `mix design with a foreign grade is refused (${mg.status}: ${mg.msg})`);
  const op = await post('/stock/opening', { materialId: MATERIAL, plantId: fPlant, quantity: 5 });
  ok(refused(op, /plant not found/i), `opening stock at a foreign plant is refused (${op.status}: ${op.msg})`);
  ok((await count(`SELECT count(*)::int AS n FROM stock_balances WHERE plant_id = $1`, [fPlant])) === 0, 'no balance row was created under the foreign plant');
  const inw = await post('/material-inwards', { materialId: fMaterial, quantityReceived: 5, rate: 10 });
  ok(refused(inw, /material not found/i), `material inward for a foreign material is refused (${inw.status}: ${inw.msg})`);
  const adj = await post('/stock-adjustments', { materialId: fMaterial, quantity: 5, direction: 'increase', plantId: PLANT, reason: 'test' });
  ok(refused(adj, /material not found/i), `stock adjustment for a foreign material is refused (${adj.status}: ${adj.msg})`);
  const wb = await post('/weighbridge', { materialId: fMaterial, grossWeight: 10000, tareWeight: 5000, vehicleNo: 'TN01AB1234' });
  ok(refused(wb, /material not found/i), `weighbridge slip for a foreign material is refused (${wb.status}: ${wb.msg})`);
}

console.log('\n[I19] purchase / expenses: supplier and plant ids; GRN header agrees with its PO');
{
  const vp = await post('/vendor-payments', { supplierId: fSupplier, amount: 100, paymentMode: 'neft', paymentDate: TODAY });
  ok(refused(vp, /supplier not found/i), `vendor payment to a foreign supplier is refused (${vp.status}: ${vp.msg})`);
  const vb = await post('/vendor-bills', { supplierId: fSupplier, billDate: TODAY, lines: [{ quantity: 1, rate: 10 }] });
  ok(refused(vb, /supplier not found/i), `vendor bill from a foreign supplier is refused (${vb.status}: ${vb.msg})`);
  const po = await post('/purchase-orders', { supplierId: sup, plantId: fPlant, lines: [{ materialId: MATERIAL, quantity: 1, rate: 10 }] });
  ok(refused(po, /plant not found/i), `purchase order for a foreign plant is refused (${po.status}: ${po.msg})`);
  const ex = await post('/expense-vouchers', { plantId: fPlant, voucherDate: TODAY, lines: [{ amount: 10, expenseHeadLabel: 'Diesel', allocationType: 'general' }] });
  ok(refused(ex, /plant not found/i), `expense voucher at a foreign plant is refused (${ex.status}: ${ex.msg})`);
  const PO = randomUUID();
  await q(`INSERT INTO purchase_orders (id, tenant_id, po_no, status, supplier_id) VALUES ($1, $2, $3, 'issued', $4)`, [PO, TENANT, `TR-PO-${tag}`, sup]);
  const grn = await post('/goods-receipts', { purchaseOrderId: PO, supplierId: sup2, plantId: PLANT, receiptDate: TODAY, lines: [{ materialId: MATERIAL, receivedQuantity: 1, acceptedQuantity: 1, rate: 10 }] });
  ok(refused(grn, /does not match the purchase order/i), `GRN naming a different supplier than its PO is refused (${grn.status}: ${grn.msg})`);
  const grnF = await post('/goods-receipts', { supplierId: fSupplier, plantId: PLANT, receiptDate: TODAY, lines: [{ materialId: MATERIAL, receivedQuantity: 1, acceptedQuantity: 1, rate: 10 }] });
  ok(refused(grnF, /supplier not found/i), `ad-hoc GRN from a foreign supplier is refused (${grnF.status}: ${grnF.msg})`);
}

console.log('\n[I19] QC: grade and plant ids');
{
  const cs = await post('/qc/cube-sets', { castDate: TODAY, gradeId: fGrade, specimenCount: 3 });
  ok(refused(cs, /grade not found/i), `cube set for a foreign grade is refused (${cs.status}: ${cs.msg})`);
  const cp = await post('/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25, plantId: fPlant, specimenCount: 3 });
  ok(refused(cp, /plant not found/i), `cube set at a foreign plant is refused (${cp.status}: ${cp.msg})`);
}

console.log('\n[I19] offline sync: a device-supplied foreign customer is a conflict, not a dangling row');
{
  const dev = await post('/sync/devices/register', { deviceIdentifier: `TR-${tag}`, deviceName: `Tenant Refs ${tag}` });
  ok(dev.ok, `device registered (${dev.status} ${dev.msg})`);
  const deviceId = dev.data?.id ?? dev.data?.deviceId;
  const challanNo = `TR-DC-${tag}`;
  const push = await post('/sync/push', {
    deviceId,
    records: [{ entityName: 'delivery_challan', localId: `c-${tag}`, operation: 'create', payload: { challanNo, gradeLabel: 'M25', quantityM3: 6, customerId: fCustomer, challanStatus: 'issued' } }],
  });
  const res = (push.data?.results ?? push.data ?? [])[0];
  ok(push.ok && res?.status === 'conflict' && res?.reason === 'unknown_customer', `push reports unknown_customer (${push.status}: ${JSON.stringify(res)})`);
  ok((await count(`SELECT count(*)::int AS n FROM delivery_challans WHERE tenant_id = $1 AND challan_no = $2`, [TENANT, challanNo])) === 0, 'no challan was created with the foreign customer');
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
