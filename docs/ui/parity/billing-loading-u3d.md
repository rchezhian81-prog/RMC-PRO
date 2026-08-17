# Parity note — U3d loading-state sweep (Billing group)

**Routes (4 list pages):** `/app/billing/{invoices, receipts, outstanding, reports}`
(`/app/billing/invoices/[id]` already had a loading state — untouched.)
**Change type:** presentation only — first-load skeletons. Same templated pattern
as U3a–c. No data, API, route, permission, control, form, or handler change.

## Per-route detail

| Route | List body/bodies gated | Left untouched |
|---|---|---|
| billing/invoices | `rows` | the selected-invoice `lines` preview (a detail panel, not the list) |
| billing/receipts | `rows` | `openInvoices` (a form allocation selector, not a list body) |
| billing/outstanding | `rows` | — |
| billing/reports | `sales.rows`, `receipts` (2 sections) | the GST summary totals (not a `.length`-gated list) |

`loaded` is set in `.finally()` on the mount fetch only; reloads after a
mutation keep `loaded=true` (no re-flash).

## Behavior preserved (regression checklist)

- [x] Routes resolve; all links/handlers unchanged (create invoice/receipt, post, export, row → detail)
- [x] Reloads after mutation refresh in place (no re-flash)
- [x] `invoices` line-preview and `receipts` allocation selector untouched (form behavior intact)
- [x] Fields, forms, validation, permission-gated actions unchanged
- [x] API requests unchanged — same list/outstanding/gstSummary/salesRegister/receiptsRegister calls
- [x] Empty state on genuine zero-rows; error banner on failure — both intact
- [x] `ExportButton`s (outstanding, reports) still bound to the same arrays
- [x] typecheck / lint / build green; shared/api unit suite unaffected (web-only)
- [ ] Visual-regression — transient loading frame; `/ui-kit` `TableSkeleton` demo (U3a) is the evidence

## Notes

- Reuses U3a's `TableSkeleton`; no new shared code.
- **U3 loading sweep is now nearly complete** — U3a Sales ✓, U3b Production ✓,
  U3c Inv/Purch/Fleet/Exp ✓, **U3d Billing ✓**. Remaining U3e: Setup/Control
  (Overview, Setup, Masters-via-MasterCrud, Orders, Quality, Dispatch, Control, Admin).
