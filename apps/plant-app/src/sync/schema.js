/** Local SQLite schema for the offline plant app (Design Doc 8 §12). */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Cloud reference data pulled at bootstrap (stored as JSON rows).
CREATE TABLE IF NOT EXISTS ref_data (
  entity TEXT NOT NULL,
  cloud_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (entity, cloud_id)
);

-- Cloud-issued number reservations (prevent duplicate offline numbers).
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  prefix TEXT,
  padding_length INTEGER NOT NULL DEFAULT 4,
  number_from INTEGER NOT NULL,
  number_to INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

-- Locally-created documents (offline entry).
CREATE TABLE IF NOT EXISTS local_docs (
  local_id TEXT PRIMARY KEY,
  entity_name TEXT NOT NULL,
  doc_no TEXT,
  payload_json TEXT NOT NULL,
  cloud_id TEXT,
  created_at TEXT
);

-- Outgoing sync queue (Doc 8 §12).
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_name TEXT NOT NULL,
  local_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  cloud_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

-- Conflicts reported by the cloud on push.
CREATE TABLE IF NOT EXISTS conflicts (
  cloud_conflict_id TEXT PRIMARY KEY,
  entity_name TEXT,
  local_id TEXT,
  reason TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'pending'
);
`;
