/**
 * Offline documents cost and bill correctly, and a device sees only its plant
 * (gap-scan items O6, O7, O9).
 *
 *   O6 — an offline batch ticket was stored with no material lines and no
 *        ledger movement, so book stock drifted permanently upwards by every
 *        batch a plant made while offline.
 *   O7 — an offline challan was stored with order_id NULL, and the invoice
 *        takes its rate from the ORDER's line, so every offline delivery
 *        billed at ₹0.
 *   O9 — bootstrap and pull returned the whole tenant, so a tablet at one
 *        plant held every other plant's customers, orders, challans and stock.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_PLANT_ID,
 *      TEST_MATERIAL_ID, POSTGRES_*.
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

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
}

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data, msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);

const dev = await post('/sync/devices/register', { deviceIdentifier: `SC-${tag}`, deviceName: `Costing ${tag}`, plantId: PLANT });
ok(dev.ok, `device registered at the test plant (${dev.status} ${dev.msg})`);
const D = dev.data?.id;
const push = (records) => post('/sync/push', { deviceId: D, records });

// ---------------------------------------------------------------------------
console.log('\n[O7] an offline challan bills at the order rate, not ₹0');
{
  const customerId = randomUUID();
  await q(
    `INSERT INTO customers (id, tenant_id, customer_code, customer_name, customer_type)
     VALUES ($1,$2,$3,$4,'company')`,
    [customerId, TENANT, `SCC-${tag}`, `Costing Customer ${tag}`],
  );
  const gradeId = randomUUID();
  const gradeCode = `SCG-${tag}`;
  await q(
    `INSERT INTO concrete_grades (id, tenant_id, grade_code, grade_name) VALUES ($1,$2,$3,$4)`,
    [gradeId, TENANT, gradeCode, `Costing Grade ${tag}`],
  );
  const orderId = randomUUID();
  await q(
    `INSERT INTO orders (id, tenant_id, order_no, customer_id, plant_id, order_status, return_billing_policy, return_fee_per_m3)
     VALUES ($1,$2,$3,$4,$5,'confirmed','net',0)`,
    [orderId, TENANT, `SCO-${tag}`, customerId, PLANT],
  );
  // All-in agreed rate = 4200 + 250 + 100 + 50 = 4600 per m³.
  await q(
    `INSERT INTO order_items (id, tenant_id, order_id, grade_id, grade_label, quantity_m3, rate_per_m3, transport_charge, pump_charge, waiting_charge, gst_rate)
     VALUES ($1,$2,$3,$4,$5,50,4200,250,100,50,18)`,
    [randomUUID(), TENANT, orderId, gradeId, gradeCode],
  );

  const withOrder = `SCH-${tag}-ORD`;
  const r1 = (await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-1`, operation: 'create',
    payload: { challanNo: withOrder, gradeLabel: gradeCode, quantityM3: 7, orderId, challanStatus: 'delivered' },
  }])).data.results[0];
  ok(r1.status === 'applied', `challan with an order is applied (${r1.status} ${r1.reason ?? ''})`);
  const saved = await one(`SELECT order_id, customer_id, grade_id, plant_id FROM delivery_challans WHERE challan_no = $1`, [withOrder]);
  ok(saved?.order_id === orderId, 'the order is stored on the challan (it used to be null)');
  ok(saved?.customer_id === customerId, "the order's customer is stamped even though the device sent none");
  ok(saved?.grade_id === gradeId, 'the grade id is resolved from the grade label');
  ok(saved?.plant_id === PLANT, "the device's plant is stamped");

  const cand = await call('GET', `/invoices/billable-challans?customerId=${customerId}`);
  const line = (cand.data ?? []).find((c) => c.challanNo === withOrder);
  ok(!!line, 'the pushed challan is billable');
  ok(Number(line?.suggestedRate) === 4600, `and bills at the agreed all-in rate (${line?.suggestedRate}, was 0)`);

  // A challan quoting another customer's order must not bill against it.
  const otherCustomer = randomUUID();
  await q(
    `INSERT INTO customers (id, tenant_id, customer_code, customer_name, customer_type)
     VALUES ($1,$2,$3,$4,'company')`,
    [otherCustomer, TENANT, `SCC-${tag}-X`, `Other Customer ${tag}`],
  );
  const mism = (await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-2`, operation: 'create',
    payload: { challanNo: `SCH-${tag}-MIS`, gradeLabel: gradeCode, quantityM3: 5, orderId, customerId: otherCustomer, challanStatus: 'delivered' },
  }])).data.results[0];
  ok(mism.status === 'conflict' && mism.reason === 'customer_order_mismatch', `a challan billed to another customer's order is refused (${mism.reason})`);
  const mismRow = await one(`SELECT count(*)::int AS n FROM delivery_challans WHERE challan_no = $1`, [`SCH-${tag}-MIS`]);
  ok(mismRow.n === 0, 'and is not written');

  const unknown = (await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-3`, operation: 'create',
    payload: { challanNo: `SCH-${tag}-UNK`, gradeLabel: gradeCode, quantityM3: 5, orderId: randomUUID(), challanStatus: 'delivered' },
  }])).data.results[0];
  ok(unknown.status === 'conflict' && unknown.reason === 'unknown_order', `an unknown order id is refused (${unknown.reason})`);
}

// ---------------------------------------------------------------------------
console.log('\n[O6] an offline batch ticket draws its raw material out of stock');
{
  const gradeId = randomUUID();
  const gradeCode = `SBG-${tag}`;
  await q(
    `INSERT INTO concrete_grades (id, tenant_id, grade_code, grade_name) VALUES ($1,$2,$3,$4)`,
    [gradeId, TENANT, gradeCode, `Batch Grade ${tag}`],
  );
  const mixId = randomUUID();
  await q(
    `INSERT INTO mix_designs (id, tenant_id, mix_code, grade_id, approval_status, is_active_version, version_no)
     VALUES ($1,$2,$3,$4,'approved',true,1)`,
    [mixId, TENANT, `SBM-${tag}`, gradeId],
  );
  // 320 kg of the test material per m³.
  await q(
    `INSERT INTO mix_design_materials (id, tenant_id, mix_design_id, material_id, material_label, target_quantity, uom, sequence_no)
     VALUES ($1,$2,$3,$4,$5,320,'kg',1)`,
    [randomUUID(), TENANT, mixId, MATERIAL, 'Test Material'],
  );

  const seed = await post('/stock/opening', { materialId: MATERIAL, plantId: PLANT, quantity: 10000 });
  ok(seed.ok, `stock seeded (${seed.status} ${seed.msg})`);
  const before = await one(`SELECT current_quantity::float AS q FROM stock_balances WHERE plant_id = $1 AND material_id = $2`, [PLANT, MATERIAL]);

  const ticketNo = `SBT-${tag}`;
  const res = (await push([{
    entityName: 'batch_ticket', localId: `L-${tag}-B1`, operation: 'create',
    payload: { batchTicketNo: ticketNo, gradeLabel: gradeCode, batchQuantityM3: 6 },
  }])).data.results[0];
  ok(res.status === 'applied', `batch ticket applied (${res.status} ${res.reason ?? ''})`);

  const ticket = await one(`SELECT id, mix_design_id, grade_id, notes FROM batch_tickets WHERE batch_ticket_no = $1`, [ticketNo]);
  ok(ticket?.mix_design_id === mixId, 'the approved mix design is recorded on the ticket');
  ok(ticket?.grade_id === gradeId, 'the grade is resolved from the label');
  ok(!ticket?.notes, 'no "not costed" note is stamped when the recipe resolved');

  const lines = await q(`SELECT material_id, actual_quantity::float AS a FROM batch_ticket_materials WHERE batch_ticket_id = $1`, [ticket.id]);
  ok(lines.length === 1, `the ticket has its material lines (${lines.length}, was 0)`);
  ok(Math.abs(lines[0].a - 1920) < 0.01, `scaled to the batch: 320 × 6 m³ = ${lines[0].a} kg`);

  const after = await one(`SELECT current_quantity::float AS q FROM stock_balances WHERE plant_id = $1 AND material_id = $2`, [PLANT, MATERIAL]);
  ok(Math.abs((before.q - after.q) - 1920) < 0.01, `stock fell by the consumption: ${before.q} → ${after.q} (it used to be unchanged)`);
  const ledger = await one(
    `SELECT count(*)::int AS n, COALESCE(SUM(out_quantity),0)::float AS out FROM stock_transactions WHERE reference_id = $1 AND reference_type = 'batch_ticket'`,
    [ticket.id],
  );
  ok(ledger.n === 1 && Math.abs(ledger.out - 1920) < 0.01, `and the movement is on the ledger against the ticket (${ledger.n} row, ${ledger.out})`);

  // A grade with no approved mix: the production record is kept, not lost, and
  // says on its face that it was not costed.
  const noMixNo = `SBT-${tag}-NOMIX`;
  const r2 = (await push([{
    entityName: 'batch_ticket', localId: `L-${tag}-B2`, operation: 'create',
    payload: { batchTicketNo: noMixNo, gradeLabel: `NO-SUCH-GRADE-${tag}`, batchQuantityM3: 4 },
  }])).data.results[0];
  ok(r2.status === 'applied', 'a ticket whose grade has no approved mix is still applied');
  const t2 = await one(`SELECT notes FROM batch_tickets WHERE batch_ticket_no = $1`, [noMixNo]);
  ok(/no approved mix design/i.test(t2?.notes ?? ''), 'and carries a note saying no stock was consumed');
  const after2 = await one(`SELECT current_quantity::float AS q FROM stock_balances WHERE plant_id = $1 AND material_id = $2`, [PLANT, MATERIAL]);
  ok(after2.q === after.q, 'with stock left alone');
}

// ---------------------------------------------------------------------------
console.log("\n[O9] a device sees its own plant, not the whole company");
{
  const otherPlant = randomUUID();
  await q(
    `INSERT INTO plants (id, tenant_id, plant_code, plant_name) VALUES ($1,$2,$3,$4)`,
    [otherPlant, TENANT, `SCP-${tag}`, `Other Plant ${tag}`],
  );
  const otherCustomer = randomUUID();
  await q(
    `INSERT INTO customers (id, tenant_id, customer_code, customer_name, customer_type)
     VALUES ($1,$2,$3,$4,'company')`,
    [otherCustomer, TENANT, `SCC-${tag}-P2`, `Plant2 Customer ${tag}`],
  );
  const otherOrder = randomUUID();
  await q(
    `INSERT INTO orders (id, tenant_id, order_no, customer_id, plant_id, order_status)
     VALUES ($1,$2,$3,$4,$5,'confirmed')`,
    [otherOrder, TENANT, `SCO-${tag}-P2`, otherCustomer, otherPlant],
  );
  const otherChallan = `SCH-${tag}-P2`;
  await q(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, plant_id, customer_id, order_id, quantity_m3, challan_status, invoice_status)
     VALUES ($1,$2,$3,$4,$5,$6,9,'delivered','not_invoiced')`,
    [randomUUID(), TENANT, otherChallan, otherPlant, otherCustomer, otherOrder],
  );
  await q(
    `INSERT INTO stock_balances (id, tenant_id, plant_id, material_id, material_label, current_quantity, uom)
     VALUES ($1,$2,$3,$4,'Other Plant Material',777,'kg')`,
    [randomUUID(), TENANT, otherPlant, MATERIAL],
  );

  const boot = await call('GET', `/sync/bootstrap?deviceId=${D}`);
  ok(boot.ok, `bootstrap (${boot.status} ${boot.msg})`);
  const bootOrders = boot.data?.reference?.orders ?? [];
  const bootCustomers = boot.data?.reference?.customers ?? [];
  ok(!bootOrders.some((o) => o.id === otherOrder), "the other plant's order is not in the bootstrap (it used to be)");
  ok(!bootCustomers.some((c) => c.id === otherCustomer), "nor is a customer only that plant serves");
  ok(bootOrders.every((o) => !o.plantId || o.plantId === PLANT), 'every order in the snapshot belongs to this plant');

  // Drain a full pull from scratch and check the same boundary.
  let token = boot.data?.syncToken;
  const seen = { orders: [], customers: [], deliveryChallans: [], stockBalances: [] };
  let fresh = await call('GET', `/sync/pull?deviceId=${D}`);
  ok(fresh.ok, `pull (${fresh.status} ${fresh.msg})`);
  for (let i = 0; i < 200 && fresh.ok; i++) {
    for (const k of Object.keys(seen)) seen[k].push(...(fresh.data.changes?.[k] ?? []));
    token = fresh.data.syncToken;
    if (!fresh.data.hasMore) break;
    fresh = await call('GET', `/sync/pull?deviceId=${D}&since=${encodeURIComponent(token)}`);
  }
  ok(!seen.orders.some((o) => o.id === otherOrder), "the other plant's order never reaches the device on pull");
  ok(!seen.deliveryChallans.some((c) => c.challanNo === otherChallan), "nor its challans");
  ok(!seen.stockBalances.some((b) => b.plantId === otherPlant), 'nor its stock balances');
  ok(!seen.customers.some((c) => c.id === otherCustomer), 'nor a customer only that plant serves');
  ok(seen.deliveryChallans.some((c) => c.challanNo === `SCH-${tag}-ORD`), "while this plant's own challan still arrives");
}

console.log(`\n${passed} passed, ${failed} failed`);
await owner.destroy();
process.exit(failed ? 1 : 0);
