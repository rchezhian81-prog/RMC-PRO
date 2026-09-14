/**
 * IS 456 Table 10 sampling compliance, end to end.
 *
 * Confirmed batch tickets say how much concrete was produced per day and grade;
 * cube sets say how many samples were cast. The report judges one against the
 * other, and the compliance agent raises `under_sampled` from the same SQL and
 * rule. This drives both against real rows: a day of 80 m³ of M25 with no cube
 * sets is five samples short; casting five clears it exactly.
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

// A day well inside the agent's default 30-day window, and unique to this run
// so other tests' production cannot land on it: 9 days ago.
const day = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
const GRADE = `M25`;

// 80 m³ of M25 on two confirmed tickets, plus a draft and a cancelled one that
// must not count. No plant and no grade master: the report keys by label.
async function ticket(no, m3, status) {
  await q(
    `INSERT INTO batch_tickets (id, tenant_id, batch_ticket_no, grade_label, status, batch_quantity_m3, batch_start_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date + time '10:00')`,
    [randomUUID(), TENANT, `SMP-${tag}-${no}`, GRADE, status, m3, day],
  );
}
await ticket(1, 50, 'confirmed');
await ticket(2, 30, 'confirmed');
await ticket(3, 40, 'draft');
await ticket(4, 40, 'cancelled');

const report = async () => (await call('GET', `/qc/sampling-report?from=${day}&to=${day}`)).data;
const mine = (rep) => (rep?.rows ?? []).find((r) => r.day === day && String(r.gradeLabel).toUpperCase() === GRADE);

console.log('\n[1] 80 m³ of M25 with no cube sets');
{
  const rep = await report();
  const row = mine(rep);
  ok(!!row, 'the day appears in the report');
  ok(Number(row?.producedM3) === 80, `only confirmed tickets count as produced (${row?.producedM3} m³)`);
  ok(row?.samplesRequired === 5, `Table 10 asks for 5 samples for 80 m³ (${row?.samplesRequired})`);
  ok(row?.samplesCast === 0 && row?.shortfall === 5 && row?.compliant === false, 'and none were cast: 5 short');
}

console.log('\n[2] the compliance agent raises it from the same rule');
{
  const r = await call('POST', '/agents/specialist/run', { topic: 'compliance', windowDays: 30 });
  const blob = JSON.stringify(r.data ?? {});
  ok(/"code":"under_sampled"/.test(blob), 'under_sampled is among the findings');
  ok(/IS 456:2000 §15\.2\.2 Table 10/.test(blob), 'and cites Table 10');
}

console.log('\n[3] casting the five sets clears the day exactly');
{
  for (let i = 0; i < 5; i += 1) {
    const r = await call('POST', '/qc/cube-sets', { castDate: day, gradeLabel: GRADE, targetStrengthMpa: 25, specimenCount: 3 });
    if (!r.ok) { ok(false, `cube set ${i + 1} refused: ${r.msg}`); break; }
  }
  const row = mine(await report());
  ok(row?.samplesCast === 5, `five sets are counted (${row?.samplesCast})`);
  ok(row?.shortfall === 0 && row?.compliant === true, 'the day is compliant');
}

console.log('\n[4] a sixth set is not a credit for another grade');
{
  await call('POST', '/qc/cube-sets', { castDate: day, gradeLabel: GRADE, targetStrengthMpa: 25, specimenCount: 3 });
  await ticket(5, 3, 'confirmed');
  await q(`UPDATE batch_tickets SET grade_label = 'M20' WHERE batch_ticket_no = $1`, [`SMP-${tag}-5`]);
  const rep = await report();
  const m20 = (rep?.rows ?? []).find((r) => r.day === day && String(r.gradeLabel).toUpperCase() === 'M20');
  ok(m20?.samplesRequired === 1 && m20?.samplesCast === 0 && m20?.compliant === false, '3 m³ of M20 with no M20 sample is short, whatever M25 cast');
  ok(rep?.underSampled >= 1, 'the roll-up counts it');
}

console.log(`\n${passed} passed, ${failed} failed`);
await owner.destroy();
process.exit(failed ? 1 : 0);
