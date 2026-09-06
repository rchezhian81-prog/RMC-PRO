/**
 * Purchase-table foreign keys (data-integrity item I19, schema layer).
 *
 * `1720000034000-Purchase` created supplier_id / material_id /
 * purchase_order_item_id as bare uuid columns. `PurchaseForeignKeys1720000060000`
 * adds the nine plain FKs; this proves they exist on the migrated schema, that
 * the database itself now refuses a dangling reference and a hard delete of a
 * referenced master (SQLSTATE 23503), that the API maps that to a 400, and that
 * the deploy preflight passes on the migrated data.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_MATERIAL_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
const MATERIAL = process.env.TEST_MATERIAL_ID;
if (!TENANT || !MATERIAL) { console.error('TEST_TENANT_ID, TEST_MATERIAL_ID required'); process.exit(1); }

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

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}
/** Run a statement expected to fail; return the SQLSTATE (or 'ok' if it succeeded). */
async function sqlstate(sql, params) {
  try { await q(sql, params); return 'ok'; } catch (e) { return e?.driverError?.code ?? e?.code ?? `error: ${e?.message}`; }
}

const EXPECTED = [
  ['purchase_orders', 'fk_purchase_orders_supplier'],
  ['purchase_order_items', 'fk_purchase_order_items_material'],
  ['goods_receipts', 'fk_goods_receipts_supplier'],
  ['goods_receipt_items', 'fk_goods_receipt_items_po_item'],
  ['goods_receipt_items', 'fk_goods_receipt_items_material'],
  ['vendor_bills', 'fk_vendor_bills_supplier'],
  ['vendor_bill_items', 'fk_vendor_bill_items_po_item'],
  ['vendor_bill_items', 'fk_vendor_bill_items_material'],
  ['vendor_payments', 'fk_vendor_payments_supplier'],
];

console.log('\n[I19 schema] the nine purchase-table FKs exist on the migrated schema');
{
  const rows = await q(
    `SELECT table_name, constraint_name FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY' AND constraint_schema = 'public' AND constraint_name LIKE 'fk_%'`,
  );
  const have = new Set(rows.map((r) => `${r.table_name}.${r.constraint_name}`));
  for (const [t, c] of EXPECTED) ok(have.has(`${t}.${c}`), `${t}.${c} present`);
  const mig = await one(`SELECT count(*)::int AS n FROM migrations WHERE name = 'PurchaseForeignKeys1720000060000'`);
  ok(mig?.n === 1, 'the migration is recorded as applied');
}

console.log('\n[I19 schema] the database refuses dangling references (SQLSTATE 23503)');
const tag = Date.now().toString(36);
const SUP = randomUUID();
await q(`INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name) VALUES ($1, $2, $3, 'FK Supplier')`, [SUP, TENANT, `FK-${tag}`]);
{
  const po = await sqlstate(`INSERT INTO purchase_orders (id, tenant_id, po_no, status, supplier_id) VALUES ($1, $2, $3, 'draft', $4)`, [randomUUID(), TENANT, `FK-PO-X-${tag}`, randomUUID()]);
  ok(po === '23503', `purchase order with a non-existent supplier is refused (${po})`);
  const PO = randomUUID();
  const good = await sqlstate(`INSERT INTO purchase_orders (id, tenant_id, po_no, status, supplier_id) VALUES ($1, $2, $3, 'draft', $4)`, [PO, TENANT, `FK-PO-${tag}`, SUP]);
  ok(good === 'ok', 'purchase order with a real supplier is accepted');
  const poi = await sqlstate(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, quantity) VALUES ($1, $2, $3, $4, 1)`, [randomUUID(), TENANT, PO, randomUUID()]);
  ok(poi === '23503', `PO line with a non-existent material is refused (${poi})`);
  const POI = randomUUID();
  await q(`INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, quantity) VALUES ($1, $2, $3, $4, 1)`, [POI, TENANT, PO, MATERIAL]);
  const G = randomUUID();
  await q(`INSERT INTO goods_receipts (id, tenant_id, grn_no, purchase_order_id, supplier_id, status) VALUES ($1, $2, $3, $4, $5, 'draft')`, [G, TENANT, `FK-GRN-${tag}`, PO, SUP]);
  const gri = await sqlstate(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, received_quantity, accepted_quantity) VALUES ($1, $2, $3, $4, $5, 1, 1)`, [randomUUID(), TENANT, G, randomUUID(), MATERIAL]);
  ok(gri === '23503', `GRN line citing a non-existent PO line is refused (${gri})`);
  const grOk = await sqlstate(`INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id, received_quantity, accepted_quantity) VALUES ($1, $2, $3, $4, $5, 1, 1)`, [randomUUID(), TENANT, G, POI, MATERIAL]);
  ok(grOk === 'ok', 'GRN line citing the real PO line is accepted');
  const vb = await sqlstate(`INSERT INTO vendor_bills (id, tenant_id, bill_no, supplier_id, status, total_amount, paid_amount, outstanding_amount, payment_status) VALUES ($1, $2, $3, $4, 'draft', 0, 0, 0, 'unpaid')`, [randomUUID(), TENANT, `FK-VB-${tag}`, randomUUID()]);
  ok(vb === '23503', `vendor bill for a non-existent supplier is refused (${vb})`);
  const vp = await sqlstate(`INSERT INTO vendor_payments (id, tenant_id, payment_no, supplier_id, amount, status) VALUES ($1, $2, $3, $4, 10, 'posted')`, [randomUUID(), TENANT, `FK-VP-${tag}`, randomUUID()]);
  ok(vp === '23503', `vendor payment to a non-existent supplier is refused (${vp})`);

  console.log('\n[I19 schema] a referenced master cannot be hard-deleted');
  const del = await sqlstate(`DELETE FROM suppliers WHERE id = $1`, [SUP]);
  ok(del === '23503', `deleting a supplier with purchase rows is refused (${del})`);
  ok((await one(`SELECT count(*)::int AS n FROM suppliers WHERE id = $1`, [SUP])).n === 1, 'the supplier row is still there');
}

console.log('\n[I19 schema] the API maps both directions of 23503 to a 400');
{
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
  }).then((r) => r.json());
  const TOKEN = loginRes?.data?.access_token;
  const res = await fetch(`${BASE}/purchase-orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ supplierId: randomUUID(), lines: [{ materialId: MATERIAL, quantity: 1, rate: 10 }] }),
  });
  const json = await res.json().catch(() => null);
  ok(res.status === 400, `API purchase order with an unknown supplier is a 400, not a 500 (${res.status}: ${json?.error?.message ?? json?.message ?? ''})`);
}

console.log('\n[I19 schema] the deploy preflight passes on the migrated schema and covers the new FKs');
{
  const here = dirname(fileURLToPath(import.meta.url));
  const r = spawnSync('node', ['dist/core/database/migration-preflight.js'], { cwd: resolve(here, '..'), env: process.env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  ok(r.status === 0, `preflight exits 0 (${r.status})`);
  ok(!/FAIL/.test(out), 'preflight reports no violations');
  for (const [t, c] of EXPECTED) ok(new RegExp(`ok\\s+${t}\\.${c}`).test(out), `preflight checked ${t}.${c}`);
  ok(/ok\s+tenants\.fk_tenants_plan/.test(out), 'preflight checked tenants.fk_tenants_plan');
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
