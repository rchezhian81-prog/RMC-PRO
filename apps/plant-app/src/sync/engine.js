import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

/**
 * Offline sync engine for the RMC plant app (Design Doc 8). Runs in the Electron
 * main process (Node) and in a standalone Node harness — it uses node:sqlite for
 * the local store and the cloud sync API for register / bootstrap / reserve /
 * push / pull / conflict resolution. Pure logic, no Electron dependency, so it
 * is fully unit-testable.
 */
export class SyncEngine {
  constructor({ dbPath = ':memory:', baseUrl, token } = {}) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    this.baseUrl = baseUrl;
    this.token = token;
  }

  setAuth(baseUrl, token) { this.baseUrl = baseUrl; this.token = token; }
  setMeta(key, value) { this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); }
  getMeta(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null; }

  async api(method, path, body) {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
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
    this.db.prepare('INSERT INTO reservations(id,document_type,prefix,padding_length,number_from,number_to,used_count,status) VALUES(?,?,?,?,?,?,0,?)')
      .run(r.id, r.documentType, r.prefix ?? '', r.paddingLength, r.numberFrom, r.numberTo, r.status);
    return r;
  }

  /** Consume the next number from an active reservation (offline-safe). */
  nextNumber(documentType) {
    const res = this.db.prepare("SELECT * FROM reservations WHERE document_type=? AND status='active' AND used_count < (number_to-number_from+1) ORDER BY number_from ASC LIMIT 1").get(documentType);
    if (!res) throw new Error(`No number reservation available for ${documentType}`);
    const next = res.number_from + res.used_count;
    this.db.prepare('UPDATE reservations SET used_count=used_count+1 WHERE id=?').run(res.id);
    return `${res.prefix ?? ''}${String(next).padStart(res.padding_length, '0')}`;
  }

  /** Create an offline delivery challan (queued for push). */
  createOfflineChallan({ gradeLabel, quantityM3, slump, customerId, receiverName }) {
    const localId = `L-DC-${Date.now()}-${Math.floor(this.db.prepare('SELECT count(*) c FROM local_docs').get().c)}`;
    const challanNo = this.nextNumber('delivery_challan');
    const payload = { challanNo, gradeLabel, quantityM3, slump, customerId, receiverName, challanStatus: 'delivered' };
    this.db.prepare('INSERT INTO local_docs(local_id,entity_name,doc_no,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(localId, 'delivery_challan', challanNo, JSON.stringify(payload), new Date(Number(this.getMeta('_clock') ?? 0) || Date.parse(this.getMeta('sync_token'))).toISOString());
    this.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json) VALUES(?,?,?,?)')
      .run('delivery_challan', localId, 'create', JSON.stringify(payload));
    return { localId, challanNo };
  }

  /** Create an offline batch ticket (queued for push). */
  createOfflineBatch({ gradeLabel, batchQuantityM3 }) {
    const localId = `L-BT-${Date.now()}-${Math.floor(this.db.prepare('SELECT count(*) c FROM local_docs').get().c)}`;
    const batchTicketNo = this.nextNumber('batch_ticket');
    const payload = { batchTicketNo, gradeLabel, batchQuantityM3 };
    this.db.prepare('INSERT INTO local_docs(local_id,entity_name,doc_no,payload_json) VALUES(?,?,?,?)')
      .run(localId, 'batch_ticket', batchTicketNo, JSON.stringify(payload));
    this.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json) VALUES(?,?,?,?)')
      .run('batch_ticket', localId, 'create', JSON.stringify(payload));
    return { localId, batchTicketNo };
  }

  /** Queue an update to a cloud record (carries base version for conflict check). */
  queueUpdate(entityName, cloudId, baseUpdatedAt, patch) {
    const localId = `L-UPD-${Date.now()}`;
    this.db.prepare('INSERT INTO sync_queue(entity_name,local_id,operation,payload_json,cloud_id) VALUES(?,?,?,?,?)')
      .run(entityName, localId, 'update', JSON.stringify({ ...patch, __baseUpdatedAt: baseUpdatedAt, __cloudId: cloudId }), cloudId);
    return { localId };
  }

  pendingCount() { return this.db.prepare("SELECT count(*) c FROM sync_queue WHERE sync_status='pending'").get().c; }

  /** Push all pending queue records; apply cloud results (synced / conflict). */
  async pushPending() {
    const pending = this.db.prepare("SELECT * FROM sync_queue WHERE sync_status='pending' ORDER BY id ASC").all();
    if (!pending.length) return { applied: 0, conflicts: 0 };
    const records = pending.map((q) => {
      const p = JSON.parse(q.payload_json);
      return {
        entityName: q.entity_name, localId: q.local_id, operation: q.operation,
        payload: p, cloudId: q.cloud_id ?? p.__cloudId, baseUpdatedAt: p.__baseUpdatedAt,
      };
    });
    const res = await this.api('POST', '/sync/push', { deviceId: this.deviceId, records });
    for (const r of res.results) {
      if (r.status === 'applied') {
        this.db.prepare("UPDATE sync_queue SET sync_status='synced', cloud_id=? WHERE local_id=?").run(r.cloudId ?? null, r.localId);
        this.db.prepare('UPDATE local_docs SET cloud_id=? WHERE local_id=?').run(r.cloudId ?? null, r.localId);
      } else {
        this.db.prepare("UPDATE sync_queue SET sync_status='conflict', last_error=? WHERE local_id=?").run(r.reason ?? 'conflict', r.localId);
        this.db.prepare('INSERT INTO conflicts(cloud_conflict_id,entity_name,local_id,reason) VALUES(?,?,?,?) ON CONFLICT(cloud_conflict_id) DO NOTHING')
          .run(r.conflictId, null, r.localId, r.reason);
      }
    }
    return { applied: res.applied, conflicts: res.conflicts };
  }

  /** Pull cloud changes since the last token and merge into local ref data. */
  async pull() {
    const since = this.getMeta('sync_token') ?? '';
    const data = await this.api('GET', `/sync/pull?deviceId=${this.deviceId}&since=${encodeURIComponent(since)}`);
    const ins = this.db.prepare('INSERT INTO ref_data(entity,cloud_id,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(entity,cloud_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at');
    for (const [entity, rows] of Object.entries(data.changes)) {
      for (const row of rows) ins.run(entity, row.id, JSON.stringify(row), row.updatedAt ?? null);
    }
    this.setMeta('sync_token', data.syncToken);
    return data.counts;
  }

  localDocs(entity) { return this.db.prepare('SELECT * FROM local_docs WHERE entity_name=? ORDER BY rowid').all(entity); }
  close() { this.db.close(); }
}
