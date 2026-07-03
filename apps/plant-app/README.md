# RMC Plant App (offline-first)

Standalone **Electron** desktop app for the plant office PC (Design Doc 7 §Plant App,
Doc 8 offline sync). Works offline-first: challan / batch entry happens against a
local **SQLite** store and syncs to the cloud when online.

## Architecture

- `src/main.js` — Electron main process; owns the local SQLite via the sync engine
  and exposes sync actions to the renderer over IPC.
- `src/preload.cjs` — context-isolated bridge (`window.rmc.*`).
- `src/renderer/index.html` — minimal offline operator UI.
- `src/sync/engine.js` — **sync engine** (framework-free, unit-testable). Uses
  `node:sqlite` for the local store and the cloud `/sync/*` API for
  register → bootstrap → reserve → push → pull → conflict resolution.
- `src/sync/schema.js` — local SQLite schema (ref data, reservations, local docs,
  sync_queue, conflicts).

## Offline safety

- **Number reservations**: the cloud issues number blocks per device
  (`/sync/number-reservations`) so offline challans never collide with online ones.
- **Local/cloud IDs**: every offline record keeps its `local_id`; the cloud UUID is
  stored back as `cloud_id` after a successful push (Doc 8 §13).
- **Idempotent push**: re-pushing a create returns the existing cloud record.
- **Conflict detection**: updates carry the record's base version; a stale base is
  reported as a conflict and surfaced for `keep_cloud` / `keep_local` resolution.

## Run

```bash
# Sync-engine harness (no GUI) against a running API:
node --experimental-sqlite src/sync/selftest.js

# Electron GUI (requires the electron binary; not available in headless CI):
pnpm --filter @rmc/plant-app start
```

> The sync engine uses `node:sqlite` (Node 22 `--experimental-sqlite`) so it runs in
> both Electron's Node runtime and a standalone harness with no native build step.
