# Parity note — U3a loading-state sweep (Sales group)

**Routes:** `/app/sales/leads`, `/app/sales/quotations`, `/app/sales/rate-contracts`,
`/app/sales/order-drafts`
**Change type:** presentation only — adds a first-load skeleton. No data, API,
route, permission, control, or handler change.

## The gap being fixed

Each list page initialises `rows = []` and renders `rows.length ? <Table> :
<EmptyState>`. During the in-flight initial fetch that shows the **empty state**
("No leads yet") **before the data arrives** — a misleading empty flash. U3a gates
the list body on a `loaded` flag and shows `<TableSkeleton>` until the first fetch
settles.

## What changed (identical in all four pages)

| Before | After |
|---|---|
| `const [error] = useState(...)` | `+ const [loaded, setLoaded] = useState(false)` |
| `reload().catch(setError)` (initial `useEffect`) | `reload().catch(setError).finally(() => setLoaded(true))` |
| `{rows.length ? <Table> : <EmptyState>}` | `{!loaded ? <TableSkeleton cols={N}/> : rows.length ? <Table> : <EmptyState>}` |

New shared primitive: `TableSkeleton` in `components/ui/States.tsx` (shimmer rows,
`role="status" aria-busy`, reduced-motion via the existing `.mn-skel` rule).

## Behavior preserved (regression checklist)

- [x] Routes still resolve; all links/handlers unchanged (create, open, reload)
- [x] `reload()` after create/follow-up still refreshes the table (loaded stays true — no re-flash)
- [x] Fields, forms, validation unchanged
- [x] Permissions / module gating unchanged (nav-level, server-enforced)
- [x] API requests unchanged — same list/create/get calls, same contract
- [x] Empty state still shows when the fetch genuinely returns zero rows
- [x] Error state still shows on fetch failure (error banner) — `loaded` becomes true, existing empty/error path unchanged
- [x] Keyboard workflow unchanged
- [x] typecheck / lint / build green; shared/api unit suite unaffected (web-only)
- [ ] Visual-regression diff — the transient loading frame is evidenced by the
      `/ui-kit` `TableSkeleton` demo; the authenticated-route baselines are
      unchanged in the settled state (skeleton only appears mid-fetch)

## Notes

- Detail routes (`quotations/[id]`, `rate-contracts/[id]`) and `import-po` already
  had loading states — untouched.
- Pattern is now templated for U3b–e (Production, Inventory/Purchase/Fleet/Expenses,
  Billing, Setup/Control).
