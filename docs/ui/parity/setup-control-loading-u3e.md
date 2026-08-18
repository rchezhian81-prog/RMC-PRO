# Parity note — U3e loading-state sweep (Setup / Control + MasterCrud cascade)

**Change type:** presentation only — first-load skeletons. Same templated pattern
as U3a–d. No data, API, route, permission, control, form, or handler change.

## High-leverage: `MasterCrud` (one component → 12 routes)

`components/MasterCrud.tsx` drives every config-driven master screen. Adding the
skeleton there covers **all 10 Masters** (`/app/entity/{customers, sites, materials,
uoms, uom-conversions, suppliers, vehicles, drivers, transporters, concrete-grades}`)
plus **Plants** (`/app/entity/plants`) and **Number Series** (`/app/entity/number-series`).

- `loaded` set in `.finally()` on the `[config.path]` effect, and **reset to `false`
  at the start of that effect**, so switching entity types re-shows the skeleton
  during each load (not just the first mount).
- Skeleton column count is dynamic: `config.columns.length + (showActions ? 1 : 0)`.

## Bespoke Setup / Control pages (8)

| Route | List body/bodies gated |
|---|---|
| users | `rows` |
| roles | `roles` |
| numbering | `rows` |
| imports | `jobs` |
| settings | `rows` |
| audit | `rows` |
| corrections | `rows` |
| devices | `devices`, `reservations`, `conflicts` (3 tables) |

**Out of scope (correctly):** `company` (a config form, no data list) and the
Control **reports** center (a links/shortcut page). Detail `[id]` pages already had
loading.

## Special cases (verified)

- **audit** — its pre-existing `loading` state drives only the "Load more" button
  (`<Button loading={loading}>`), not the table body; the new first-load `loaded`
  skeleton is complementary, no conflict. (Audit stays excluded from pixel
  baselines — non-deterministic timestamps.)
- **corrections** (`[filterType]`), **devices** (`[reload]`), **audit**
  (`[applied, offset, load]`) — the dependency effect *is* the initial fetch;
  `.finally(() => setLoaded(true))` appended there. Later filter/search changes
  keep `loaded=true` (no re-flash); per-action loading is handled by each page's
  own existing state.

## Behavior preserved (regression checklist)

- [x] Routes resolve; all links/handlers unchanged (CRUD, import/export, resolve, search, pagination)
- [x] MasterCrud create/edit/deactivate/import/export unchanged; permission gating unchanged
- [x] Reloads after mutation refresh in place (no re-flash)
- [x] API requests unchanged; empty/error states intact
- [x] typecheck / lint (whole `apps/web/src`) / build green — independently re-verified; full diff reviewed
- [ ] Visual-regression — transient loading frame; `/ui-kit` `TableSkeleton` demo (U3a) is the evidence

## U3 loading sweep — COMPLETE

U3a Sales ✓ · U3b Production ✓ · U3c Inv/Purch/Fleet/Exp ✓ · U3d Billing ✓ ·
**U3e Setup/Control + MasterCrud ✓**. Every list route across the app now shows a
skeleton on first load instead of flashing its empty state.
