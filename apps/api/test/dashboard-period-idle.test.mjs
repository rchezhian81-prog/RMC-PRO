/**
 * Dashboard period, idle sign-out setting and alert severity.
 *
 *   - security.idle_timeout_minutes is in the settings catalogue (default 30),
 *     round-trips through PUT /settings/:key, refuses a negative or fractional
 *     value, and clears back to the default on an empty value
 *   - GET /settings/idle-timeout answers any signed-in user of the company —
 *     one without settings.manage, who is still refused the write
 *   - GET /dashboard/summary without from/to is the all-time answer (period
 *     null); with a window the event figures follow it while the live figures
 *     (outstanding, stock, loads on the road, credit holds, devices) do not
 *   - GET /dashboard/operations-funnel follows the window for every step
 *   - a window wider than 366 days, a backwards one, a half one and a bad date
 *     are each a 400
 *   - every alert carries severity high | medium | low and its tone, high first
 *
 * The funnel check books one lead and then removes it (and the lead number
 * series row it may have started) straight from the database, so the pilot
 * tenant is left exactly as found: the numbering cold-start test later in the
 * suite relies on no lead having ever taken number 1.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN || 'owner@ci.test';
const PW = process.env.RMC_PASSWORD || 'OwnerCI#12345';
const TENANT = process.env.TEST_TENANT_ID;

/** The DB owner connection the other suites use for their own clean-up. */
async function ownerDb() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    username: process.env.POSTGRES_USER ?? 'rmc_owner',
    password: process.env.POSTGRES_PASSWORD ?? 'ownerpw',
    database: process.env.POSTGRES_DB ?? 'rmc',
  });
  await ds.initialize();
  return ds;
}

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

async function raw(method, path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function api(method, path, body, token) {
  const r = await raw(method, path, body, token);
  if (r.status >= 400 || !r.body?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data;
}
const login = async (l, p) => (await api('POST', '/auth/login', { login: l, password: p })).access_token;

const IDLE_KEY = 'security.idle_timeout_minutes';
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86_400_000));
// "Now" as a three-day window, so a clock on either side of midnight (the
// test's UTC date vs the database's session date) still contains the lead.
const NOW_FROM = daysAgo(1);
const NOW_TO = daysAgo(-1);

(async () => {
  const owner = await login(LOGIN, PW);

  console.log('=== idle sign-out setting: catalogue, round-trip, validation ===');
  const list0 = await api('GET', '/settings', null, owner);
  const def = list0.find((r) => r.key === IDLE_KEY);
  ok('the setting is in the catalogue as a number', def && def.type === 'number');
  ok('its default is 30 minutes', def.value === '30');
  ok('it carries a description', typeof def.description === 'string' && def.description.length > 20);
  const pub0 = await api('GET', '/settings/idle-timeout', null, owner);
  ok('GET /settings/idle-timeout answers the default { minutes: 30 }', pub0.minutes === 30);

  await api('PUT', `/settings/${IDLE_KEY}`, { value: '45' }, owner);
  const pub45 = await api('GET', '/settings/idle-timeout', null, owner);
  ok('after PUT 45 the public read answers 45', pub45.minutes === 45);
  const list45 = await api('GET', '/settings', null, owner);
  ok('the settings list carries the stored value', list45.find((r) => r.key === IDLE_KEY)?.value === '45');

  await api('PUT', `/settings/${IDLE_KEY}`, { value: '0' }, owner);
  ok('0 (never) round-trips as 0', (await api('GET', '/settings/idle-timeout', null, owner)).minutes === 0);

  const neg = await raw('PUT', `/settings/${IDLE_KEY}`, { value: '-5' }, owner);
  ok('a negative value is refused (400)', neg.status === 400 && neg.body?.error?.code === 'VALIDATION_ERROR');
  const frac = await raw('PUT', `/settings/${IDLE_KEY}`, { value: '12.5' }, owner);
  ok('a fractional value is refused (400)', frac.status === 400);
  const huge = await raw('PUT', `/settings/${IDLE_KEY}`, { value: '5000' }, owner);
  ok('a value over a day is refused (400)', huge.status === 400);
  ok('the refusals left the stored value alone', (await api('GET', '/settings/idle-timeout', null, owner)).minutes === 0);

  await api('PUT', `/settings/${IDLE_KEY}`, { value: '' }, owner);
  ok('an empty value clears back to the default 30', (await api('GET', '/settings/idle-timeout', null, owner)).minutes === 30);

  console.log('=== the public read is open to a user without settings.manage ===');
  const SFX = Date.now().toString(36).slice(-6);
  const plainEmail = `idle.plain.${SFX}@ci.test`;
  const PLAIN_PW = 'PlainUser#12345';
  await api('POST', '/users', { name: 'Idle Plain', email: plainEmail, password: PLAIN_PW }, owner);
  const plain = await login(plainEmail, PLAIN_PW);
  const plainRead = await raw('GET', '/settings/idle-timeout', null, plain);
  ok('a user with no roles reads the idle window (200)', plainRead.status === 200 && plainRead.body?.data?.minutes === 30);
  const plainWrite = await raw('PUT', `/settings/${IDLE_KEY}`, { value: '10' }, plain);
  ok('the same user cannot change it (403)', plainWrite.status === 403);
  const anon = await raw('GET', '/settings/idle-timeout', null, '');
  ok('no token → 401', anon.status === 401);

  console.log('=== dashboard summary: all time vs a period, live figures untouched ===');
  const all = await api('GET', '/dashboard/summary', null, owner);
  ok('without from/to the period is null (all time)', all.period === null);
  ok('the response names the period and live metrics', Array.isArray(all.periodMetrics) && Array.isArray(all.live) && all.live.includes('billing.outstandingTotal') && all.periodMetrics.includes('billing.receiptsTotal'));
  ok('the m³ figures are present and numeric', typeof all.production.batchedM3 === 'number' && typeof all.dispatch.deliveredM3 === 'number');

  const past = await api('GET', '/dashboard/summary?from=2000-01-01&to=2000-01-31', null, owner);
  ok('the period is echoed back', past.period?.from === '2000-01-01' && past.period?.to === '2000-01-31');
  ok('event figures in an empty window are zero',
    past.orders.confirmed === 0 && past.production.batchTicketsConfirmed === 0 && past.production.batchedM3 === 0 &&
    past.dispatch.delivered === 0 && past.dispatch.deliveredM3 === 0 && past.billing.invoicesIssued === 0 &&
    past.billing.invoicedTotal === 0 && past.billing.receiptsTotal === 0);
  ok('live figures are the same whatever the window',
    past.billing.outstandingTotal === all.billing.outstandingTotal && past.inventory.lowStock === all.inventory.lowStock &&
    past.inventory.negativeStock === all.inventory.negativeStock && past.dispatch.active === all.dispatch.active &&
    past.dispatch.uninvoiced === all.dispatch.uninvoiced && past.creditHoldsPending === all.creditHoldsPending &&
    past.orders.draft === all.orders.draft && past.orders.creditHold === all.orders.creditHold && past.devices === all.devices);

  const year = await api('GET', `/dashboard/summary?from=${daysAgo(364)}&to=${NOW_TO}`, null, owner);
  ok('a window never exceeds the all-time figures',
    year.orders.confirmed <= all.orders.confirmed && year.billing.invoicesIssued <= all.billing.invoicesIssued &&
    year.billing.receiptsTotal <= all.billing.receiptsTotal && year.dispatch.delivered <= all.dispatch.delivered);

  console.log('=== funnel follows the period (a lead booked today) ===');
  const db = TENANT ? await ownerDb() : null;
  const seriesBefore = db ? Number((await db.query(`SELECT count(*)::int AS n FROM number_series WHERE tenant_id = $1 AND document_type = 'lead'`, [TENANT]))[0].n) : 0;
  const fPast0 = await api('GET', '/dashboard/operations-funnel?from=2000-01-01&to=2000-01-31', null, owner);
  const fToday0 = await api('GET', `/dashboard/operations-funnel?from=${NOW_FROM}&to=${NOW_TO}`, null, owner);
  const LEAD_NAME = `Period Lead ${SFX}`;
  await api('POST', '/leads', { customerName: LEAD_NAME, mobile: '9842000000', siteLocation: 'Coimbatore' }, owner);
  const fToday1 = await api('GET', `/dashboard/operations-funnel?from=${NOW_FROM}&to=${NOW_TO}`, null, owner);
  const fPast1 = await api('GET', '/dashboard/operations-funnel?from=2000-01-01&to=2000-01-31', null, owner);
  const fAll = await api('GET', '/dashboard/operations-funnel', null, owner);
  ok("today's window counts the new lead", fToday1.leads === fToday0.leads + 1);
  ok('a window in the past does not', fPast1.leads === fPast0.leads && fPast1.leads === 0);
  ok('all time counts at least as many as today', fAll.period === null && fAll.leads >= fToday1.leads);
  ok('the funnel echoes its period', fToday1.period?.from === NOW_FROM && fToday1.period?.to === NOW_TO);
  if (db) {
    // Leave the tenant as found: the lead goes, and so does a lead series row
    // this test started (a later suite proves the series' cold start).
    await db.query(`DELETE FROM leads WHERE tenant_id = $1 AND customer_name = $2`, [TENANT, LEAD_NAME]);
    if (seriesBefore === 0) await db.query(`DELETE FROM number_series WHERE tenant_id = $1 AND document_type = 'lead'`, [TENANT]);
    const fAfter = await api('GET', `/dashboard/operations-funnel?from=${NOW_FROM}&to=${NOW_TO}`, null, owner);
    ok('the lead is gone again (clean-up)', fAfter.leads === fToday0.leads);
    await db.destroy();
  }

  console.log('=== period validation ===');
  const wide = await raw('GET', '/dashboard/summary?from=2024-01-01&to=2025-01-01', null, owner);
  ok('367 days is refused (400)', wide.status === 400 && wide.body?.error?.code === 'VALIDATION_ERROR');
  const leap = await raw('GET', '/dashboard/summary?from=2024-01-01&to=2024-12-31', null, owner);
  ok('366 days (a leap year) is accepted', leap.status === 200);
  const wideFunnel = await raw('GET', '/dashboard/operations-funnel?from=2023-01-01&to=2024-06-30', null, owner);
  ok('the funnel refuses a wide window too', wideFunnel.status === 400);
  const back = await raw('GET', '/dashboard/summary?from=2024-02-01&to=2024-01-01', null, owner);
  ok('from after to is refused', back.status === 400);
  const half = await raw('GET', '/dashboard/summary?from=2024-01-01', null, owner);
  ok('from without to is refused', half.status === 400);
  const junk = await raw('GET', '/dashboard/summary?from=2024-02-30&to=2024-03-01', null, owner);
  ok('a date that does not exist is refused', junk.status === 400);
  const fmt = await raw('GET', '/dashboard/summary?from=01-01-2024&to=02-01-2024', null, owner);
  ok('a date not in YYYY-MM-DD form is refused', fmt.status === 400);

  console.log('=== alerts carry a severity word ===');
  const { alerts } = await api('GET', '/alerts', null, owner);
  ok('the owner has at least one alert (the month context line)', Array.isArray(alerts) && alerts.length >= 1);
  const SEV = ['high', 'medium', 'low'];
  const TONE = ['danger', 'warning', 'info'];
  ok('every alert has severity high | medium | low', alerts.every((a) => SEV.includes(a.severity)));
  ok('every alert keeps its tone', alerts.every((a) => TONE.includes(a.tone)));
  ok('tone and severity agree', alerts.every((a) => SEV.indexOf(a.severity) === TONE.indexOf(a.tone)));
  const ranks = alerts.map((a) => SEV.indexOf(a.severity));
  ok('alerts are sorted high → medium → low', ranks.every((r, i) => i === 0 || r >= ranks[i - 1]));
  const month = alerts.find((a) => a.key === 'sales_this_month');
  ok('the informational month line is low', month?.severity === 'low');

  console.log(`\nDASHBOARD-PERIOD-IDLE TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nDASHBOARD-PERIOD-IDLE TEST FAILED:', e.message); process.exit(1); });
