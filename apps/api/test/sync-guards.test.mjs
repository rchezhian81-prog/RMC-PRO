/**
 * Offline-sync integrity guards (data-integrity I1 / I7 / I29).
 *
 * Push `update` and conflict `keep_local` used to copy `payload.challanStatus`
 * straight onto the challan row — no transition whitelist, no dispatch-live check,
 * no invoiced guard — so a rejected load could be marked delivered and billed,
 * and an invoiced challan "cancelled" and re-billed. Push `create` deduped on the
 * document number alone (defaulting to ''), silently discarding a DIFFERENT
 * document under a reused number. And one poisoned record 500'd the whole batch.
 *
 * Drives the REAL push endpoint with a registered device and asserts on the
 * persisted rows via owner SQL.
 *
 * Env (from run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, TEST_TENANT_ID,
 * SUPERADMIN_EMAIL/PASSWORD (to enable offline_sync), POSTGRES_*.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PW = process.env.RMC_PASSWORD;
const TENANT = process.env.TEST_TENANT_ID;
if (!LOGIN || !PW || !TENANT) { console.log('(skipping sync-guards — LOGIN/RMC_PASSWORD/TEST_TENANT_ID not set)'); process.exit(0); }

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

const owner = new DataSource({
  type: 'postgres', host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rmc', username: process.env.POSTGRES_USER ?? 'rmc_owner',
  password: process.env.POSTGRES_PASSWORD ?? 'ownerpw', synchronize: false, logging: false,
});
const one = async (sql, params) => (await owner.query(sql, params))[0];

let TOKEN = '';
async function post(path, body, token = TOKEN) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data: json?.data };
}

(async () => {
  await owner.initialize();
  TOKEN = (await post('/auth/login', { login: LOGIN, password: PW })).data?.access_token;
  ok('logged in as the tenant owner', !!TOKEN);
  const su = (await post('/auth/login', { login: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD })).data?.access_token;
  const en = await fetch(`${API_BASE}/platform/tenants/${TENANT}/modules/offline_sync`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${su}` }, body: JSON.stringify({ isEnabled: true }),
  });
  ok('offline_sync module enabled for the tenant', en.status === 200);

  const tag = randomUUID().slice(0, 8);
  const dev = await post('/sync/devices/register', { deviceIdentifier: `SG-${tag}`, deviceName: `Sync Guard ${tag}` });
  ok('device registered', dev.ok && !!dev.data?.id);
  const deviceId = dev.data.id;
  const push = async (records) => post('/sync/push', { deviceId, records });
  const base = async (id) => new Date((await one(`SELECT updated_at AS u FROM delivery_challans WHERE id = $1`, [id])).u).toISOString();
  const statusOf = async (id) => (await one(`SELECT challan_status AS s FROM delivery_challans WHERE id = $1`, [id])).s;
  const upd = (cloudId, payload, withBase = true, baseVal) => ({ entityName: 'delivery_challan', localId: `u-${randomUUID().slice(0, 6)}`, operation: 'update', cloudId, ...(withBase ? { baseUpdatedAt: baseVal } : {}), payload });
  const seedChallan = (id, no, status, extra = {}) => owner.query(
    `INSERT INTO delivery_challans (id, tenant_id, challan_no, challan_status, quantity_m3, dispatch_id, invoice_status)
     VALUES ($1,$2,$3,$4,6,$5,$6)`, [id, TENANT, no, status, extra.dispatchId ?? null, extra.invoiceStatus ?? 'not_invoiced']);

  // ---- I1: status changes go through the state machine + guards ----
  const D = randomUUID();
  await owner.query(`INSERT INTO dispatches (id, tenant_id, dispatch_no, dispatch_status, quantity_m3) VALUES ($1,$2,$3,'rejected',6)`, [D, TENANT, `SGD-${tag}`]);
  const CH1 = randomUUID(); await seedChallan(CH1, `SGC-${tag}-1`, 'draft', { dispatchId: D });
  const r1 = (await push([upd(CH1, { challanStatus: 'issued' }, true, await base(CH1))])).data.results[0];
  ok('issuing a challan whose dispatch was REJECTED is refused as a conflict (dispatch-live guard)', r1.status === 'conflict' && /guard_refused.*rejected/i.test(r1.reason) && (await statusOf(CH1)) === 'draft');

  const CH2 = randomUUID(); await seedChallan(CH2, `SGC-${tag}-2`, 'issued', { invoiceStatus: 'invoiced' });
  const r2 = (await push([upd(CH2, { challanStatus: 'cancelled' }, true, await base(CH2))])).data.results[0];
  ok('cancelling an INVOICED challan is refused (invoiced flag guard)', r2.status === 'conflict' && /guard_refused.*invoiced/i.test(r2.reason) && (await statusOf(CH2)) === 'issued');

  const CH5 = randomUUID(); await seedChallan(CH5, `SGC-${tag}-5`, 'issued');
  const INV = randomUUID();
  await owner.query(`INSERT INTO invoices (id, tenant_id, invoice_no, invoice_status) VALUES ($1,$2,$3,'issued')`, [INV, TENANT, `SGI-${tag}`]);
  await owner.query(`INSERT INTO invoice_challans (id, tenant_id, invoice_id, challan_id, quantity_m3) VALUES ($1,$2,$3,$4,6)`, [randomUUID(), TENANT, INV, CH5]);
  const r5 = (await push([upd(CH5, { challanStatus: 'cancelled' }, true, await base(CH5))])).data.results[0];
  ok('cancelling a challan LINKED to an invoice is refused even though its flag reads not_invoiced (authoritative link guard)', r5.status === 'conflict' && /guard_refused.*linked/i.test(r5.reason) && (await statusOf(CH5)) === 'issued');

  const CH3 = randomUUID(); await seedChallan(CH3, `SGC-${tag}-3`, 'issued');
  const r3 = (await push([upd(CH3, { challanStatus: 'delivered', receiverName: 'Site Engineer' }, true, await base(CH3))])).data.results[0];
  const c3 = await one(`SELECT challan_status AS s, receiver_name AS r FROM delivery_challans WHERE id = $1`, [CH3]);
  const h3 = await one(`SELECT count(*)::int AS n FROM delivery_status_history WHERE challan_id = $1 AND new_status = 'delivered'`, [CH3]);
  ok('a legal issued→delivered move via sync is applied, carries the receiver and writes a history row', r3.status === 'applied' && c3.s === 'delivered' && c3.r === 'Site Engineer' && h3.n === 1);

  const r3b = (await push([upd(CH3, { challanStatus: 'cancelled' }, true, await base(CH3))])).data.results[0];
  ok('delivered→cancelled is refused as an illegal transition', r3b.status === 'conflict' && /guard_refused.*Cannot move/i.test(r3b.reason) && (await statusOf(CH3)) === 'delivered');

  const CH4 = randomUUID(); await seedChallan(CH4, `SGC-${tag}-4`, 'draft');
  const r4 = (await push([upd(CH4, { challanStatus: 'issued' }, false)])).data.results[0];
  ok('a status-bearing update WITHOUT a base version is refused (missing_base_version)', r4.status === 'conflict' && r4.reason === 'missing_base_version' && (await statusOf(CH4)) === 'draft');
  const r4b = (await push([upd(CH4, { challanStatus: 'bogus' }, true, await base(CH4))])).data.results[0];
  ok('an unknown status string is refused (invalid_status)', r4b.status === 'conflict' && r4b.reason === 'invalid_status');
  const r4c = (await push([upd(CH4, { receiverName: 'Only Receiver' }, true, await base(CH4))])).data.results[0];
  ok('a receiver-only update (what the shipped plant-app sends) still applies', r4c.status === 'applied' && (await one(`SELECT receiver_name AS r FROM delivery_challans WHERE id=$1`, [CH4])).r === 'Only Receiver');

  // ---- I7: create validation + content-aware dedupe ----
  const cr = (payload) => ({ entityName: 'delivery_challan', localId: `c-${randomUUID().slice(0, 6)}`, operation: 'create', payload });
  const c1 = (await push([cr({ challanNo: '', quantityM3: 5 })])).data.results[0];
  ok('a create with NO document number is a conflict, not a "" row', c1.status === 'conflict' && c1.reason === 'missing_document_number');
  const c2 = (await push([cr({ challanNo: `SGN-${tag}-Q`, quantityM3: 0 })])).data.results[0];
  ok('a create with zero quantity is refused (invalid_quantity)', c2.status === 'conflict' && c2.reason === 'invalid_quantity');
  const c3s = (await push([cr({ challanNo: `SGN-${tag}-S`, quantityM3: 5, challanStatus: 'cancelled' })])).data.results[0];
  ok('a create as "cancelled" is refused (invalid_status)', c3s.status === 'conflict' && c3s.reason === 'invalid_status');
  const N = `SGN-${tag}-N`;
  const c4 = (await push([cr({ challanNo: N, gradeLabel: 'M25', quantityM3: 6 })])).data.results[0];
  const c4r = (await push([cr({ challanNo: N, gradeLabel: 'M25', quantityM3: 6 })])).data.results[0];
  ok('an identical re-push of the SAME document is idempotent (applied, same cloud id)', c4.status === 'applied' && c4r.status === 'applied' && c4r.cloudId === c4.cloudId);
  const c4d = (await push([cr({ challanNo: N, gradeLabel: 'M30', quantityM3: 9 })])).data.results[0];
  ok('a DIFFERENT document under the same number is a duplicate_number conflict, not a silent discard', c4d.status === 'conflict' && c4d.reason === 'duplicate_number');
  const cnt = await one(`SELECT count(*)::int AS n FROM delivery_challans WHERE challan_no = $1`, [N]);
  ok('exactly one row exists for the number', cnt.n === 1);

  // ---- I29: one poisoned record no longer fails the batch ----
  const P1 = `SGP-${tag}-1`, P2 = `SGP-${tag}-2`;
  const batch = await push([cr({ challanNo: P1, quantityM3: 5, customerId: 'not-a-uuid' }), cr({ challanNo: P2, quantityM3: 5 })]);
  ok('a batch with a poisoned record still returns 2xx', batch.ok);
  ok('the poisoned record is reported as apply_failed (per-record savepoint rolled back)', batch.data.results[0].status === 'conflict' && /^apply_failed/.test(batch.data.results[0].reason));
  ok('the good record in the same batch is applied', batch.data.results[1].status === 'applied');
  const p1 = await one(`SELECT count(*)::int AS n FROM delivery_challans WHERE challan_no = $1`, [P1]);
  const p2 = await one(`SELECT count(*)::int AS n FROM delivery_challans WHERE challan_no = $1`, [P2]);
  ok('only the good record was persisted', p1.n === 0 && p2.n === 1);

  // ---- an oversized batch is refused, not applied half-way ----
  // The whole batch runs in one transaction, so a device that was offline for a
  // week could hold a cloud write transaction open for its entire length.
  const OVER = `SGO-${tag}`;
  const huge = Array.from({ length: 501 }, (_, i) => cr({ challanNo: `${OVER}-${i}`, quantityM3: 5 }));
  const over = await push(huge);
  ok('a batch over the cap is refused with 400', over.status === 400 && over.data === undefined);
  const overRows = await one(`SELECT count(*)::int AS n FROM delivery_challans WHERE challan_no LIKE $1`, [`${OVER}-%`]);
  ok('nothing from the refused batch was written', overRows.n === 0);
  const under = await push([cr({ challanNo: `${OVER}-ok`, quantityM3: 5 })]);
  ok('a batch within the cap still applies', under.ok && under.data.results[0].status === 'applied');

  // ---- keep_local resolution goes through the same guards ----
  const res1 = await post(`/sync/conflicts/${r3b.conflictId}/resolve`, { resolution: 'keep_local' });
  const cf = await one(`SELECT resolution_status AS s FROM sync_conflicts WHERE id = $1`, [r3b.conflictId]);
  ok('keep_local on an illegal move is refused with 400, challan unchanged, conflict still pending', res1.status === 400 && (await statusOf(CH3)) === 'delivered' && cf.s === 'pending');
  const res2 = await post(`/sync/conflicts/${r3b.conflictId}/resolve`, { resolution: 'keep_cloud' });
  ok('keep_cloud resolves it', res2.ok && res2.data.resolutionStatus === 'keep_cloud');

  await owner.destroy();
  console.log(`\nSYNC GUARDS TEST: ${pass} passed`);
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e.message); process.exit(1); });
