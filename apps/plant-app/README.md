# RMC Plant App (offline-first) — DORMANT BY DECISION

> **Status: shelved, not abandoned.** No device has ever been registered against
> production (`SELECT count(*) FROM devices` = 0), the pilot plant runs on the web
> app over a reliable link, and there is no packaging path — this app runs from a
> dev checkout only. Rather than leave it half-alive, it is explicitly dormant.
>
> **What that means in practice:**
> - Nobody is expected to install or use it. It is not packaged, not signed, and
>   has no update mechanism.
> - The code is **maintained, not rotting**: its 13 sync-engine tests run in CI on
>   every push (`pnpm --filter @rmc/plant-app test`), so the day it is revived it
>   starts from a known-good state rather than an archaeology exercise.
> - **The cloud half is live and stays live.** The `/sync/*` API, device
>   registration and revocation, number reservations with expiry, the conflict
>   round-trip and plant-scoped pull are all built, hardened and covered by the
>   integration suite. Nothing here needs redoing to switch the app back on.
>
> **To revive it**, in order: add a packaging step (electron-builder or Forge) for
> the target tablet's OS, decide an update path, register one device against a
> real plant, and pilot it with a single operator before a second. The offline
> design notes below are current and were re-verified during the offline-sync
> hardening pass.
>
> **Why it was shelved rather than deleted:** the reason it is unused is that this
> pilot's plant has connectivity, not that the design is wrong. A plant on a bad
> link is a normal thing in this industry, and when one arrives the server side is
> already waiting for it.

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
