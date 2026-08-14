# Parity-matrix template (per migrated page)

Every UI migration PR that restyles a page must include a completed parity matrix
for that page. A page is **not** migration-complete until **every** live control,
field, action, state, and permission is mapped and its behavior verified
unchanged. Copy the block below into the PR description, one table per page.

> Rule: the real application is the source of truth for behavior. The Figma
> reference informs appearance only. No live control may disappear merely because
> it is absent from the Figma prototype.

---

## Page: `<route>` — `<file path>`

**Screenshots:** before → after (desktop 1440 / laptop 1280 / tablet 768 /
mobile 390; light + dark). Attach or link the Playwright diff.

| Live behavior / control | Existing implementation (file:line) | New visual location | Behavior preserved | Test evidence |
|---|---|---|---|---|
| e.g. "Create" button (perm-gated `masters.create`) | `MasterCrud.tsx:NN` | restyled header action | ✅ same handler, same perm gate | visual diff + route-resolve test |
| e.g. status filter select | `orders/page.tsx:NN` | restyled `mn-input` | ✅ same query param | — |
| e.g. row → detail navigation | `.../page.tsx:NN` | restyled table row | ✅ same route | — |
| … every field, action, empty/loading/error state, and permission … | | | | |

### Functional regression checklist (tick all)

- [ ] All original routes on this page still resolve
- [ ] All original buttons / links work (same handlers)
- [ ] All original fields present; validation behavior unchanged
- [ ] Permissions still enforced (perm- and module-gated controls unchanged)
- [ ] Tenant / plant boundaries unchanged
- [ ] API requests unchanged (same endpoints, same request/response contract)
- [ ] Offline / sync indicators unchanged (where present)
- [ ] Audit events unchanged (where the page triggers them)
- [ ] Import / export behavior unchanged (where present)
- [ ] Keyboard workflow unchanged (Enter-to-submit; Esc/Enter in dialogs)
- [ ] Existing automation selectors preserved or migrated safely
- [ ] Existing unit / integration / e2e tests green
- [ ] Visual-regression diff reviewed (intended changes only)
- [ ] No significant performance regression (within agreed budgets)

### Notes / intentional visual changes

- …
