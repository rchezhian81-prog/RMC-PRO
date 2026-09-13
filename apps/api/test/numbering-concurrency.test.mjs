/**
 * Numbering under concurrent use (Doc 11 §7).
 *
 * A plant is not one person. The batching operator, the accountant and the
 * manager write documents at the same moment, and a duplicate GST invoice
 * number is a legal problem rather than a bug report.
 *
 * Steady state was always correct — `SELECT ... FOR UPDATE` on the series row
 * serialises allocations. The hole was the COLD START: when no row yet exists
 * for a (tenant, document type, plant, financial year) key, every concurrent
 * caller tried to INSERT it and the unique index rejected all but one. The
 * losers did not just retry — their document failed, and the operator was shown
 * "A record with the same code already exists." about a code they never typed.
 *
 * That key includes the FINANCIAL YEAR, so the cold start is not a one-off at
 * install: it recurs every 1 April, when each series needs a new FY row and the
 * plant is already batching.
 *
 * Measured on a fresh tenant, 40 simultaneous creates of the first document of
 * a type: 34 created / 6 refused before, 40 created / 0 refused after.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
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

const post = async (path, body = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, ok: res.ok, data: json?.data, msg: json?.error?.message ?? '' };
};

const tag = Date.now().toString(36);
const N = 20;

/** Fire N creates at the same instant and describe what came back. */
async function burst(make, numberField) {
  const results = await Promise.all(Array.from({ length: N }, (_, i) => make(i)));
  const made = results.filter((r) => r.ok);
  const numbers = made.map((r) => String(r.data?.[numberField] ?? ''));
  return {
    created: made.length,
    refused: results.filter((r) => !r.ok),
    distinct: new Set(numbers).size,
    numbers: numbers.sort(),
  };
}

// A document type with no series row yet for this tenant — the cold start.
await q(`DELETE FROM number_series WHERE tenant_id = $1 AND document_type = 'lead'`, [TENANT]);
const before = await q(`SELECT count(*)::int AS n FROM number_series WHERE tenant_id = $1 AND document_type = 'lead'`, [TENANT]);
ok(before[0].n === 0, 'starting with no lead series row (a fresh tenant, or 1 April)');

console.log(`\n[cold start] ${N} people create the first lead of the series at the same instant`);
{
  const r = await burst(
    (i) => post('/leads', { customerName: `Race ${tag} ${i}`, mobile: '9842000000', siteLocation: 'Coimbatore' }),
    'leadNo',
  );
  ok(r.created === N, `every create succeeded (${r.created}/${N})` +
    (r.refused.length ? ` — refused: ${JSON.stringify(r.refused[0].msg).slice(0, 90)}` : ''));
  ok(r.distinct === r.created, `every number is distinct (${r.distinct} distinct of ${r.created})`);
  ok(r.numbers.length > 0 && r.numbers[0].endsWith('0001'), `the series starts at 1 (${r.numbers[0]})`);

  // Gapless: N documents must consume exactly N numbers, 1..N.
  const tail = r.numbers.map((s) => Number(s.replace(/\D+/g, '')));
  const expected = Array.from({ length: N }, (_, i) => i + 1);
  ok(JSON.stringify(tail) === JSON.stringify(expected), `the numbers are 1..${N} with no gap and no repeat`);

  const rows = await q(`SELECT count(*)::int AS n FROM number_series WHERE tenant_id = $1 AND document_type = 'lead'`, [TENANT]);
  ok(rows[0].n === 1, `exactly one series row was created, not ${rows[0].n}`);
}

console.log(`\n[steady state] ${N} more at once, now that the row exists`);
{
  const r = await burst(
    (i) => post('/leads', { customerName: `Race2 ${tag} ${i}`, mobile: '9842000000', siteLocation: 'Coimbatore' }),
    'leadNo',
  );
  ok(r.created === N, `every create succeeded (${r.created}/${N})`);
  ok(r.distinct === r.created, `every number is distinct (${r.distinct})`);
  const tail = r.numbers.map((s) => Number(s.replace(/\D+/g, '')));
  const expected = Array.from({ length: N }, (_, i) => N + i + 1);
  ok(JSON.stringify(tail) === JSON.stringify(expected), `numbering continued ${N + 1}..${N * 2} without a gap`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
