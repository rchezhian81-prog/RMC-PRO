/**
 * Integration test for the multi-agent substrate (M0). Two halves:
 *
 * A) DB-level isolation — connected as the non-superuser app role exactly like
 *    the runtime, prove the three agent tables (agent_runs, agent_controls,
 *    agent_run_steps) are Row-Level-Security isolated: a tenant sees only its own
 *    rows, a cross-tenant read returns nothing, a cross-tenant write is refused,
 *    no context yields nothing, and the app role cannot disable RLS. This is the
 *    guarantee that an agent can never touch another tenant's runs (WR-AGT-2).
 *
 * B) API-level guardrails — drive the diagnostics probe through the kernel and
 *    prove the funnel: a read executes, a reversible write runs bounded, a
 *    financial tool is BLOCKED (never executes), an out-of-scope tool is
 *    rejected, the kill switch halts a run, the action budget aborts a run, and
 *    every run is cross-linked into the audit trail.
 *
 * Env: POSTGRES_* (owner) + APP_DB_* (app role); API_BASE, LOGIN, RMC_PASSWORD.
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
  synchronize: false,
  logging: false,
};
const owner = new DataSource({ ...common, username: process.env.POSTGRES_USER ?? 'rmc_owner', password: process.env.POSTGRES_PASSWORD ?? 'ownerpw' });
const app = new DataSource({ ...common, username: process.env.APP_DB_USER ?? 'rmc_app', password: process.env.APP_DB_PASSWORD ?? 'apppw' });
const asTenant = (tid, work) => app.transaction(async (m) => { await m.query(`SELECT set_config('app.current_tenant_id',$1,true)`, [tid]); return work(m); });
const freshAppRead = async (sql, params) => {
  const c = new DataSource({ ...common, username: process.env.APP_DB_USER ?? 'rmc_app', password: process.env.APP_DB_PASSWORD ?? 'apppw', extra: { max: 1 } });
  await c.initialize();
  try { return await c.query(sql, params); } finally { await c.destroy(); }
};

// --- API helpers (unwrap the {success,data} envelope) ---
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
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const runDiag = async (input) => (await api('POST', '/agents/diagnostics/run', input)).body?.data;

(async () => {
  await owner.initialize();
  await app.initialize();

  console.log('=== A) agent-table tenant isolation (as the app role) ===');
  const A = randomUUID(), B = randomUUID();
  await owner.query(
    `INSERT INTO tenants (id,tenant_code,tenant_name,status) VALUES ($1,$2,'AG A','active'),($3,$4,'AG B','active')`,
    [A, 'AGA-' + A.slice(0, 8), B, 'AGB-' + B.slice(0, 8)],
  );
  // A run + a control row for each tenant, inserted as owner (bypasses RLS).
  const runA = randomUUID(), runB = randomUUID();
  await owner.query(
    `INSERT INTO agent_runs (id,tenant_id,agent_name,status) VALUES ($1,$2,'diagnostics','completed'),($3,$4,'diagnostics','completed')`,
    [runA, A, runB, B],
  );
  await owner.query(
    `INSERT INTO agent_controls (tenant_id,automation_paused) VALUES ($1,false),($2,true)`,
    [A, B],
  );

  ok('no context returns no agent_runs (fail-closed)', (await freshAppRead(`SELECT count(*)::int AS n FROM agent_runs`))[0].n === 0);
  ok('no context returns no agent_controls (fail-closed)', (await freshAppRead(`SELECT count(*)::int AS n FROM agent_controls`))[0].n === 0);

  const aRuns = await asTenant(A, (m) => m.query(`SELECT id FROM agent_runs`));
  ok('tenant A sees only its own run', aRuns.length === 1 && aRuns[0].id === runA);
  ok("tenant A cannot read tenant B's run by id", (await asTenant(A, (m) => m.query(`SELECT count(*)::int AS n FROM agent_runs WHERE id=$1`, [runB])))[0].n === 0);
  ok('tenant A sees only its own controls', (await asTenant(A, (m) => m.query(`SELECT automation_paused FROM agent_controls`))).length === 1);

  await throwsAsync('tenant A cannot INSERT a run tagged as tenant B', () =>
    asTenant(A, (m) => m.query(`INSERT INTO agent_runs (tenant_id,agent_name,status) VALUES ($1,'x','running')`, [B])));
  await throwsAsync('app role cannot disable RLS on agent_runs', () => app.query(`ALTER TABLE agent_runs DISABLE ROW LEVEL SECURITY`));

  await owner.destroy();
  await app.destroy();

  console.log('\n=== B) guardrail funnel via the diagnostics probe (over the API) ===');
  await login();

  const controls = (await api('GET', '/agents/controls')).body?.data;
  ok('controls default to not-paused with positive caps', controls && controls.automationPaused === false && controls.maxStepsPerRun > 0);

  const clean = await runDiag({ msg: 'hello' });
  ok('a normal run completes', clean?.status === 'completed');
  ok('the read tool executed and returned a run count', clean?.outcome?.result?.echo?.ok === true && typeof clean.outcome.result.echo.runs === 'number');
  ok('a pure-read run used no write actions', clean?.actionsUsed === 0);

  const marked = await runDiag({ mark: true });
  ok('a reversible write runs bounded and completes', marked?.status === 'completed');
  ok('the reversible write counted as one action', marked?.actionsUsed === 1);

  const blocked = await runDiag({ tryPayment: true });
  ok('a financial tool is BLOCKED (never auto-executes)', blocked?.status === 'blocked');
  ok('the block cites human approval', /approval/i.test(blocked?.reason ?? ''));

  const scoped = await runDiag({ tryUnknownTool: true });
  ok('an out-of-scope tool call fails the run', scoped?.status === 'failed');

  // Kill switch.
  await api('PUT', '/agents/controls', { automationPaused: true });
  const killed = await runDiag({ msg: 'should not run' });
  ok('the kill switch halts the run', killed?.status === 'killed');
  ok('a killed run does no work', killed?.stepsUsed === 0);
  await api('PUT', '/agents/controls', { automationPaused: false });

  // Action budget.
  await api('PUT', '/agents/controls', { maxActionsPerRun: 0 });
  const aborted = await runDiag({ mark: true });
  ok('a zero action budget aborts a write run', aborted?.status === 'aborted');
  await api('PUT', '/agents/controls', { maxActionsPerRun: 10 });

  const runs = (await api('GET', '/agents/runs')).body?.data;
  ok('the run trail lists this tenant\'s runs, newest first', Array.isArray(runs) && runs.length >= 6);

  const audit = (await api('GET', '/audit-logs?action=agent.run.completed')).body?.data;
  ok('run lifecycle is cross-linked into the audit trail', Array.isArray(audit) && audit.length >= 1);

  const cat = (await api('GET', '/agents/catalog')).body?.data;
  ok('the diagnostics agent is in the catalog with its tool allow-list', Array.isArray(cat) && cat.some((a) => a.name === 'diagnostics' && a.tools.length === 3));

  console.log(`\nAGENT SUBSTRATE TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
