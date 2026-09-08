import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync/engine.js';

/** A fetch stub: `handler(url, init)` returns { status, body } or throws. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init?.method, body });
    const r = await handler(String(url), body);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return calls;
}

function newEngine() {
  const engine = new SyncEngine({ dbPath: ':memory:', baseUrl: 'http://cloud.test', token: 'tok' });
  engine.setMeta('device_id', 'dev-1');
  return engine;
}

test('api surfaces a gateway failure as its status, not a JSON parse error', async () => {
  const engine = newEngine();
  stubFetch(() => ({ status: 502, body: '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>' }));
  const err = await engine.api('GET', '/sync/pull').then(() => null, (e) => e);
  assert.ok(err, 'a 502 must reject');
  assert.equal(err.status, 502, 'the status is carried on the error');
  assert.match(err.message, /502/, 'the message names the status');
  assert.doesNotMatch(err.message, /Unexpected token|JSON at position/, 'not a parse error');
  engine.close();
});

test('api names an unreachable cloud instead of leaking "fetch failed"', async () => {
  const engine = newEngine();
  globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  const err = await engine.api('POST', '/sync/push', {}).then(() => null, (e) => e);
  assert.ok(err, 'a dead link must reject');
  assert.equal(err.offline, true, 'flagged as an offline condition, not a bug');
  assert.match(err.message, /Cannot reach the cloud/);
  assert.match(err.message, /ENOTFOUND/, 'keeps the underlying cause for the log');
  engine.close();
});

test('api rejects a 200 that is not the sync envelope', async () => {
  const engine = newEngine();
  stubFetch(() => ({ status: 200, body: '<html>captive portal</html>' }));
  const err = await engine.api('GET', '/sync/bootstrap').then(() => null, (e) => e);
  assert.ok(err, 'an interstitial must not look like success');
  assert.match(err.message, /not a sync response/);
  engine.close();
});

test('api returns the envelope payload and reports a server error message', async () => {
  const engine = newEngine();
  stubFetch(() => ({ status: 200, body: { data: { ok: 1 } } }));
  assert.deepEqual(await engine.api('GET', '/sync/pull'), { ok: 1 });

  stubFetch(() => ({ status: 400, body: { code: 'VALIDATION_ERROR', message: 'Device X is inactive' } }));
  const err = await engine.api('GET', '/sync/pull').then(() => null, (e) => e);
  assert.equal(err.status, 400);
  assert.match(err.message, /Device X is inactive/, 'the operator sees what the cloud said');
  engine.close();
});

test('two records queued in the same millisecond get distinct local ids', async () => {
  const engine = newEngine();
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000; // freeze: both queue in the same ms
  try {
    const a = engine.queueUpdate('delivery_challan', 'cloud-a', '2026-01-01T00:00:00.000Z', { receiverName: 'A' });
    const b = engine.queueUpdate('delivery_challan', 'cloud-b', '2026-01-01T00:00:00.000Z', { receiverName: 'B' });
    assert.notEqual(a.localId, b.localId, 'ids must not collide inside one millisecond');

    // The damage the collision caused: one cloud result settled BOTH rows.
    stubFetch((_url, body) => ({
      status: 200,
      body: {
        data: {
          results: body.records.map((r, i) => (i === 0
            ? { localId: r.localId, status: 'applied', cloudId: 'cloud-a' }
            : { localId: r.localId, status: 'conflict', conflictId: 'cf-1', reason: 'stale_version' })),
          applied: 1,
          conflicts: 1,
        },
      },
    }));
    const res = await engine.pushPending();
    assert.equal(res.applied, 1);
    assert.equal(res.conflicts, 1);
    const rows = engine.db.prepare('SELECT local_id, sync_status FROM sync_queue ORDER BY id').all();
    assert.equal(rows[0].sync_status, 'synced');
    assert.equal(rows[1].sync_status, 'conflict', 'the rejected update stays visible as a conflict');
    assert.equal(engine.db.prepare('SELECT count(*) c FROM conflicts').get().c, 1);
  } finally {
    Date.now = realNow;
    engine.close();
  }
});

test('offline documents created in the same millisecond both survive', async () => {
  const engine = newEngine();
  stubFetch((_url, body) => ({
    status: 200,
    body: { data: { id: `res-${body.documentType}`, documentType: body.documentType, prefix: 'DC-', suffix: '', paddingLength: 4, numberFrom: 1, numberTo: 10, status: 'active' } },
  }));
  await engine.reserve('delivery_challan', 10);
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    const c1 = engine.createOfflineChallan({ gradeLabel: 'M25', quantityM3: 6, receiverName: 'Site A' });
    const c2 = engine.createOfflineChallan({ gradeLabel: 'M30', quantityM3: 8, receiverName: 'Site B' });
    assert.notEqual(c1.localId, c2.localId);
    assert.notEqual(c1.challanNo, c2.challanNo);
    // local_docs.local_id is a PRIMARY KEY — a collision here lost a challan.
    assert.equal(engine.localDocs('delivery_challan').length, 2);
  } finally {
    Date.now = realNow;
    engine.close();
  }
});

test('an offline challan can still be created after the first pull', async () => {
  const engine = newEngine();
  stubFetch((_url, body) => ({
    status: 200,
    body: { data: { id: 'res-1', documentType: body.documentType, prefix: 'DC-', suffix: '', paddingLength: 4, numberFrom: 1, numberTo: 10, status: 'active' } },
  }));
  await engine.reserve('delivery_challan', 10);
  // Exactly what pull() stores from the second sync onwards: the opaque keyset
  // cursor, not a timestamp. Parsing it as a date gave NaN and the challan
  // crashed with "RangeError: Invalid time value".
  engine.setMeta('sync_token', Buffer.from(JSON.stringify({ v: 2, c: { orders: { ts: new Date().toISOString(), id: '0'.repeat(36) } } })).toString('base64'));
  const c = engine.createOfflineChallan({ gradeLabel: 'M25', quantityM3: 6, receiverName: 'Site A' });
  assert.equal(c.challanNo, 'DC-0001');
  const [doc] = engine.localDocs('delivery_challan');
  assert.ok(!Number.isNaN(Date.parse(doc.created_at)), 'the stamp is a real timestamp');
  engine.close();
});

test('a rejected push names the document, and the cloud resolution comes back', async () => {
  const engine = newEngine();
  engine.queueUpdate('delivery_challan', 'cloud-a', '2026-01-01T00:00:00.000Z', { receiverName: 'A' });
  stubFetch((_url, body) => ({
    status: 200,
    body: {
      data: {
        results: body.records.map((r) => ({ localId: r.localId, status: 'conflict', conflictId: 'cf-9', reason: 'stale_update' })),
        applied: 0,
        conflicts: 1,
      },
    },
  }));
  await engine.pushPending();
  const [row] = engine.conflicts();
  assert.equal(row.entity_name, 'delivery_challan', 'the list says WHICH document was rejected (it used to be null)');
  assert.equal(row.reason, 'stale_update');
  assert.equal(engine.unresolvedConflictCount(), 1);

  // The office resolves it; the next pull carries the new status through.
  stubFetch(() => ({
    status: 200,
    body: {
      data: {
        syncToken: 'tok-2',
        hasMore: false,
        changes: {
          conflicts: [{ id: 'cf-9', entityName: 'delivery_challan', localId: row.local_id, conflictReason: 'stale_update', resolutionStatus: 'keep_cloud' }],
        },
        counts: {},
      },
    },
  }));
  await engine.pull();
  assert.equal(engine.conflicts()[0].resolution_status, 'keep_cloud', 'the resolution reaches the plant');
  assert.equal(engine.unresolvedConflictCount(), 0, 'and the operator stops being shown a problem that is over');
  assert.equal(engine.db.prepare('SELECT count(*) c FROM ref_data').get().c, 0, 'conflicts do not land in reference data');
  engine.close();
});

test('a conflict raised by the cloud reaches a device that never saw the push result', async () => {
  const engine = newEngine();
  stubFetch(() => ({
    status: 200,
    body: {
      data: {
        syncToken: 'tok-1',
        hasMore: false,
        changes: {
          conflicts: [{ id: 'cf-1', entityName: 'batch_ticket', localId: 'L-BT-1', conflictReason: 'duplicate_number', resolutionStatus: 'pending' }],
        },
        counts: {},
      },
    },
  }));
  await engine.pull();
  assert.equal(engine.unresolvedConflictCount(), 1, 'the plant learns about it on the next sync');
  assert.equal(engine.conflicts('pending')[0].reason, 'duplicate_number');
  engine.close();
});

test('a long backlog is pushed in bounded chunks and fully settled', async () => {
  const engine = newEngine();
  for (let i = 0; i < 250; i += 1) {
    engine.queueUpdate('delivery_challan', `cloud-${i}`, '2026-01-01T00:00:00.000Z', { receiverName: `R${i}` });
  }
  const sizes = [];
  stubFetch((_url, body) => {
    sizes.push(body.records.length);
    return {
      status: 200,
      body: {
        data: {
          results: body.records.map((r) => ({ localId: r.localId, status: 'applied', cloudId: r.cloudId })),
          applied: body.records.length,
          conflicts: 0,
        },
      },
    };
  });
  const res = await engine.pushPending();
  assert.deepEqual(sizes, [100, 100, 50], 'chunked, never one unbounded request');
  assert.ok(Math.max(...sizes) <= 200, 'each chunk stays under the server cap');
  assert.equal(res.batches, 3);
  assert.equal(res.applied, 250, 'totals are summed across chunks');
  assert.equal(engine.pendingCount(), 0, 'nothing is left pending');
  engine.close();
});

test('a link that drops mid-push keeps the chunks already accepted', async () => {
  const engine = newEngine();
  for (let i = 0; i < 150; i += 1) {
    engine.queueUpdate('delivery_challan', `cloud-${i}`, '2026-01-01T00:00:00.000Z', { receiverName: `R${i}` });
  }
  let seen = 0;
  globalThis.fetch = async (url, init) => {
    seen += 1;
    if (seen > 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    const records = JSON.parse(init.body).records;
    const text = JSON.stringify({ data: { results: records.map((r) => ({ localId: r.localId, status: 'applied', cloudId: r.cloudId })), applied: records.length, conflicts: 0 } });
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  const err = await engine.pushPending().then(() => null, (e) => e);
  assert.ok(err, 'the failure is reported');
  assert.equal(err.offline, true);
  assert.equal(engine.pendingCount(), 50, 'the first 100 stay settled; only the tail retries');
  engine.close();
});
