/**
 * The compliance check only asks for an IRN when e-invoicing actually applies.
 *
 * The defect this pins: the check counted every issued invoice with no IRN and
 * cited the "AATO > ₹5 crore" rule — but nothing anywhere recorded whether the
 * plant is above that threshold, so the warning could not be right for anyone
 * below it. A new plant, which is below it by definition, was told on every
 * single invoice to obtain an IRN it is not required to have and has no portal
 * credentials to produce. A warning that is always wrong is one nobody reads,
 * and then it cannot do its job for the plant that grows past the limit.
 *
 * Applicability is now a flag the owner sets (Settings → Company), defaulting to
 * off. It is a flag rather than a turnover figure because the threshold itself
 * has moved repeatedly (₹500 cr → 100 → 50 → 20 → 10 → 5).
 *
 * The e-way bill check is deliberately NOT gated: that threshold is per
 * consignment (₹50,000), applies to everyone, and is checked against the
 * invoice total. It stays on throughout as the control.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, POSTGRES_*.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;
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
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); }
};

const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.LOGIN, password: process.env.RMC_PASSWORD }),
}).then((r) => r.json());
const TOKEN = loginRes?.data?.access_token;
if (!TOKEN) { console.error('login failed', JSON.stringify(loginRes)); process.exit(1); }
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, data: j?.data, msg: j?.error?.message ?? '' };
};

// An issued invoice over ₹50,000 with neither an IRN nor an e-way bill: it should
// trip the e-way check always, and the e-invoice check only when applicable.
const tag = Date.now().toString(36);
const [customer] = await q(`SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1`, [TENANT]);
await q(
  `INSERT INTO invoices (tenant_id, invoice_no, customer_id, invoice_date, taxable_amount, total_amount,
                         invoice_status, einvoice_status, eway_status)
   VALUES ($1,$2,$3,current_date,250000,295000,'issued','not_generated','not_generated')`,
  [TENANT, `EINV-${tag}`, customer?.id ?? null],
);

/** Which compliance findings the specialist reports right now. */
async function findings() {
  const r = await call('POST', '/agents/specialist/run', { topic: 'compliance', windowDays: 30 });
  const blob = JSON.stringify(r.data ?? {});
  const out = {};
  for (const m of blob.matchAll(/"code":"([a-z_]+)"[^}]*?"count":(\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

console.log('\n[1] a plant below the turnover limit (the default)');
{
  await call('PATCH', '/company', { einvoiceApplicable: false });
  const f = await findings();
  ok(f.einvoice_pending === undefined, 'it is not told to generate an IRN it does not need');
  ok((f.eway_pending ?? 0) >= 1, `the e-way bill warning still stands — that threshold applies to everyone (${f.eway_pending})`);
}

console.log('\n[2] the owner says e-invoicing applies');
{
  const r = await call('PATCH', '/company', { einvoiceApplicable: true });
  ok(r.ok, 'the setting saves');
  const f = await findings();
  ok((f.einvoice_pending ?? 0) >= 1, `the IRN warning appears for a plant that is above the limit (${f.einvoice_pending})`);
  ok((f.eway_pending ?? 0) >= 1, 'and the e-way bill warning is unaffected');
}

console.log('\n[3] a checkbox value is settled to a real boolean');
{
  for (const [sent, expected] of [['false', false], ['on', true], ['no', false], [true, true]]) {
    await call('PATCH', '/company', { einvoiceApplicable: sent });
    const co = (await call('GET', '/company')).data;
    ok(co?.einvoiceApplicable === expected, `${JSON.stringify(sent)} -> ${expected}`);
  }
}

await call('PATCH', '/company', { einvoiceApplicable: false });
console.log(`\n${passed} passed, ${failed} failed`);
await owner.destroy();
process.exit(failed ? 1 : 0);
