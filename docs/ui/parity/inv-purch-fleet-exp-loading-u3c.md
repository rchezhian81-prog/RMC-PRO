# Parity note — U3c loading-state sweep (Inventory / Purchase / Fleet / Expenses)

**Routes (11):** `/app/inventory/{inward, weighbridge, adjustments, negative-stock, reports}`,
`/app/purchase/{orders, bills}`, `/app/fleet/{maintenance, fuel}`,
`/app/expenses/{vouchers, heads}`
**Change type:** presentation only — first-load skeletons. No data, API, route,
permission, control, form, or handler change. Same templated pattern as U3a/U3b.

## The gap being fixed

Each page initialises its list state to `[]` and renders `X.length ? <Table> :
<EmptyState>`, flashing the empty state during the in-flight first fetch. U3c gates
each list body on a `loaded` flag and shows `<TableSkeleton>` until the first fetch
settles. `loaded` is set in `.finally()` on the mount fetch only; reloads after a
mutation keep `loaded=true` (no re-flash).

## Per-route detail

| Route | List body/bodies gated |
|---|---|
| inventory/inward | `rows` |
| inventory/weighbridge | `rows` |
| inventory/adjustments | `balances` |
| inventory/negative-stock | `rows` |
| inventory/reports | `negative`, `low`, `valuation.rows`, `movement` (4 sections) |
| purchase/orders | `rows` |
| purchase/bills | `rows` |
| fleet/maintenance | `schedules`, `jobs` (2 tables) |
| fleet/fuel | `rows` |
| expenses/vouchers | `rows` **only** — the on-demand allocation report (`byCostObject.buckets`, `byHead.buckets`) is deliberately **not** gated (it has its own "Refresh to roll up" empty state) |
| expenses/heads | `groups`, `heads` (2 tables) |

## Behavior preserved (regression checklist)

- [x] Routes resolve; all links/handlers unchanged (create/post/approve/export/etc.)
- [x] Reloads after mutation refresh in place (no re-flash)
- [x] Filter-dependent effects (`negative-stock`, `fleet/fuel`) — the mount effect *is* the initial fetch; `.finally` set there; later filter changes keep `loaded=true`
- [x] `expenses/vouchers` allocation report untouched (own empty state preserved)
- [x] Fields, forms, validation, permission-gated actions unchanged
- [x] API requests unchanged — same list/summary/report calls, same contract
- [x] Empty state on genuine zero-rows; error banner on failure — both intact
- [x] `ExportButton`s still bound to the same arrays
- [x] typecheck / lint / build green (independently re-verified); shared/api units unaffected
- [ ] Visual-regression — transient loading frame; `/ui-kit` `TableSkeleton` demo (U3a) is the evidence; settled-route baselines unchanged

## Notes

- Executed as a templated sweep and **independently verified**: typecheck, lint
  (whole `apps/web/src`), and `next build` all green; full diff reviewed for
  behavior-preservation (esp. the multi-table pages and the vouchers carve-out).
- Reuses U3a's `TableSkeleton`; no new shared code.
- Group progress: U3a Sales ✓, U3b Production ✓, **U3c Inv/Purch/Fleet/Exp ✓**.
  Remaining U3d–e: Billing, Setup/Control.
