/**
 * Integration test for the M4 Automation agent + the L2 approval substrate.
 * Two halves:
 *
 * A) DB isolation — the new agent_approval_requests table is RLS-isolated exactly
 *    like the rest (fail-closed, cross-tenant read/write refused, RLS on).
 *
 * B) The prepare-and-approve workflow, over the API:
 *    - the Automation agent PREPARES an action (a reversible L3 write) → a pending
 *      approval request; it does NOT execute it;
 *    - a human lists the pending queue, approves it (status → approved), and a
 *      second decision on the same request is refused (409, decided-once);
 *    - rejecting a fresh prepared action works;
 *    - a financial commit is BLOCKED (the run ends 'blocked', nothing executed).
 *
 * Env: POSTGRES_* (owner) + APP_DB_*; API_BASE, LOGIN, RMC_PASSWORD.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const throwsAsync = async (name, fn) => { try { await fn(); ok(name + ' (should be refused)', false); } catch { ok(name + ' refused', true); } };

const common = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc',
  synchronize: false, logging: false,
};
const owner = new DataSource({ ...common, username: process.env.POSTGRES_USER ?? 'rmc_owner', password: process.env.POSTGRES_PASSWORD ?? 'ownerpw' });
const app = new DataSource({ ...common, username: process.env.APP_DB_USER ?? 'rmc_app', password: process.env.APP_DB_PASSWORD ?? 'apppw' });
const asTenant = (tid, work) => app.transaction(async (m) => { await m.query(`SELECT set_config('app.current_tenant_id',$1,true)`, [tid]); return work(m); });

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
async function api(method, path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => null))?.data };
}

(async () => {
  await owner.initialize();
  await app.initialize();

  console.log('=== A) agent_approval_requests isolation ===');
  const A = randomUUID(), B = randomUUID();
  await owner.query(
    `INSERT INTO tenants (id,tenant_code,tenant_name,status) VALUES ($1,$2,'AP A','active'),($3,$4,'AP B','active')`,
    [A, 'APA-' + A.slice(0, 8), B, 'APB-' + B.slice(0, 8)],
  );
  await owner.query(
    `INSERT INTO agent_approval_requests (tenant_id, agent_name, action_kind, title, status) VALUES
       ($1,'automation','x','A req','pending'), ($2,'automation','x','B req','pending')`,
    [A, B],
  );
  const aRows = await asTenant(A, (m) => m.query(`SELECT title FROM agent_approval_requests`));
  ok('tenant A sees only its own approval request', aRows.length === 1 && aRows[0].title === 'A req');
  await throwsAsync('tenant A cannot INSERT an approval tagged as tenant B', () =>
    asTenant(A, (m) => m.query(`INSERT INTO agent_approval_requests (tenant_id,agent_name,action_kind,title) VALUES ($1,'x','x','hack')`, [B])));
  await throwsAsync('app role cannot disable RLS on agent_approval_requests', () =>
    app.query(`ALTER TABLE agent_approval_requests DISABLE ROW LEVEL SECURITY`));
  await owner.destroy();
  await app.destroy();

  console.log('\n=== B) prepare → approve / reject / block ===');
  await login();

  const run1 = await api('POST', '/agents/automation/run', { actionKind: 'payment_reminder', title: 'Reminder for INV', reversibility: 'irreversible' });
  ok('the automation run completes', run1.data?.status === 'completed');
  ok('preparing counted as one reversible write action', run1.data?.actionsUsed === 1);
  const approvalId = run1.data?.outcome?.result?.prepared?.approvalId;
  ok('it produced a PENDING approval request (prepared, not executed)', typeof approvalId === 'string' && run1.data.outcome.result.prepared.status === 'pending');

  const pending = await api('GET', '/agents/approvals?status=pending');
  ok('the prepared action is in the pending queue', Array.isArray(pending.data) && pending.data.some((r) => r.id === approvalId));

  const dec = await api('POST', `/agents/approvals/${approvalId}/decide`, { decision: 'approved', reason: 'ok to send' });
  ok('a human can approve it', dec.status === 201 && dec.data?.status === 'approved');
  const again = await api('POST', `/agents/approvals/${approvalId}/decide`, { decision: 'rejected' });
  ok('a second decision on the same request is refused (decided once)', again.status === 409);

  const run2 = await api('POST', '/agents/automation/run', { actionKind: 'payment_reminder', title: 'Second' });
  const id2 = run2.data?.outcome?.result?.prepared?.approvalId;
  const rej = await api('POST', `/agents/approvals/${id2}/decide`, { decision: 'rejected', reason: 'not now' });
  ok('a prepared action can be rejected', rej.data?.status === 'rejected');

  const blocked = await api('POST', '/agents/automation/run', { tryCommit: true });
  ok('a financial commit is BLOCKED (nothing executed)', blocked.data?.status === 'blocked');
  ok('the block cites approval', /approval/i.test(blocked.data?.reason ?? ''));
  ok('a blocked run performed no write actions', blocked.data?.actionsUsed === 0);

  const cat = await api('GET', '/agents/catalog');
  const auto = (cat.data ?? []).find((a) => a.name === 'automation');
  ok('the automation agent is in the catalog with its tools', auto?.tools?.length === 6);

  console.log(`\nAGENT AUTOMATION TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
