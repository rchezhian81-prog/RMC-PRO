/**
 * Dashboard trends endpoint test (GET /dashboard/trends).
 *
 * Proves the read-only daily activity trend-lines contract:
 *   - default 30-day window; one series per default metric, in catalogue order
 *   - each series is DENSE: exactly `days` points, one per day, contiguous and
 *     ascending from `from` to `to` (the server gap-fills via a date spine)
 *   - values are non-negative numbers
 *   - `days` is honoured and clamped to 7–90
 *   - `metrics` selects a subset; unknown keys are ignored, not an error
 *   - the route is protected (401 without a token)
 *
 * Shape-level (does not seed dated rows): the gap-fill + window maths are what
 * can go wrong, and they hold regardless of how much data the tenant has.
 *
 * Env (from run-integration.mjs): API_BASE / API_PORT, LOGIN, RMC_PASSWORD.
 */
const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
const LOGIN = process.env.LOGIN ?? 'owner@ci.test';
const PW = process.env.RMC_PASSWORD ?? 'OwnerCI#12345';

const DAY = 86_400_000;
const parseDay = (s) => new Date(s + 'T00:00:00Z').getTime();

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

async function token() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PW }),
  });
  const j = await r.json();
  if (!j?.data?.access_token) throw new Error('login failed: ' + JSON.stringify(j));
  return j.data.access_token;
}

async function get(path, tok) {
  const r = await fetch(`${BASE}${path}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** A dense series: exactly `days` contiguous ascending points from→to, v≥0. */
function assertDense(series, days, from, to) {
  ok(`  [${series.key}] has exactly ${days} points`, Array.isArray(series.points) && series.points.length === days);
  ok(`  [${series.key}] first point === from (${from})`, series.points[0]?.d === from);
  ok(`  [${series.key}] last point === to (${to})`, series.points[series.points.length - 1]?.d === to);
  let contiguous = true, nonneg = true;
  for (let i = 0; i < series.points.length; i++) {
    const p = series.points[i];
    if (typeof p.v !== 'number' || !(p.v >= 0)) nonneg = false;
    if (i > 0 && parseDay(p.d) - parseDay(series.points[i - 1].d) !== DAY) contiguous = false;
  }
  ok(`  [${series.key}] points are contiguous, one day apart`, contiguous);
  ok(`  [${series.key}] every value is a number >= 0`, nonneg);
}

(async () => {
  const tok = await token();

  console.log('=== default window (30 days), default metrics ===');
  const def = await get('/dashboard/trends', tok);
  ok('GET /dashboard/trends → 200', def.status === 200 && def.body?.success === true);
  const d = def.body.data;
  ok('days === 30 (default)', d.days === 30);
  ok('from/to are YYYY-MM-DD strings', /^\d{4}-\d{2}-\d{2}$/.test(d.from) && /^\d{4}-\d{2}-\d{2}$/.test(d.to));
  ok('window spans exactly days-1 between from and to', parseDay(d.to) - parseDay(d.from) === (d.days - 1) * DAY);
  ok('default series are invoiced, collected, produced, dispatched (in order)',
    d.series.map((s) => s.key).join(',') === 'invoiced,collected,produced,dispatched');
  ok('collected series is unit=inr, others count',
    d.series.find((s) => s.key === 'collected')?.unit === 'inr' &&
    d.series.filter((s) => s.key !== 'collected').every((s) => s.unit === 'count'));
  for (const s of d.series) assertDense(s, d.days, d.from, d.to);

  console.log('=== days param honoured + clamped ===');
  const w7 = (await get('/dashboard/trends?days=7', tok)).body.data;
  ok('days=7 → 7 points per series', w7.days === 7 && w7.series[0].points.length === 7);
  const wHi = (await get('/dashboard/trends?days=1000', tok)).body.data;
  ok('days=1000 clamps to 90', wHi.days === 90 && wHi.series[0].points.length === 90);
  const wLo = (await get('/dashboard/trends?days=1', tok)).body.data;
  ok('days=1 clamps up to 7', wLo.days === 7 && wLo.series[0].points.length === 7);

  console.log('=== metrics subset + unknown-key tolerance ===');
  const one = (await get('/dashboard/trends?metrics=invoiced', tok)).body.data;
  ok('metrics=invoiced → single invoiced series', one.series.length === 1 && one.series[0].key === 'invoiced');
  const mixed = (await get('/dashboard/trends?metrics=collected,bogus,ordered', tok)).body.data;
  ok('unknown metric ignored (collected,ordered kept in catalogue order)',
    mixed.series.map((s) => s.key).join(',') === 'collected,ordered');

  console.log('=== auth ===');
  const noauth = await get('/dashboard/trends');
  ok('no token → 401', noauth.status === 401);

  console.log(`\nDASHBOARD-TRENDS TEST: ${pass} checks passed ✓`);
  process.exit(0);
})().catch((e) => { console.error('\nDASHBOARD-TRENDS TEST FAILED:', e.message); process.exit(1); });
