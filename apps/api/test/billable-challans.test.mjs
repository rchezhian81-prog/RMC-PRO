/**
 * billable-challans N+1 collapse — equivalence test.
 *
 * GET /invoices/billable-challans lists a customer's delivered, not-yet-invoiced
 * challans and annotates each with the suggested rate (the all-in per-m³ rate
 * agreed on the order), the return-billing policy and the billed quantity. It
 * used to run two queries PER challan (order lookup + order-items); it now
 * batch-loads the referenced orders and items once. This pins the annotations so
 * the batched maps stay identical to the per-row lookups — in particular that
 * the suggested rate picks the order line for the challan's GRADE (not simply the
 * first line), and that an ad-hoc challan with no order still lists cleanly.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID,
 * POSTGRES_* (owner, to seed the order/items/challans directly).
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PW = process.env.RMC_PASSWORD;
const TENANT = process.env.TEST_TENANT_ID;

if (!LOGIN || !PW || !TENANT) {
  console.log('(skipping billable-challans — LOGIN/RMC_PASSWORD/TEST_TENANT_ID not set)');
  process.exit(0);
}

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  synchronize: false,
  logging: false,
});

(async () => {
  await owner.initialize();

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PW }),
  });
  const token = (await loginRes.json())?.data?.access_token;
  ok('logged in as the tenant owner', typeof token === 'string' && token.length > 0);

  const tag = randomUUID().slice(0, 8);
  const customerId = randomUUID();
  await owner.query(
    `INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1,$2,$3,$4)`,
    [customerId, TENANT, `BCC-${tag}`, `Billable Challan Co ${tag}`],
  );

  // Two concrete grades (order_items.grade_id and delivery_challans.grade_id
  // both FK concrete_grades), so the order can carry a line per grade.
  const gradeA = randomUUID();
  const gradeB = randomUUID();
  await owner.query(
    `INSERT INTO concrete_grades (id, tenant_id, grade_code, grade_name) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)`,
    [gradeA, TENANT, `BCG-${tag}-A`, `Grade A ${tag}`, gradeB, `BCG-${tag}-B`, `Grade B ${tag}`],
  );

  // An order carrying TWO grade lines with different all-in rates, so the
  // suggested rate must be picked by grade, not "the first line".
  const orderId = randomUUID();
  await owner.query(
    `INSERT INTO orders (id, tenant_id, order_no, customer_id, return_billing_policy, return_fee_per_m3)
     VALUES ($1,$2,$3,$4,'net',0)`,
    [orderId, TENANT, `BCO-${tag}`, customerId],
  );
  const item = (gradeId, rate, transport, pump, waiting) =>
    owner.query(
      `INSERT INTO order_items (id, tenant_id, order_id, grade_id, rate_per_m3, transport_charge, pump_charge, waiting_charge, gst_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,18)`,
      [randomUUID(), TENANT, orderId, gradeId, rate, transport, pump, waiting],
    );
  // Grade A all-in = 4000 + 200 + 100 + 50 = 4350; Grade B all-in = 5000.
  await item(gradeA, 4000, 200, 100, 50);
  await item(gradeB, 5000, 0, 0, 0);

  const challan = (gradeId, orderRef) =>
    owner.query(
      `INSERT INTO delivery_challans (id, tenant_id, challan_no, customer_id, order_id, grade_id,
                                      quantity_m3, return_quantity_m3, challan_status, invoice_status)
       VALUES ($1,$2,$3,$4,$5,$6,8,0,'delivered','not_invoiced')`,
      [randomUUID(), TENANT, `BCH-${tag}-${gradeId ? gradeId.slice(0, 4) : 'adhoc'}`, customerId, orderRef, gradeId],
    );
  // One challan per grade (to prove grade-based rate selection) + one ad-hoc
  // challan with NO order (suggested rate must fall back to 0).
  await challan(gradeA, orderId);
  await challan(gradeB, orderId);
  await owner.query(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, customer_id, order_id, grade_id,
                                    quantity_m3, return_quantity_m3, challan_status, invoice_status)
     VALUES ($1,$2,$3,$4,NULL,NULL,6,0,'delivered','not_invoiced')`,
    [randomUUID(), TENANT, `BCH-${tag}-ADHOC`, customerId],
  );

  const res = await fetch(`${API_BASE}/invoices/billable-challans?customerId=${customerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  ok('billable-challans responds 200', res.status === 200);
  const rows = (await res.json())?.data ?? [];
  const byNo = Object.fromEntries(rows.map((r) => [r.challanNo, r]));

  const a = byNo[`BCH-${tag}-${gradeA.slice(0, 4)}`];
  const b = byNo[`BCH-${tag}-${gradeB.slice(0, 4)}`];
  const adhoc = byNo[`BCH-${tag}-ADHOC`];

  ok('all three seeded challans are listed', !!a && !!b && !!adhoc);
  ok('grade-A challan suggests the grade-A all-in rate (4350), not the first line', near(a.suggestedRate, 4350));
  ok('grade-B challan suggests the grade-B all-in rate (5000)', near(b.suggestedRate, 5000));
  ok('the ad-hoc (no-order) challan suggests rate 0', near(adhoc.suggestedRate, 0));
  ok('each challan carries the order return-billing policy (net)', a.returnBillingPolicy === 'net' && b.returnBillingPolicy === 'net');
  ok('billed quantity equals the delivered quantity when nothing is returned', near(a.billedQuantityM3, 8) && near(b.billedQuantityM3, 8));

  await owner.destroy();
  console.log(`\nBILLABLE CHALLANS TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
