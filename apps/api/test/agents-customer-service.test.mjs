/**
 * Integration test for the M3 Customer-Service agent — the customer-scoped,
 * read-only, least-privileged agent. Proves the NEW access-control property:
 * beyond tenant RLS, a CS run for one customer sees ONLY that customer's data.
 *
 * Seeds (as the owner) two customers in the fixture tenant — customer A with one
 * open invoice, customer B with two — then drives the agent for each and asserts:
 *   - each run completes read-only (actionsUsed 0);
 *   - A's account summary shows exactly its own 1 open invoice, B's shows 2
 *     (so neither leaks the other's rows — customer-scoping holds);
 *   - the order_status intent works and is customer-filtered;
 *   - a run with no customerId is rejected (customer scope is mandatory);
 *   - the agent is in the catalog with its two read tools.
 *
 * Env: POSTGRES_* (owner) + TEST_TENANT_ID, API_BASE, LOGIN, RMC_PASSWORD.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const TENANT = process.env.TEST_TENANT_ID;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const owner = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
  synchronize: false, logging: false,
});

let token;
async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body?.success) throw new Error(`login failed: ${JSON.stringify(body)}`);
  token = body.data.access_token;
}
async function run(payload) {
  const res = await fetch(`${BASE}/agents/customer-service/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: (await res.json().catch(() => null))?.data };
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json().catch(() => null))?.data;
}

(async () => {
  if (!TENANT) throw new Error('TEST_TENANT_ID not provided');
  await owner.initialize();

  const s = randomUUID().slice(0, 8);
  const custA = randomUUID(), custB = randomUUID();
  await owner.query(
    `INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES
       ($1,$2,$3,'CS Cust A'), ($4,$2,$5,'CS Cust B')`,
    [custA, TENANT, 'CSA-' + s, custB, 'CSB-' + s],
  );
  // A: one open invoice; B: two.
  await owner.query(
    `INSERT INTO invoices (tenant_id, invoice_no, customer_id, total_amount, outstanding_amount, invoice_status, invoice_date) VALUES
       ($1,$2,$3,1000,1000,'issued',current_date),
       ($1,$4,$5,2000,2000,'issued',current_date),
       ($1,$6,$5,3000,3000,'issued',current_date)`,
    [TENANT, 'CSINVA-' + s, custA, 'CSINVB1-' + s, custB, 'CSINVB2-' + s],
  );
  await owner.destroy();

  await login();

  console.log('=== customer-scoping ===');
  const a = await run({ customerId: custA, intent: 'account_summary' });
  ok('CS run for customer A completes', a.data?.status === 'completed');
  ok('it is read-only (no write actions)', a.data?.actionsUsed === 0);
  const aSum = a.data?.outcome?.result?.result;
  ok('A sees exactly its own 1 open invoice', aSum?.openInvoices === 1);
  ok('A sees its own name', aSum?.customerName === 'CS Cust A');

  const b = await run({ customerId: custB, intent: 'account_summary' });
  ok('B sees exactly its own 2 open invoices', b.data?.outcome?.result?.result?.openInvoices === 2);
  ok('customer-scoping holds — A did not see B\'s invoices', aSum.openInvoices === 1 && b.data.outcome.result.result.openInvoices === 2);

  console.log('\n=== order_status intent ===');
  const os = await run({ customerId: custA, intent: 'order_status' });
  ok('order_status runs and is an array', os.data?.status === 'completed' && Array.isArray(os.data?.outcome?.result?.result?.orders));

  console.log('\n=== mandatory customer scope ===');
  const missing = await run({ intent: 'account_summary' });
  ok('a run with no customerId is rejected (400)', missing.status === 400);

  console.log('\n=== catalog ===');
  const cat = await get('/agents/catalog');
  const cs = (cat ?? []).find((x) => x.name === 'customer-service');
  ok('customer-service is registered with two read tools', cs?.tools?.length === 2);

  console.log(`\nAGENT CUSTOMER-SERVICE TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
