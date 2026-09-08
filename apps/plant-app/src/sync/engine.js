import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

/**
 * Offline sync engine for the RMC plant app (Design Doc 8). Runs in the Electron
 * main process (Node) and in a standalone Node harness — it uses node:sqlite for
 * the local store and the cloud sync API for register / bootstrap / reserve /
 * push / pull / conflict resolution. Pure logic, no Electron dependency, so it
 * is fully unit-testable.
 */
/** First line of a non-JSON body, short enough to put in an error message. */
const snippet = (text) => (text ? `"${String(text).replace(/\s+/g, ' ').trim().slice(0, 120)}"` : '(empty body)');

/**
 * Records per push request. The server caps a batch (SYNC_PUSH_LIMIT, 200) —
 * it applies the whole batch in ONE transaction, so an unbounded push from a
 * device that was offline for a week meant a multi-megabyte body and a
 * long-running write transaction on the cloud. This stays under that cap.
 */
const PUSH_CHUNK = 100;

/**
 * Number-block top-up. `nextNumber` threw "No number reservation available" the
 * moment a block ran out, and the device only ever reserved when a human
 * remembered to — so a plant that went offline with 3 numbers left could not
 * write its fourth challan until the link came back. The engine now tops up
 * while it is demonstrably online (during a pull), keeping a floor in hand.
 */
const RESERVE_MIN = 20;
const RESERVE_COUNT = 100;

export class SyncEngine {
  constructor({ dbPath = ':memory:', baseUrl, token } = {}) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    // Column added after the first release (CREATE TABLE IF NOT EXISTS leaves an
    // existing table alone): the reservation suffix that carries the FY token.
    const reservationCols = this.db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
    if (!reservationCols.includes('suffix')) this.db.exec('ALTER TABLE reservations ADD COLUMN suffix TEXT');
    this.baseUrl = baseUrl;
    this.token = token;
  }

  setAuth(baseUrl, token) { this.baseUrl = baseUrl; this.token = token; }
  setMeta(key, value) { this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); }
  getMeta(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null; }

  /**
   * A local id that is unique for the life of the install.
   *
   * `Date.now()` alone repeats inside a millisecond and the old
   * `count(*) FROM local_docs` suffix repeats as soon as a row is removed, so
   * two documents could share an id. local_docs.local_id is a PRIMARY KEY (the
   * second insert throws and the document is lost), and sync_queue.local_id is
   * NOT unique — pushPending settles each cloud result with `WHERE local_id=?`,
   * so one result would settle BOTH rows: a rejected update silently marked
   * synced, its change dropped, and no conflict for the operator to see. The
   * counter lives in `meta`, so it survives restarts and never repeats.
   */
  newLocalId(prefix) {
    const next = Number(this.getMeta('local_id_seq') ?? 0) + 1;
    this.setMeta('local_id_seq', next);
    return `${prefix}-${Date.now()}-${next}`;
  }

  /**
   * One cloud call. Every sync operation goes through here, so this is where a
   * failure has to be made legible: the plant is behind site wifi and a
   * home-grade router, and the operator sees nothing but what this throws.
   */
  async api(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      // fetch REJECTS on DNS/TCP/TLS failure — the everyday case at a plant
      // whose link is down. Left alone it surfaces as a bare TypeError
      // ("fetch failed"), which reads like a bug in the app rather than "no
      // connection"; the queue is durable, so this is a wait, not an error.
      const err = new Error(`Cannot reach the cloud (${method} ${path}): ${e?.cause?.code ?? e?.message ?? 'network error'}`);
      err.offline = true;
      throw err;
    }
    // A 502/504 from nginx, a captive-portal login page or an idle proxy
    // returns HTML, not JSON. res.json() then threw a SyntaxError ("Unexpected
    // token '<'") BEFORE the !res.ok check, so the status was lost and the
    // operator was shown a parse error for a gateway simply being down.
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status} ${json ? JSON.stringify(json.message ?? json) : snippet(text)}`);
      err.status = res.status;
      err.body = json ?? text;
      throw err;
    }
    // A 200 that is not the envelope (a proxy interstitial, a truncated body)
    // used to return undefined and fail much later, far from the cause.
    if (!json || typeof json !== 'object' || !('data' in json)) {
      const err = new Error(`${method} ${path} -> ${res.status} but the body is not a sync response: ${snippet(text)}`);
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  /** Register this device and download the bootstrap snapshot into SQLite. */
  async registerAndBootstrap({ deviceIdentifier, deviceName, plantId }) {
    const device = await this.api('POST', '/sync/devices/register', { deviceIdentifier, deviceName, plantId });
    this.setMeta('device_id', device.id);
    this.setMeta('plant_id', device.plantId ?? '');
    const boot = await this.api('GET', `/sync/bootstrap?deviceId=${device.id}`);
    const ins = this.db.prepare('INSERT INTO ref_data(entity,cloud_id,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(entity,cloud_id) DO UPDATE SET payload_json=excluded.payload_json');
    for (const [entity, rows] of Object.entries(boot.reference)) {
      for (const row of rows) ins.run(entity, row.id, JSON.stringify(row), row.updatedAt ?? row.updated_at ?? null);
    }
    this.setMeta('sync_token', boot.syncToken);
    return { deviceId: device.id, counts: boot.counts };
  }

  get deviceId() { return this.getMeta('device_id'); }

  /** Reserve a block of offline document numbers from the cloud. */
  async reserve(documentType, count) {
    const r = await this.api('POST', '/sync/number-reservations', { deviceId: this.deviceId, documentType, count });
    this.db.prepare('INSERT INTO reservations(id,document_type,prefix,suffix,padding_length,number_from,number_to,used_count,status) VALUES(?,?,?,?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status')
      .run(r.id, r.documentType, r.prefix ?? '', r.suffix ?? '', r.paddingLength, r.numberFrom, r.numberTo, r.status);
    return r;
  }

  /** Consume the next number from an active reservation (offline-safe). */
  nextNumber(documentType) {
    const res = this.db.prepare("SELECT * FROM reservations WHERE document_type=? AND status='active' AND used_count < (number_to-number_from+1) ORDER BY number_from ASC LIMIT 1").get(documentType);
    if (!res) {
      throw new Error(
        `No ${documentType} numbers left on this device. Connect to the network and sync to draw a new block.`,
      );
    }
    const next = res.number_from + res.used_count;
    this.db.prepare('UPDATE reservations SET used_count=used_count+1 WHERE id=?').run(res.id);
    // prefix + padded number + suffix, exactly as the server formats it. The
    // suffix carries the financial-year token after a roll-over (DC-0001/27-28);
    // dropping it made new-FY offline challans collide with last year's numbers.
    return `${res.prefix ?? ''}${String(next).padStart(res.padding_length, '0')}${res.suffix ?? ''}`;
  }

  /**
   * When an offline document was created, in the device's own clock.
   *
   * This used to be `new Date(Number(meta._clock) || Date.parse(meta.sync_token))`
   * — the last server instant, because a plant tablet's clock may be wrong.
   * That contract held only while sync_token was an ISO timestamp: bootstrap
   * still returns one, but pull now returns the opaque keyset cursor (base64
   * JSON), so from the FIRST pull onwards Date.parse gave NaN and
   * `new Date(NaN).toISOString()` threw "RangeError: Invalid time value" —
   * creating an offline challan, the whole point of the app, crashed on every
   * synced device. Nothing sets `_clock`. The device clock is the only clock
   * that exists while the link is down, and the cloud stamps its own
   * created_at when the document is pushed, so this value is for the operator's
   * own list and cannot be a source of failure.
   */
  localNow() { return new Date().toISOString(); }

  /** Numbers still available on this device for a document type. */
  remainingNumbers(documentType) {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(number_to - number_from + 1 - used_count), 0) AS n
           FROM reservations WHERE document_type=? AND status='active'`,
      )
      .get(documentType);
    return Number(r?.n ?? 0);
  }

  /**
   * Draw a fresh block when one is running low. Called on every pull, which is
   * the one moment the device is provably online, so the plant goes offline
   * with a full block instead of discovering the shortage at the batching panel.
   */
  async topUpNumbers(documentTypes) {
    const types = documentTypes?.length
      ? documentTypes
      : this.db.prepare('SELECT DISTINCT document_type d FROM reservations').all().map((r) => r.d);
    const drawn = [];
    for (const t of types) {
      if (this.remainingNumbers(t) >= RESERVE_MIN) continue;
      // One type failing (the cloud refusing, the link dropping mid-way) must
      // not take down the sync that triggered it.
      try {
        await this.reserve(t, RESERVE_COUNT);
        drawn.push(t);
      } catch {
        /* stay on what we have; the next pull tries again */
      }
    }
    return drawn;
  }

  /** Create an offline delivery challan (queued for push). */
  createOfflineChallan({ gradeLabel, quantityM3, slump, customerId, orderId, receiverName }) {
    const localId = this.newLocalId('L-DC');
    const challanNo = this.nextNumber('delivery_challan');
    // orderId matters for money: the cloud bills a challan at ITS ORDER's agreed
    // rate, and a challan pushed without one invoices at zero. The device has
    // the confirmed orders from the bootstrap, so send the one this load was
    // batched against.
    const payload = { challanNo, gradeLabel, quantityM3, slump, customerId, orderId, receiverName, challanStatus: 'delivered' };
    this.db.prepare('INSERT INTO local_docs(local_id,entity_name,doc_no,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(localId, 'delivery_challan', challanNo, JSON.stringify(payload), this.localNow());
    this.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json) VALUES(?,?,?,?)')
      .run('delivery_challan', localId, 'create', JSON.stringify(payload));
    return { localId, challanNo };
  }

  /** Create an offline batch ticket (queued for push). */
  createOfflineBatch({ gradeLabel, batchQuantityM3 }) {
    const localId = this.newLocalId('L-BT');
    const batchTicketNo = this.nextNumber('batch_ticket');
    const payload = { batchTicketNo, gradeLabel, batchQuantityM3 };
    this.db.prepare('INSERT INTO local_docs(local_id,entity_name,doc_no,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(localId, 'batch_ticket', batchTicketNo, JSON.stringify(payload), this.localNow());
    this.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json) VALUES(?,?,?,?)')
      .run('batch_ticket', localId, 'create', JSON.stringify(payload));
    return { localId, batchTicketNo };
  }

  /** Queue an update to a cloud record (carries base version for conflict check). */
  queueUpdate(entityName, cloudId, baseUpdatedAt, patch) {
    const localId = this.newLocalId('L-UPD');
    this.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json,cloud_id) VALUES(?,?,?,?,?)')
      .run(entityName, localId, 'update', JSON.stringify({ ...patch, __baseUpdatedAt: baseUpdatedAt, __cloudId: cloudId }), cloudId);
    return { localId };
  }

  pendingCount() { return this.db.prepare("SELECT count(*) c FROM sync_queue WHERE sync_status='pending'").get().c; }

  /**
   * Push all pending queue records; apply cloud results (synced / conflict).
   *
   * Sent in chunks of PUSH_CHUNK. A plant offline over a long weekend
   * accumulates hundreds of documents, and one request carrying all of them is
   * a body the site link may not survive and a single cloud transaction held
   * open for its whole duration — and if it fails, NOTHING settles and the
   * device retries the same oversized batch for ever. Each chunk settles on
   * its own, so a link that drops mid-push keeps the work already accepted.
   */
  async pushPending() {
    const pending = this.db.prepare("SELECT * FROM sync_queue WHERE sync_status='pending' ORDER BY id ASC").all();
    if (!pending.length) return { applied: 0, conflicts: 0, batches: 0 };
    let applied = 0;
    let conflicts = 0;
    let batches = 0;
    for (let i = 0; i < pending.length; i += PUSH_CHUNK) {
      const records = pending.slice(i, i + PUSH_CHUNK).map((q) => {
        const p = JSON.parse(q.payload_json);
        return {
          entityName: q.entity_name, localId: q.local_id, operation: q.operation,
          payload: p, cloudId: q.cloud_id ?? p.__cloudId, baseUpdatedAt: p.__baseUpdatedAt,
        };
      });
      const res = await this.api('POST', '/sync/push', { deviceId: this.deviceId, records });
      const byLocalId = new Map(records.map((rec) => [rec.localId, rec.entityName]));
      for (const r of res.results) {
        if (r.status === 'applied') {
          this.db.prepare("UPDATE sync_queue SET sync_status='synced', cloud_id=? WHERE local_id=?").run(r.cloudId ?? null, r.localId);
          this.db.prepare('UPDATE local_docs SET cloud_id=? WHERE local_id=?').run(r.cloudId ?? null, r.localId);
        } else {
            this.db.prepare("UPDATE sync_queue SET sync_status='conflict', last_error=? WHERE local_id=?").run(r.reason ?? 'conflict', r.localId);
          // entity_name was stored as a literal null, so the operator's list
          // could not even say WHICH kind of document was rejected.
          this.db.prepare('INSERT INTO conflicts(cloud_conflict_id,entity_name,local_id,reason) VALUES(?,?,?,?) ON CONFLICT(cloud_conflict_id) DO NOTHING')
            .run(r.conflictId, byLocalId.get(r.localId) ?? null, r.localId, r.reason);
        }
      }
      applied += res.applied;
      conflicts += res.conflicts;
      batches += 1;
    }
    return { applied, conflicts, batches };
  }

  /**
   * Pull cloud changes since the last token and merge into local ref data.
   *
   * Drains: the server pages each entity and sets `hasMore` when a page fills,
   * so we keep pulling from the returned token until it clears. Without this, a
   * backlog larger than one page (a plant offline long enough to accumulate many
   * changes) would leave the tail of the changes on the cloud, unseen. The guard
   * caps the loop so a misbehaving server can never spin it forever.
   */
  async pull() {
    const ins = this.db.prepare('INSERT INTO ref_data(entity,cloud_id,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(entity,cloud_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at');
    const total = {};
    let pages = 0;
    let more = true;
    while (more && pages < 10000) {
      pages += 1;
      const since = this.getMeta('sync_token') ?? '';
      const data = await this.api('GET', `/sync/pull?deviceId=${this.deviceId}&since=${encodeURIComponent(since)}`);
      for (const [entity, rows] of Object.entries(data.changes)) {
        // Conflicts are this device's own rejected pushes, not reference data:
        // they belong in the conflicts table the operator's list reads. They
        // arrive on the same cursor as the documents, so a conflict RAISED by
        // the cloud shows up here, and one RESOLVED in the office updates the
        // row instead of leaving the plant staring at a problem that is over.
        if (entity === 'conflicts') {
          for (const row of rows) this.mergeConflict(row);
          continue;
        }
        // The cloud retires a block when it ages out or the financial year
        // turns. Until now the device never heard, and kept issuing numbers
        // from it — after a roll-over, last year's numbers into this year's
        // books. nextNumber only draws from an ACTIVE block, so writing the
        // status through is what actually stops it.
        if (entity === 'reservations') {
          for (const row of rows) {
            this.db.prepare('UPDATE reservations SET status=? WHERE id=?').run(row.status ?? 'active', row.id);
          }
          continue;
        }
        for (const row of rows) ins.run(entity, row.id, JSON.stringify(row), row.updatedAt ?? null);
      }
      for (const [k, v] of Object.entries(data.counts ?? {})) total[k] = (total[k] ?? 0) + v;
      // Advance to the server's cursor before the next page. A server that
      // returns hasMore without advancing the token would otherwise loop; the
      // page guard above still bounds it.
      const prev = since;
      this.setMeta('sync_token', data.syncToken);
      more = Boolean(data.hasMore) && data.syncToken !== prev;
    }
    // Drained and provably online: this is the moment to refill a low block, so
    // the plant goes offline with numbers in hand.
    const reserved = await this.topUpNumbers();
    return { ...total, pages, reserved };
  }

  /** Upsert one cloud conflict into the local list (insert, or refresh a known one). */
  mergeConflict(row) {
    this.db
      .prepare(
        `INSERT INTO conflicts(cloud_conflict_id,entity_name,local_id,reason,resolution_status)
         VALUES(?,?,?,?,?)
         ON CONFLICT(cloud_conflict_id) DO UPDATE SET
           entity_name=excluded.entity_name,
           local_id=COALESCE(excluded.local_id, conflicts.local_id),
           reason=excluded.reason,
           resolution_status=excluded.resolution_status`,
      )
      .run(
        row.id,
        row.entityName ?? null,
        row.localId ?? null,
        row.conflictReason ?? null,
        row.resolutionStatus ?? 'pending',
      );
  }

  /** Conflicts for the operator to act on; pass a status to filter. */
  conflicts(status) {
    return status
      ? this.db.prepare('SELECT * FROM conflicts WHERE resolution_status=? ORDER BY rowid').all(status)
      : this.db.prepare('SELECT * FROM conflicts ORDER BY rowid').all();
  }

  /** How many of this device's documents the cloud is still refusing. */
  unresolvedConflictCount() {
    return this.db.prepare("SELECT count(*) c FROM conflicts WHERE resolution_status='pending'").get().c;
  }

  localDocs(entity) { return this.db.prepare('SELECT * FROM local_docs WHERE entity_name=? ORDER BY rowid').all(entity); }
  close() { this.db.close(); }
}
