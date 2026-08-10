/**
 * Integration test for the M2 Specialist agent + inter-agent escalation.
 * Proves:
 *   - the Specialist runs read-only (actionsUsed 0) and returns cited advisory
 *     findings for compliance and AR risk;
 *   - Monitor can ESCALATE to the Specialist: the escalated run is a real, linked
 *     child (parent_run_id = the Monitor run) and completes;
 *   - an agent with no escalation allow-list (diagnostics) is REFUSED when it
 *     tries to escalate — the run fails;
 *   - the Specialist is in the catalog with its two read tools.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

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
  return (await res.json().catch(() => null))?.data;
}

(async () => {
  await login();

  console.log('=== Specialist agent (advisory, read-only) ===');
  const sp = await api('POST', '/agents/specialist/run', { topic: 'all' });
  ok('the specialist run completes', sp?.status === 'completed');
  ok('it does no write actions (advisory/read-only)', sp?.actionsUsed === 0);
  const res = sp?.outcome?.result;
  ok('it returns compliance findings', Array.isArray(res?.compliance?.findings));
  ok('it returns AR-risk findings', Array.isArray(res?.arRisk?.findings));

  console.log('\n=== Monitor → Specialist escalation ===');
  const mon = await api('POST', '/agents/monitor/run', { stockThreshold: 0, consultSpecialist: true });
  ok('the monitor run completes', mon?.status === 'completed');
  const childId = mon?.outcome?.result?.consultation?.runId;
  ok('monitor recorded a specialist consultation with a child run id', typeof childId === 'string' && childId.length > 0);

  const runs = await api('GET', '/agents/runs', undefined);
  const byId = Object.fromEntries((runs ?? []).map((r) => [r.id, r]));
  const child = byId[childId];
  ok('the escalated child run exists and is a specialist run', child?.agentName === 'specialist');
  ok('the child is linked to the monitor run as its parent', child?.parentRunId === mon.runId);
  ok('the child completed', child?.status === 'completed');
  ok('the child is tagged as an escalation', String(child?.taskKind || '').startsWith('escalation:'));

  console.log('\n=== escalation scope enforcement ===');
  const diag = await api('POST', '/agents/diagnostics/run', { tryEscalate: true });
  ok('an agent with no allow-list is refused when it escalates', diag?.status === 'failed');
  ok('the refusal mentions escalation', /escalate/i.test(diag?.reason ?? ''));

  console.log('\n=== catalog ===');
  const cat = await api('GET', '/agents/catalog');
  const spec = (cat ?? []).find((a) => a.name === 'specialist');
  ok('the specialist is registered with two read tools', spec?.tools?.length === 2);

  console.log(`\nAGENT SPECIALIST TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
