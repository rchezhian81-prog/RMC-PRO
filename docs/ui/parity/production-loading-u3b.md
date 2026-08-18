# Parity note — U3b loading-state sweep (Production group)

**Routes:** `/app/production/{mix-designs, plans, batch-queue, batch-tickets, stock, reports}`
**Change type:** presentation only — first-load skeletons. No data, API, route,
permission, control, or handler change. Same templated pattern as U3a (Sales).

## The gap being fixed

Each page initialises its list state to `[]` and renders `X.length ? <Table> :
<EmptyState>`, so during the in-flight first fetch it flashes the empty state
before data arrives. U3b gates each list body on a `loaded` flag and shows
`<TableSkeleton>` until the first fetch settles.

## Per-route detail

| Route | List state(s) gated | Skeleton cols |
|---|---|---|
| mix-designs | `rows` | 5 |
| plans | `rows` | 5 |
| batch-queue | `rows` | 6 |
| batch-tickets | `rows` | 6 |
| stock | `balances` **and** `ledger` (two tables) | 3 / 6 |
| reports | `byGrade`, `consumption`, `variance` (three sections) | 4 / 2 / 5 |

The `loaded` flag is set in `.finally()` on the initial `useEffect` fetch
(`reload()`, `.list()`, or the report IIFE). Reloads after a create/action keep
`loaded=true`, so there is no re-flash on refresh.

## Behavior preserved (regression checklist)

- [x] Routes resolve; all links/handlers unchanged (create, open, batch actions, export)
- [x] Reloads after mutation still refresh in place (no re-flash)
- [x] Fields, forms, validation unchanged
- [x] Permissions / module gating unchanged (server-enforced)
- [x] API requests unchanged — same list/summary/variance/consumption/balances/ledger calls
- [x] Empty state still shows on genuine zero-rows; error banner still shows on failure
- [x] `ExportButton` (stock) still binds to the same `balances`/`ledger` arrays
- [x] Keyboard workflow unchanged
- [x] typecheck / lint / build green; shared/api unit suite unaffected (web-only)
- [ ] Visual-regression — transient loading frame; evidenced by the `/ui-kit`
      `TableSkeleton` demo (U3a). Settled-state route baselines unchanged.

## Notes

- Detail route `batch-tickets/[id]` already had a loading state — untouched.
- Same `TableSkeleton` primitive introduced in U3a; no new shared code in U3b.
- Group progress: U3a Sales ✓, **U3b Production ✓**. Remaining U3c–e:
  Inventory/Purchase/Fleet/Expenses, Billing, Setup/Control.
