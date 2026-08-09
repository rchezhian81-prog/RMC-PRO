/**
 * Integration test for the /metrics Prometheus endpoint. Drives the booted API:
 * the scrape is token-gated (401 without / with a wrong token), returns the raw
 * exposition (not the JSON envelope), and reflects real traffic — the login
 * request appears in http_requests_total, and the scrape itself is not counted.
 *
 * Env (from run-integration.mjs): API_URL, API_BASE, METRICS_TOKEN, LOGIN,
 * RMC_PASSWORD.
 */
const ROOT = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const BASE = process.env.API_BASE ?? `${ROOT}/api/v1`;
const TOKEN = process.env.METRICS_TOKEN;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

(async () => {
  // Make sure at least one request is on record for a known route.
  await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
  });

  console.log('=== /metrics scrape ===');
  ok('scrape without a token is 401', (await fetch(`${ROOT}/metrics`)).status === 401);
  ok('scrape with a wrong token is 401', (await fetch(`${ROOT}/metrics`, { headers: { Authorization: 'Bearer nope' } })).status === 401);

  const res = await fetch(`${ROOT}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await res.text();
  ok('scrape with the token is 200', res.status === 200);
  ok('content-type is Prometheus text', (res.headers.get('content-type') || '').includes('text/plain'));
  ok('the body is raw exposition, not the JSON envelope', !body.trimStart().startsWith('{'));
  ok('exposes the requests counter with HELP/TYPE', body.includes('# TYPE http_requests_total counter'));
  ok('recorded the login request as a series', /http_requests_total\{method="POST",route="\/api\/v1\/auth\/login",status="\d+"\} \d+/.test(body));
  ok('exposes the duration histogram', body.includes('http_request_duration_seconds_bucket'));
  ok('exposes process + build gauges', body.includes('process_resident_memory_bytes') && body.includes('rmc_build_info'));
  ok('the scrape endpoint does not count itself', !/route="\/metrics"/.test(body));

  console.log(`\nMETRICS TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
