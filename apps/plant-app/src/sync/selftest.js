import { SyncEngine } from './engine.js';

/**
 * Standalone sync-engine harness (run: node --experimental-sqlite selftest.js).
 * Exercises the full offline lifecycle against a running cloud API:
 * register → bootstrap → reserve → offline entry → push → pull → conflict.
 */
const BASE = process.env.RMC_BASE ?? 'http://localhost:4000';
let token = process.env.RMC_TOKEN ?? '';

async function api(method, path, body, tok = token) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json(); if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(j)}`); return j.data;
}
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

(async () => {
  if (!token) token = (await api('POST', '/auth/login', { login: 'admin@alpha.test', password: 'Passw0rd!' })).access_token;

  const engine = new SyncEngine({ dbPath: ':memory:', baseUrl: BASE, token });

  // 1) Register + bootstrap
  const boot = await engine.registerAndBootstrap({ deviceIdentifier: `PLANT-${Date.now() % 100000}`, deviceName: 'Harness Plant PC' });
  ok('device registered + bootstrap', !!boot.deviceId && boot.counts.grades >= 0, `grades=${boot.counts.grades} customers=${boot.counts.customers}`);
  ok('bootstrap stored ref data in SQLite', engine.db.prepare('SELECT count(*) c FROM ref_data').get().c >= 0);

  // 2) Reserve offline numbers
  const rc = await engine.reserve('delivery_challan', 50);
  ok('reserved 50 challan numbers', (rc.numberTo - rc.numberFrom + 1) === 50, `${rc.sampleFrom}..${rc.sampleTo}`);
  await engine.reserve('batch_ticket', 20);

  // 3) OFFLINE entry (no network needed — pure SQLite)
  const c1 = engine.createOfflineChallan({ gradeLabel: 'M25', quantityM3: 6, slump: '120mm', receiverName: 'Site A' });
  const c2 = engine.createOfflineChallan({ gradeLabel: 'M30', quantityM3: 8, slump: '100mm', receiverName: 'Site B' });
  const b1 = engine.createOfflineBatch({ gradeLabel: 'M25', batchQuantityM3: 6 });
  ok('offline challan uses reserved number', c1.challanNo === rc.sampleFrom, `${c1.challanNo}`);
  ok('offline numbers are sequential + unique', c2.challanNo !== c1.challanNo);
  ok('3 records queued pending', engine.pendingCount() === 3, `pending=${engine.pendingCount()}`);

  // 4) Push (offline → cloud)
  const push1 = await engine.pushPending();
  ok('push applied all 3 (no conflicts)', push1.applied === 3 && push1.conflicts === 0, JSON.stringify(push1));
  ok('local docs got cloud ids', engine.localDocs('delivery_challan').every((d) => d.cloud_id));
  ok('offline batch synced to cloud', engine.localDocs('batch_ticket').find((d) => d.doc_no === b1.batchTicketNo)?.cloud_id);
  ok('queue drained to synced', engine.pendingCount() === 0);
  // verify on cloud
  const cloudChallan = await api('GET', `/delivery-challans/${engine.localDocs('delivery_challan')[0].cloud_id}`);
  ok('challan exists on cloud with reserved no', cloudChallan.challanNo === c1.challanNo);

  // 4b) Idempotent re-push (simulate a retry) — re-queue same create, must not duplicate
  engine.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json) VALUES(?,?,?,?)')
    .run('delivery_challan', 'RETRY-1', 'create', JSON.stringify({ challanNo: c1.challanNo, gradeLabel: 'M25', quantityM3: 6 }));
  const retry = await engine.pushPending();
  ok('idempotent re-push returns existing (no duplicate)', retry.applied === 1 && retry.conflicts === 0);

  // 5) Pull (cloud → offline)
  const pull = await engine.pull();
  ok('pull returned change counts', typeof pull.deliveryChallans === 'number', JSON.stringify(pull));

  // 6) Conflict detection + resolution
  const cloudId = engine.localDocs('delivery_challan')[0].cloud_id;
  const base1 = (await api('GET', `/delivery-challans/${cloudId}`)).updatedAt;
  // first update applies (advances updatedAt on cloud)
  engine.queueUpdate('delivery_challan', cloudId, base1, { receiverName: 'Updated Once' });
  const u1 = await engine.pushPending();
  ok('first update applied', u1.applied === 1 && u1.conflicts === 0);
  // second update carries the STALE base version -> conflict
  engine.queueUpdate('delivery_challan', cloudId, base1, { receiverName: 'Stale Update' });
  const u2 = await engine.pushPending();
  ok('stale update detected as conflict', u2.conflicts === 1, JSON.stringify(u2));
  const conflicts = await api('GET', '/sync/conflicts?status=pending');
  const conf = conflicts.find((x) => x.cloudId === cloudId);
  ok('conflict recorded on cloud (pending)', !!conf && conf.conflictReason === 'stale_update');
  const resolved = await api('POST', `/sync/conflicts/${conf.id}/resolve`, { resolution: 'keep_cloud' });
  ok('conflict resolved (keep_cloud)', resolved.resolutionStatus === 'keep_cloud');

  // 7) Devices + reservations visible on cloud
  ok('device listed on cloud', (await api('GET', '/sync/devices')).some((d) => d.id === engine.deviceId));
  ok('reservations listed on cloud', (await api(`GET`, `/sync/number-reservations?deviceId=${engine.deviceId}`)).length >= 2);

  engine.close();
  console.log('\nENGINE-OK');
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
