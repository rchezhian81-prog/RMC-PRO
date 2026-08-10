/**
 * Integration test for the M1 read-only agents (Data-Analysis + Monitor). Drives
 * them through the kernel over the API and proves:
 *   - each run completes and does ZERO write actions (they are read-only);
 *   - the Data-Analysis result carries a well-formed numeric KPI snapshot and a
 *     top-customers array;
 *   - the Monitor result carries an alerts array;
 *   - both agents are in the catalog with their read-only tool allow-lists.
 *
 * Value assertions are structural (numbers are numbers, arrays are arrays) so the
 * test is robust whether or not other suites have populated the fixture tenant.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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

  console.log('=== Data-Analysis agent (read-only) ===');
  const da = await api('POST', '/agents/data-analysis/run', { windowDays: 30, topN: 5 });
  ok('the data-analysis run completes', da?.status === 'completed');
  ok('it does no write actions (read-only)', da?.actionsUsed === 0);
  const sum = da?.outcome?.result?.summary;
  ok('the KPI summary is present', !!sum && sum.windowDays === 30);
  ok('revenue, tax, receipts and outstanding are numeric', isNum(sum.invoices.revenue) && isNum(sum.invoices.tax) && isNum(sum.receipts) && isNum(sum.outstanding.total));
  ok('order and invoice counts are numeric', isNum(sum.orders.count) && isNum(sum.invoices.count));
  ok('top customers is an array', Array.isArray(da?.outcome?.result?.topCustomers));

  console.log('\n=== Monitor agent (read-only) ===');
  const mon = await api('POST', '/agents/monitor/run', { stockThreshold: 0 });
  ok('the monitor run completes', mon?.status === 'completed');
  ok('it does no write actions (read-only)', mon?.actionsUsed === 0);
  ok('it returns an alerts array with a count', Array.isArray(mon?.outcome?.result?.alerts) && isNum(mon.outcome.result.alertCount));

  console.log('\n=== catalog ===');
  const cat = await api('GET', '/agents/catalog');
  const byName = Object.fromEntries((cat ?? []).map((a) => [a.name, a]));
  ok('data-analysis is registered with two read tools', byName['data-analysis']?.tools?.length === 2);
  ok('monitor is registered with one read tool', byName['monitor']?.tools?.length === 1);

  console.log(`\nAGENT INSIGHT TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
