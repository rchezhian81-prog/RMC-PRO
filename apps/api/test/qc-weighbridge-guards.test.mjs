/**
 * QC / weighbridge gap scan — W1..W5, Q1, Q2.
 *
 *   W1 — the TCP indicator dialled any host:port on the record, and those routes
 *        are gated on `weighbridge.device` (Store Staff). An operator could aim
 *        an "indicator" at the metadata IP or a loopback service and have the API
 *        connect, with the reply's first line returned and the socket errno
 *        distinguishing an open port from a filtered one.
 *   W2 — MaterialInward.cancel() took no row lock while post() did, so cancel
 *        read the pre-post snapshot, passed the 'posted' guard, and its UPDATE
 *        landed after the post committed: a cancelled inward whose quantity was
 *        already in stock.
 *   W3 — toInward converted a DRAFT slip, turning a provisional weight into a
 *        GRN and then into the stock ledger.
 *   W4 — the indicator update() spread the DTO straight into repo.update,
 *        skipping every check create() performs.
 *   W5 — weighbridge setStatus() read without a lock and wrote unconditionally.
 *   Q1 — an unknown batchTicketId was stored as-is AND silently disabled the
 *        grade/ticket reconciliation that stops cubes being assessed against the
 *        wrong fck.
 *   Q2 — specimenCount was unvalidated; 0 (or junk, which num() makes 0) turned
 *        off both the 28-day result cap and the "sample complete" test.
 *
 * Env: API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID, TEST_MATERIAL_ID, POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const TENANT = process.env.TEST_TENANT_ID;
const MATERIAL = process.env.TEST_MATERIAL_ID;
if (!TENANT || !MATERIAL) { console.error('TEST_TENANT_ID and TEST_MATERIAL_ID required'); process.exit(1); }

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
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, ok: res.ok, data: json?.data, code: json?.error?.code ?? json?.code ?? '', msg: json?.error?.message ?? json?.message ?? '' };
}
const post = (path, body = {}) => call('POST', path, body);
const tag = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);

async function newSlip(status, suffix) {
  const id = randomUUID();
  await q(
    `INSERT INTO weighbridge_entries (id, tenant_id, slip_no, status, material_id, gross_weight, tare_weight, net_weight)
     VALUES ($1,$2,$3,$4,$5,20000,5000,15000)`,
    [id, TENANT, `QWG-${tag}-${suffix}`, status, MATERIAL],
  );
  return id;
}

// ───────────────────────── W3 — only a finished weighing becomes stock ─────────────────────────
console.log('\n[W3] a draft weighbridge slip cannot be converted to an inward');
{
  const draft = await newSlip('draft', 'W3a');
  const refused = await post(`/weighbridge/${draft}/to-inward`, { rate: 10 });
  ok(!refused.ok && refused.status === 400, `draft slip refused (${refused.status} ${refused.msg})`);
  ok(/complete the weighing/i.test(refused.msg), 'the refusal says why');
  ok((await one(`SELECT count(*)::int AS n FROM material_inwards WHERE weighbridge_entry_id = $1`, [draft])).n === 0,
     'no inward was created for the draft slip');

  const done = await newSlip('completed', 'W3b');
  const conv = await post(`/weighbridge/${done}/to-inward`, { rate: 10 });
  ok(conv.ok, `a completed slip still converts (${conv.status} ${conv.msg})`);
}

// ───────────────────────── W2 — cancel cannot race a post ─────────────────────────
console.log('\n[W2] a posted inward is never left cancelled with its stock applied');
{
  const slip = await newSlip('completed', 'W2');
  const conv = await post(`/weighbridge/${slip}/to-inward`, { rate: 10 });
  const inwardId = conv.data?.inward?.id;
  ok(!!inwardId, `draft inward created (${conv.status} ${conv.msg})`);

  // Fire both at once: this is the interleaving the missing lock allowed.
  const [postRes, cancelRes] = await Promise.all([
    post(`/material-inwards/${inwardId}/post`),
    post(`/material-inwards/${inwardId}/cancel`),
  ]);
  const status = (await one(`SELECT status FROM material_inwards WHERE id = $1`, [inwardId])).status;
  const ledger = (await one(
    `SELECT count(*)::int AS n FROM stock_transactions WHERE reference_type = 'material_inward' AND reference_id = $1`,
    [inwardId],
  )).n;
  ok(['posted', 'cancelled'].includes(status), `inward settled on one state (${status})`);
  // The invariant: stock is applied if and only if the document says posted.
  ok(
    (status === 'posted' && ledger === 1) || (status === 'cancelled' && ledger === 0),
    `stock ledger agrees with the document (status=${status}, ledger rows=${ledger}, post=${postRes.status}, cancel=${cancelRes.status})`,
  );
}

console.log('\n[W2] a settled inward still refuses the other transition');
{
  const slip = await newSlip('completed', 'W2b');
  const inwardId = (await post(`/weighbridge/${slip}/to-inward`, { rate: 10 })).data?.inward?.id;
  const posted = await post(`/material-inwards/${inwardId}/post`);
  ok(posted.ok, `inward posted (${posted.status} ${posted.msg})`);
  const late = await post(`/material-inwards/${inwardId}/cancel`);
  ok(!late.ok && /posted/i.test(late.msg), `cancelling a posted inward is refused (${late.status} ${late.msg})`);
}

// ───────────────────────── W5 — a terminal slip stays terminal under concurrency ─────────────────────────
console.log('\n[W5] concurrent status writes cannot re-open a matched slip');
{
  const slip = await newSlip('completed', 'W5');
  await post(`/weighbridge/${slip}/to-inward`, { rate: 10 });      // -> matched
  const [a, b] = await Promise.all([
    post(`/weighbridge/${slip}/status`, { status: 'draft' }),
    post(`/weighbridge/${slip}/status`, { status: 'draft' }),
  ]);
  ok(!a.ok && !b.ok, `both attempts refused (${a.status}/${b.status})`);
  ok((await one(`SELECT status FROM weighbridge_entries WHERE id = $1`, [slip])).status === 'matched',
     'the slip is still matched');
}

// ───────────────────────── W1 — the indicator cannot dial the private network ─────────────────────────
console.log('\n[W1] a TCP indicator pointed at a non-routable address is refused');
{
  const made = await post('/weighbridge-indicators', {
    name: `Guard ${tag}`, connectionType: 'tcp', host: '127.0.0.1', port: 6379, unit: 'kg', isActive: true,
  });
  ok(made.ok, `indicator registered (${made.status} ${made.msg})`);
  const read = await post(`/weighbridge-indicators/${made.data?.id}/read`);
  ok(!read.ok && read.status === 400, `reading a loopback indicator is refused (${read.status})`);
  ok(/loopback/i.test(read.msg) && /cannot be used/i.test(read.msg), `the address class is named (${read.msg})`);
  // The errno must not leak: ECONNREFUSED vs ETIMEDOUT maps open ports.
  ok(!/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(read.msg), 'no socket errno is reflected back');

  const meta = await post('/weighbridge-indicators', {
    name: `Guard meta ${tag}`, connectionType: 'tcp', host: '169.254.169.254', port: 80, unit: 'kg', isActive: true,
  });
  const metaRead = await post(`/weighbridge-indicators/${meta.data?.id}/read`);
  ok(!metaRead.ok && /link-local/i.test(metaRead.msg), `the cloud metadata address is refused (${metaRead.status} ${metaRead.msg})`);
}

// ───────────────────────── W4 — update is validated like create ─────────────────────────
console.log('\n[W4] an indicator cannot be updated into a state create() would reject');
{
  const made = await post('/weighbridge-indicators', { name: `Sim ${tag}`, connectionType: 'simulated', unit: 'kg', isActive: true });
  ok(made.ok, `simulated indicator created (${made.status} ${made.msg})`);
  const id = made.data?.id;

  const noHost = await post(`/weighbridge-indicators/${id}`, { connectionType: 'tcp' });
  ok(!noHost.ok && /host and port/i.test(noHost.msg), `switching to tcp without host/port is refused (${noHost.status} ${noHost.msg})`);

  const bogus = await post(`/weighbridge-indicators/${id}`, { connectionType: 'carrier-pigeon' });
  ok(!bogus.ok && /connectionType/i.test(bogus.msg), `an invalid connectionType is refused (${bogus.status} ${bogus.msg})`);

  const blankName = await post(`/weighbridge-indicators/${id}`, { name: '   ' });
  ok(!blankName.ok && /name is required/i.test(blankName.msg), `blanking the name is refused (${blankName.status} ${blankName.msg})`);

  ok((await one(`SELECT connection_type FROM weighbridge_indicators WHERE id = $1`, [id])).connection_type === 'simulated',
     'the stored indicator is untouched by the refused updates');
}

// ───────────────────────── Q1 — an unknown batch ticket is refused ─────────────────────────
console.log('\n[Q1] QC refuses an unresolvable batch ticket instead of silently skipping the grade check');
{
  const slump = await post('/qc/slump-tests', { measuredSlumpMm: 120, batchTicketId: randomUUID() });
  ok(!slump.ok && /batch ticket not found/i.test(slump.msg), `slump test refuses an unknown ticket (${slump.status} ${slump.msg})`);

  const cube = await post('/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25, batchTicketId: randomUUID() });
  ok(!cube.ok && /batch ticket not found/i.test(cube.msg), `cube set refuses an unknown ticket (${cube.status} ${cube.msg})`);

  const mix = await post('/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25, mixDesignId: randomUUID() });
  ok(!mix.ok && /mix design not found/i.test(mix.msg), `cube set refuses an unknown mix design (${mix.status} ${mix.msg})`);

  ok((await one(`SELECT count(*)::int AS n FROM qc_slump_tests WHERE tenant_id = $1 AND batch_ticket_id IS NOT NULL
                 AND batch_ticket_id NOT IN (SELECT id FROM batch_tickets)`, [TENANT])).n === 0,
     'no QC row points at a batch ticket that does not exist');
}

// ───────────────────────── Q2 — the specimen count is real ─────────────────────────
console.log('\n[Q2] a cube set cannot be cast with a specimen count that disables the sample cap');
{
  for (const [label, value] of [['zero', 0], ['junk', 'abc'], ['negative', -3], ['fractional', 2.5], ['absurd', 500]]) {
    const res = await post('/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25, specimenCount: value });
    ok(!res.ok && /specimen count/i.test(res.msg), `${label} specimen count refused (${res.status} ${res.msg})`);
  }
  const good = await post('/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25, specimenCount: 3 });
  ok(good.ok && Number(good.data?.specimenCount) === 3, `a valid set still casts (${good.status} ${good.msg})`);

  const dflt = await post('/qc/cube-sets', { castDate: TODAY, targetStrengthMpa: 25 });
  ok(dflt.ok && Number(dflt.data?.specimenCount) === 3, `the default of 3 still applies (${dflt.status} ${dflt.msg})`);
}

await owner.destroy();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// ───────────────────────── Q3 — the slump register date filter actually filters ─────────────────────────
console.log('\n[Q3] the slump-register date range is applied in SQL, not by slicing a Date');
{
  // REGRESSION: the old filter did String(testedAt).slice(0, 10), and testedAt is
  // a timestamptz that TypeORM hands back as a Date. String(date) is
  // "Sat Sep 12 2026 …", so slice(0,10) gave "Sat Sep 12" — which compares
  // lexically ABOVE any "2026-.." bound. A `to` bound therefore excluded every
  // row and a `from` bound excluded none: the filter never worked.
  const tag2 = `${tag}Q3`;
  for (const day of ['01', '02', '03', '10', '11']) {
    await q(
      `INSERT INTO qc_slump_tests (id, tenant_id, measured_slump_mm, passed, tested_at, remarks)
       VALUES ($1,$2,120,true,$3,$4)`,
      [randomUUID(), TENANT, `2026-03-${day}T10:30:00Z`, `q3-${tag2}`],
    );
  }
  const count = async (qs) => (await call('GET', `/qc/slump-register${qs}`)).data?.count ?? -1;

  const windowed = await count('?from=2026-03-01&to=2026-03-03');
  ok(windowed >= 3, `a from..to window returns its rows, not zero (got ${windowed})`);

  const toOnly = await count('?to=2026-03-03');
  const fromOnly = await count('?from=2026-03-10');
  ok(toOnly >= 3, `a 'to' bound no longer excludes everything (got ${toOnly})`);
  ok(fromOnly >= 2, `a 'from' bound returns the later rows (got ${fromOnly})`);
  ok(toOnly < fromOnly + windowed + 1000, 'the bounds actually narrow the result');

  // A test recorded late in the day belongs to that day, not the next one.
  const lateId = randomUUID();
  await q(
    `INSERT INTO qc_slump_tests (id, tenant_id, measured_slump_mm, passed, tested_at, remarks)
     VALUES ($1,$2,120,true,'2026-03-20T23:30:00Z',$3)`,
    [lateId, TENANT, `q3-late-${tag2}`],
  );
  const onItsDay = await count('?from=2026-03-20&to=2026-03-20');
  ok(onItsDay >= 1, `a 23:30 test falls on its own day (got ${onItsDay})`);
}
