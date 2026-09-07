/**
 * Financial-year roll-over numbering (data-integrity item I6).
 *
 * A yearly-reset series used to reset the SAME row to 0 on the first allocation
 * of a new FY and re-issue last year's strings — the document table's unique
 * index then rejected every allocation for every numbered document type until
 * an admin edited ~20 series. Now each FY gets its own series row, numbered
 * from 1 with the FY token in its suffix (RCPT0001/26-27), reservations carry
 * the suffix so devices format identically, 'never'-reset and legacy rows keep
 * their counters, and a series counter can never be moved backwards.
 *
 * The FY boundary is simulated by stamping the live `receipt` series with LAST
 * year's FY, which is exactly the state on 1 April.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
if (!TENANT) { console.error('TEST_TENANT_ID required'); process.exit(1); }

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
const TODAY = new Date().toISOString().slice(0, 10);

// Indian FY of today, e.g. 2026-09-07 → "2026-27"; last FY → "2025-26"; tokens "/26-27", "/25-26".
const now = new Date();
const startYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const fy = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
const CUR_FY = fy(startYear);
const PREV_FY = fy(startYear - 1);
const CUR_TOKEN = `/${String(startYear).slice(2)}-${String((startYear + 1) % 100).padStart(2, '0')}`;

const C = randomUUID();
await q(`INSERT INTO customers (id, tenant_id, customer_code, customer_name) VALUES ($1, $2, $3, 'FY Co')`, [C, TENANT, `FY-${tag}`]);
const receipt = () => post('/receipts', { customerId: C, amount: 10, paymentMode: 'cash', receiptDate: TODAY });
const series = (fyv) => one(`SELECT id, prefix, suffix, current_number, financial_year FROM number_series WHERE tenant_id = $1 AND document_type = 'receipt' AND plant_id IS NULL AND is_active AND financial_year = $2`, [TENANT, fyv]);

console.log('\n[I6] the first allocation of a new FY gets its own series row and FY-suffixed numbers');
{
  const r0 = await receipt();
  ok(r0.ok, `a receipt in the current series posts (${r0.data?.receiptNo})`);
  const live = await series(CUR_FY);
  ok(!!live, `the live receipt series is stamped ${CUR_FY}`);
  const lastNo = Number(live.current_number);
  const plainPrefix = live.prefix ?? '';
  // Simulate 1 April: the only series row belongs to LAST financial year.
  await q(`UPDATE number_series SET financial_year = $1 WHERE id = $2`, [PREV_FY, live.id]);
  const r1 = await receipt();
  ok(r1.ok, `first receipt of the new FY posts (${r1.status} ${r1.msg})`);
  ok(r1.data?.receiptNo === `${plainPrefix}0001${CUR_TOKEN}`, `it is numbered 0001 with the FY token (${r1.data?.receiptNo})`);
  const fresh = await series(CUR_FY);
  ok(!!fresh && fresh.id !== live.id, 'a NEW series row was created for the current FY');
  ok(fresh?.suffix === CUR_TOKEN && Number(fresh?.current_number) === 1, `new row carries suffix ${CUR_TOKEN} and counter 1 (${fresh?.suffix}/${fresh?.current_number})`);
  const old = await one(`SELECT current_number, financial_year FROM number_series WHERE id = $1`, [live.id]);
  ok(Number(old.current_number) === lastNo && old.financial_year === PREV_FY, `last FY's row is untouched (${old.current_number} @ ${old.financial_year})`);
  const r2 = await receipt();
  ok(r2.data?.receiptNo === `${plainPrefix}0002${CUR_TOKEN}`, `the next one continues in the new FY (${r2.data?.receiptNo})`);
  const dup = await one(`SELECT count(*)::int AS n FROM payments WHERE tenant_id = $1 GROUP BY receipt_no HAVING count(*) > 1 LIMIT 1`, [TENANT]);
  ok(!dup, 'no receipt number is duplicated across the two financial years');
}

console.log('\n[I6] reservations carry the suffix so a device formats the same string');
{
  const res = await post('/sync/number-reservations', { documentType: 'receipt', count: 2 });
  ok(res.ok, `reservation drawn (${res.status} ${res.msg})`);
  ok(res.data?.suffix === CUR_TOKEN && res.data?.financialYear === CUR_FY, `response carries suffix ${CUR_TOKEN} and FY ${CUR_FY} (${res.data?.suffix}/${res.data?.financialYear})`);
  ok(String(res.data?.sampleFrom).endsWith(CUR_TOKEN), `sample number ends with the token (${res.data?.sampleFrom})`);
  ok(Number(res.data?.numberFrom) === 3, `the block continues the new FY's counter (${res.data?.numberFrom})`);
}

console.log('\n[I6] never-reset and legacy (unstamped) series keep their counters');
{
  const neverType = `fy_never_${tag}`;
  await q(`INSERT INTO number_series (tenant_id, document_type, prefix, current_number, padding_length, financial_year, reset_frequency) VALUES ($1, $2, 'NV-', 7, 4, $3, 'never')`, [TENANT, neverType, '2020-21']);
  const nv = await post('/sync/number-reservations', { documentType: neverType, count: 1 });
  ok(nv.ok && Number(nv.data?.numberFrom) === 8 && nv.data?.sampleFrom === 'NV-0008', `never-reset series continues at 8 with no token (${nv.data?.sampleFrom})`);
  ok((await one(`SELECT count(*)::int AS n FROM number_series WHERE tenant_id = $1 AND document_type = $2`, [TENANT, neverType])).n === 1, 'no extra row was created for it');

  const legacyType = `fy_legacy_${tag}`;
  await q(`INSERT INTO number_series (tenant_id, document_type, prefix, current_number, padding_length, financial_year, reset_frequency) VALUES ($1, $2, 'LG-', 3, 4, NULL, 'yearly')`, [TENANT, legacyType]);
  const lg = await post('/sync/number-reservations', { documentType: legacyType, count: 1 });
  ok(lg.ok && Number(lg.data?.numberFrom) === 4 && lg.data?.sampleFrom === 'LG-0004', `legacy row keeps its counter (${lg.data?.sampleFrom})`);
  const stamped = await one(`SELECT financial_year FROM number_series WHERE tenant_id = $1 AND document_type = $2`, [TENANT, legacyType]);
  ok(stamped.financial_year === CUR_FY, `and is now stamped with the current FY (${stamped.financial_year})`);
}

console.log('\n[I6] a series counter cannot be moved backwards; identity fields are not editable');
{
  const row = await series(CUR_FY);
  const list = await call('GET', '/number-series');
  const mine = (list.data ?? []).find((s) => s.id === row.id);
  ok(!!mine, 'the new FY row is listed');
  const back = await call('PATCH', `/number-series/${row.id}`, { currentNumber: 0 });
  ok(back.status === 400 && /backwards/i.test(back.msg), `lowering the counter is refused (${back.status}: ${back.msg})`);
  const fwd = await call('PATCH', `/number-series/${row.id}`, { currentNumber: 50, documentType: 'hijack', financialYear: '1999-00' });
  ok(fwd.ok, `moving the counter forward is allowed (${fwd.status} ${fwd.msg})`);
  const after = await one(`SELECT current_number, document_type, financial_year FROM number_series WHERE id = $1`, [row.id]);
  ok(Number(after.current_number) === 50 && after.document_type === 'receipt' && after.financial_year === CUR_FY, `counter 50, identity untouched (${after.document_type}/${after.financial_year})`);
  const next = await receipt();
  ok(String(next.data?.receiptNo).includes('0051'), `numbering resumes from the raised counter (${next.data?.receiptNo})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
