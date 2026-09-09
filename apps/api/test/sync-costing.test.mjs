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

// ---------------------------------------------------------------------------
console.log('\n[O8] a rejected push, and its resolution, reach the device');
{
  // Push a challan under a number already used by a DIFFERENT document: the
  // cloud refuses it and records a conflict the operator was never told about.
  const dupNo = `SCH-${tag}-ORD`; // created earlier in this run, different payload
  const dup = (await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-DUP`, operation: 'create',
    payload: { challanNo: dupNo, gradeLabel: 'WHATEVER', quantityM3: 99, challanStatus: 'delivered' },
  }])).data.results[0];
  ok(dup.status === 'conflict' && dup.reason === 'duplicate_number', `the duplicate is refused (${dup.reason})`);
  const conflictId = dup.conflictId;
  ok(!!conflictId, 'the cloud recorded a conflict row');

  // Drain a pull and look for it among the device's changes.
  let token;
  let seenConflicts = [];
  let r = await call('GET', `/sync/pull?deviceId=${D}`);
  for (let i = 0; i < 200 && r.ok; i++) {
    seenConflicts.push(...(r.data.changes?.conflicts ?? []));
    token = r.data.syncToken;
    if (!r.data.hasMore) break;
    r = await call('GET', `/sync/pull?deviceId=${D}&since=${encodeURIComponent(token)}`);
  }
  const mine = seenConflicts.find((c) => c.id === conflictId);
  ok(!!mine, 'the conflict is delivered on the pull (the device used to never hear of it)');
  ok(mine?.conflictReason === 'duplicate_number', `carrying its reason (${mine?.conflictReason})`);
  ok(mine?.localId === `L-${tag}-DUP`, 'and the local id that ties it to the document on the tablet');
  ok(mine?.resolutionStatus === 'pending', 'still pending');

  const idle = await call('GET', `/sync/pull?deviceId=${D}&since=${encodeURIComponent(token)}`);
  ok((idle.data.changes?.conflicts ?? []).length === 0, 'a drained cursor stops re-sending it');

  // Resolve it in the office; the change must reach the plant on the next pull.
  const res = await post(`/sync/conflicts/${conflictId}/resolve`, { resolution: 'keep_cloud' });
  ok(res.ok, `resolved in the cloud (${res.status} ${res.msg})`);
  const after = await call('GET', `/sync/pull?deviceId=${D}&since=${encodeURIComponent(token)}`);
  const resolved = (after.data.changes?.conflicts ?? []).find((c) => c.id === conflictId);
  ok(!!resolved, 'the resolution is delivered to the device');
  ok(resolved?.resolutionStatus === 'keep_cloud', `with its new status (${resolved?.resolutionStatus})`);

  // Another device's conflicts are not this device's business.
  const dev2 = await post('/sync/devices/register', { deviceIdentifier: `SC2-${tag}`, deviceName: `Costing2 ${tag}`, plantId: PLANT });
  const D2 = dev2.data?.id;
  const other = await call('GET', `/sync/pull?deviceId=${D2}`);
  ok(!(other.data.changes?.conflicts ?? []).some((c) => c.id === conflictId), "another device does not receive this device's conflicts");
}

// ---------------------------------------------------------------------------
console.log('\n[O12] a number block expires, and the device is told');
{
  const r = await post('/sync/number-reservations', { deviceId: D, documentType: 'delivery_challan', count: 10 });
  ok(r.ok, `block reserved (${r.status} ${r.msg})`);
  const row = await one(`SELECT id, financial_year, expires_at, status FROM local_number_reservations WHERE id = $1`, [r.data.id]);
  ok(!!row.financial_year, `the block records its financial year (${row.financial_year})`);
  ok(!!row.expires_at, 'and when it stops being usable (it used to be valid for ever)');
  ok(new Date(row.expires_at) > new Date(), 'a fresh block is in date');

  // Age it out and let the device's own sync sweep it.
  await q(`UPDATE local_number_reservations SET expires_at = now() - interval '1 day' WHERE id = $1`, [r.data.id]);
  const pull = await call('GET', `/sync/pull?deviceId=${D}`);
  ok(pull.ok, `pull (${pull.status} ${pull.msg})`);
  const swept = await one(`SELECT status FROM local_number_reservations WHERE id = $1`, [r.data.id]);
  ok(swept.status === 'expired', `the stale block is retired on the device's own sync (${swept.status})`);
  const delivered = (pull.data.changes?.reservations ?? []).find((x) => x.id === r.data.id);
  ok(!!delivered, 'and the device is told about it on the same pull');
  ok(delivered?.status === 'expired', `carrying the new status (${delivered?.status})`);

  // A block from a previous financial year is retired even if it is in date:
  // after 1 April it would print last year's numbers into this year's books.
  const r2 = await post('/sync/number-reservations', { deviceId: D, documentType: 'delivery_challan', count: 10 });
  await q(`UPDATE local_number_reservations SET financial_year = '2019-20' WHERE id = $1`, [r2.data.id]);
  await call('GET', `/sync/pull?deviceId=${D}`);
  const oldFy = await one(`SELECT status FROM local_number_reservations WHERE id = $1`, [r2.data.id]);
  ok(oldFy.status === 'expired', `a block from a past financial year is retired (${oldFy.status})`);

  // A block issued before this feature has no FY recorded; it must be judged by
  // when it was created, not swept away by the upgrade.
  const r3 = await post('/sync/number-reservations', { deviceId: D, documentType: 'delivery_challan', count: 10 });
  await q(`UPDATE local_number_reservations SET financial_year = NULL, expires_at = NULL WHERE id = $1`, [r3.data.id]);
  await call('GET', `/sync/pull?deviceId=${D}`);
  const legacy = await one(`SELECT status FROM local_number_reservations WHERE id = $1`, [r3.data.id]);
  ok(legacy.status === 'active', `a pre-upgrade block issued this year survives the upgrade (${legacy.status})`);
}

console.log('\n[O5b] a Plant Device role exists that is ONLY the sync plane');
{
  const device = await one(`SELECT id, role_name FROM roles WHERE tenant_id = $1 AND role_key = 'plant_device'`, [TENANT]);
  ok(!!device, 'the tenant has a Plant Device role');
  const perms = await one(
    `SELECT COALESCE(array_agg(p.permission_key ORDER BY p.permission_key), '{}') AS keys
       FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [device?.id],
  );
  ok(perms.keys.length === 1 && perms.keys[0] === 'sync.manage', `it holds sync.manage and nothing else (${perms.keys.join(',')})`);
}

// ---------------------------------------------------------------------------
console.log('\n[I38] the cloud learns how much of a block a device has spent');
{
  const r = await post('/sync/number-reservations', { deviceId: D, documentType: 'delivery_challan', count: 20 });
  ok(r.ok, `block reserved (${r.status} ${r.msg})`);
  // The suffix is not stored on the cloud row — it comes from the series at
  // reserve time and rides the response, which is what the device formats with.
  const block = await one(`SELECT id, prefix, padding_length, number_from, used_count FROM local_number_reservations WHERE id = $1`, [r.data.id]);
  const suffix = r.data.suffix ?? '';
  ok(Number(block.used_count) === 0, `starts unspent (${block.used_count})`);

  // Push a challan numbered from inside the block, exactly as the device formats it.
  const first = Number(block.number_from);
  const challanNo = `${block.prefix ?? ''}${String(first).padStart(Number(block.padding_length), '0')}${suffix}`;
  const push1 = (await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-N1`, operation: 'create',
    payload: { challanNo, gradeLabel: 'M25', quantityM3: 5, challanStatus: 'delivered' },
  }])).data.results[0];
  ok(push1.status === 'applied', `a challan from the block is applied (${push1.status} ${push1.reason ?? ''})`);
  const after1 = await one(`SELECT used_count FROM local_number_reservations WHERE id = $1`, [r.data.id]);
  ok(Number(after1.used_count) === 1, `the block records one number spent (${after1.used_count}) — it used to stay 0 for ever`);

  // A number further into the block moves the count to that position, not by one.
  const fifth = first + 4;
  const challanNo5 = `${block.prefix ?? ''}${String(fifth).padStart(Number(block.padding_length), '0')}${suffix}`;
  await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-N5`, operation: 'create',
    payload: { challanNo: challanNo5, gradeLabel: 'M25', quantityM3: 5, challanStatus: 'delivered' },
  }]);
  const after5 = await one(`SELECT used_count FROM local_number_reservations WHERE id = $1`, [r.data.id]);
  ok(Number(after5.used_count) === 5, `and tracks how far into the block the device has reached (${after5.used_count})`);

  // A hand-typed number from outside every block matches nothing and is harmless.
  const outside = (await push([{
    entityName: 'delivery_challan', localId: `L-${tag}-NX`, operation: 'create',
    payload: { challanNo: `MANUAL-${tag}`, gradeLabel: 'M25', quantityM3: 5, challanStatus: 'delivered' },
  }])).data.results[0];
  ok(outside.status === 'applied', 'a number from outside any block still applies');
  const afterX = await one(`SELECT used_count FROM local_number_reservations WHERE id = $1`, [r.data.id]);
  ok(Number(afterX.used_count) === 5, `and changes no block's count (${afterX.used_count})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
await owner.destroy();
process.exit(failed ? 1 : 0);
