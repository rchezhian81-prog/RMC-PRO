# UI/UX Evidence-Closure Report

Verification-and-evidence checkpoint for the V2 (Deep Violet Matte) UI on branch
`claude/ui-v2-completion-audit`. **No merge, no deploy.** `main` and the
production image (`3467bc9`) are untouched. Local Postgres is a throwaway
in-container instance seeded from `serve-stack.mjs`.

---

## 1. Exact completion formula & final percentage

**Denominator D = 61 product routes** = 62 `page.tsx` files − `/ui-kit` (dev
harness, not a product route).

Each route is classified **VERIFIED** (evidence on every applicable dimension),
**N/A-EXCEPTION** (approved non-applicable, justified), or **PARTIAL** (renders,
but a dimension lacks independent evidence).

```
Completion% = (VERIFIED + N/A-EXCEPTION) / 61
100% is claimed only when PARTIAL = 0  (owner's rule: verified-or-approved-N/A)
```

| Status | Count |
|---|---|
| VERIFIED | 50 |
| N/A-EXCEPTION | 3 |
| PARTIAL | 8 |

**Completion = (50 + 3) / 61 = 53/61 = 86.9%.** Not 100% — 8 PARTIAL routes remain
(all transactional `[id]` detail pages; see §3).

> Implementation vs evidence: the 13.1% gap is an **evidence** gap, not an
> implementation gap. Every shared building block those 8 routes use (app shell,
> Card, Table, Field, Button, Badge, dialogs) is independently VERIFIED, and the
> flag is proven presentation-only (§4). The gap is "no seeded transactional
> record to render the detail page against," not "unverified code."

## 2. All 61 routes — verified / partial / N/A

**N/A-EXCEPTION (3)** — redirect-only, nothing to render: `/`, `/app`, `/admin`.

**PARTIAL (8)** — render with data but not independently captured (no seeded
transactional record): `/app/orders/[id]`, `/app/billing/invoices/[id]`,
`/app/sales/quotations/[id]`, `/app/sales/rate-contracts/[id]`,
`/app/dispatch/challans/[id]`, `/app/production/batch-tickets/[id]`,
`/app/qc/cubes/[id]`, `/admin/tenants/[id]`.

**VERIFIED (50)** — all others. Breakdown of how each was verified:
- **44 tenant routes** — 4-viewport (375/768/1024/1440) light+dark V2 baselines
  (`/app/dashboard, account, assistant, company, users, roles, numbering,
  imports, settings, entity/[name] (×12 masters), sales/{leads,quotations,
  rate-contracts,order-drafts,import-po}, orders, credit-holds,
  production/{mix-designs,plans,batch-queue,batch-tickets,stock,reports},
  qc/{slump,cubes}, dispatch/{board,challans}, inventory/{inward,weighbridge,
  adjustments,negative-stock,reports}, purchase/{orders,bills},
  fleet/{maintenance,fuel}, expenses/{vouchers,heads},
  billing/{invoices,receipts,outstanding,reports}, reports, corrections,
  devices`).
- **`/login`** — unauthenticated baseline.
- **`/admin/plans`, `/admin/tenants`** — super-admin persona evidence captures
  (`visual/evidence/`, light+dark × 4 vp).
- **`/app/audit`, `/app/dispatch/tracking`** — every dimension verified
  (functional parity, a11y, responsive, dark) **except** a committed pixel
  baseline, which is an approved N/A for that one dimension (non-deterministic:
  timestamps / live GPS). Render-evidence captured in `visual/evidence/`.
- **The 2 AI routes** (`assistant`, `import-po`) — captured in their deterministic
  AI-off state (the state they ship in for a tenant without an AI key).

## 3. The six previously-uncovered routes — resolution

| Category | Routes | Resolution |
|---|---|---|
| AI-gated | `/app/assistant`, `/app/sales/import-po` | **VERIFIED** — deterministic AI-off state added to the gated baseline set (4 vp, light+dark). |
| Super-admin | `/admin/plans`, `/admin/tenants` | **VERIFIED** — real super-admin session (seeded `super@visual.test`, no auth bypass); evidence captures. `/admin/tenants/[id]` → PARTIAL. |
| Non-deterministic | `/app/audit`, `/app/dispatch/tracking` | **VERIFIED** on all dimensions; pixel-baseline is an approved N/A (timestamps / live GPS). Render-evidence captured. |
| Detail `[id]` | 7 `/app/*/[id]` + `/admin/tenants/[id]` | **PARTIAL** — need a seeded transactional record; see §9 for the bounded follow-up to close them. |

No authentication, RBAC, or tenant isolation was bypassed to produce any capture.

## 4. Flag-OFF vs V2 functional parity — RESULT

Per-route functional fingerprints (headings, actions, links, inputs, table
columns, nav) captured against **both** skins from the same commit, fixture,
tenant and role, then diffed (`visual/parity-diff.mjs`):

```
routes compared: 56
functional differences: 0
✅ flag-OFF and V2 are identical in routes, information, actions, inputs, tables and nav
```

(Two false positives from React `useId` numbering were identified — identical
field counts/structure, only the non-functional id sequence differed — and
normalized.) This is the **empirical** counterpart to the structural proof: the
flag's entire app-logic footprint is one line (`layout.tsx` stamps
`data-ui="v2"`); it never gates routing, data, or permissions. Visual differences
are expected and allowed; **functional differences = 0.**

## 5. Transient-state → component/route mapping

States are delivered by shared components, so one verified component covers every
route that renders it **without route-specific alteration**:

| State | Component | Routes using it | Evidence |
|---|---|---|---|
| loading / skeleton / slow-network | `TableSkeleton` / `Loading` (U3) | 36 | `/ui-kit` + list baselines |
| empty | `EmptyState` | 46 | `/ui-kit` + e.g. billing-invoices |
| error | `ErrorState` (`role="alert"`) | 61 | `/ui-kit` |
| validation | `Field` error + `aria-invalid` (U6) | forms (MasterCrud + bespoke) | `/ui-kit` Form-fields section |
| permission denied | `PermissionDenied` | **2** (component + 1) | `/ui-kit` — see gap in §9 |
| offline | `OfflineBanner` (U4) | global (all routes) | `/ui-kit` connectivity section |
| destructive confirmation | `ConfirmDialog` (danger) | 16 | `/ui-kit` dialog |
| disabled | `Button`/input `disabled` | 14 | `/ui-kit` buttons |
| success | `--mn-success` messages | 41 | `/ui-kit` alerts |
| long content / overflow | `Table` `overflow-x`, `.mn-cmdbar` wrap | all tables/bars | U5 shell probe + tablet/mobile baselines |

## 6. Four-viewport responsive result

Every VERIFIED route captured at **375 / 768 / 1024 / 1440**, light+dark → **456
V2 baselines** (57 screens × 4 × 2). 1024 is the shell's sidebar-collapse
breakpoint; 375/768 emulate touch. Nav (sidebar↔drawer), tables (`overflow-x`),
forms, dialogs/drawers, filters and command bars verified across all four (U5 +
these baselines). No charts exist (funnels/stats are token-styled divs).

## 7. Light / dark + accessibility result

- **Dark:** 57/57 screens genuinely dark (luminance sweep — dark ≈30 vs light
  ≈247); all dark token pairs pass **WCAG AA** (4.52–14.28); 0 hardcoded colours
  bypass the tokens. (U8.)
- **A11y:** functional probe 9/9 — every `label[for]` resolves, `aria-describedby`
  wired for help+error, Tab/Shift+Tab trapped in modals, Esc restores focus.
  Shared `States` ship `role="alert"`/`role="status"`; skip-link present. (U6.)

## 8. Test outputs (gates)

| Gate | Result |
|---|---|
| Lint (`eslint .`) | ✅ clean |
| Typecheck (turbo, 5 pkgs) | ✅ |
| Production build (turbo) | ✅ 3/3 |
| Unit tests | ✅ 452/452 (82.5% stmt) |
| Integration | ✅ **29/29 test files** (local, throwaway PG) + green on PR #64 CI (run 31988777377) |
| E2E (isolation·rbac·uat·security) | ✅ **34 passed / 0 failed** (isolation 8 · rbac 6 · uat 11 · security 9) local + green on CI |
| Accessibility probe | ✅ 9/9 |
| Visual generation | ✅ 237 passed (3 fingerprint-skips) |
| Baseline integrity | ✅ 0 theme-anomalies, 0 blanks, 0 duplicates |
| Console errors | benign only — API logs "AI not set up" (AI off by design); no client console errors |
| Dependency/security (`pnpm audit`) | ⚠️ 21 pre-existing advisories (9 mod / 12 high, e.g. typeorm) — **0 introduced by this work** (no deps added) |

## 9. Remaining defects, exceptions & risks

1. **8 PARTIAL `[id]` routes** — need seeded transactional records. Bounded
   follow-up: adapt the existing `order-to-cash` fixture to seed one
   quotation→order→challan→invoice chain (+ rate-contract, cube-set) and capture
   the detail pages. Est. 1 focused pass. Until then: parity holds by structure +
   shared-component verification.
2. **`PermissionDenied` only wired in 1 place** — routes gate access by hiding nav
   rather than rendering the explicit "restricted" component. Not a regression
   (pre-existing pattern), but the per-route permission-denied *state* is not
   exercised. Honest gap, not introduced here.
3. **21 dependency advisories** — pre-existing, unrelated to UI/UX; recommend a
   separate dependency-remediation task (typeorm ≥0.3.31, etc.).
4. **Flag-OFF pixel baselines removed** — intentional (retired skin; parity now
   proven functionally). If a flag-OFF visual set is ever wanted, the workflow
   regenerates it.

## 10. Proposed PR sequence (dependency-aware; independently reviewable)

The current single PR (#64) mixes implementation, test-infra and generated
evidence. Recommended split for clean review + safe rollback:

1. **PR-A — UI implementation** (revert point: `main`). App-only:
   `globals.css`, `components/**`, `lib/use-*.ts`, `app/**`, `ui-kit/**`. No test
   or baseline files. Reviewable as pure presentation. Rollback = revert PR-A.
2. **PR-B — visual/test infrastructure** (base: PR-A). `playwright.config`,
   `visual/*.ts|*.mjs` (screens, baseline.spec, evidence.spec, global-setup,
   serve-stack, parity-diff), `visual.yml`. No baseline images. Rollback = revert
   PR-B; app unaffected.
3. **PR-C — generated evidence** (base: PR-B). `visual/__screenshots__/**` +
   `visual/evidence/**` only. Large but pure artifacts; review by spot-check.
   Rollback = revert PR-C; only baselines lost.
4. **PR-D — docs** (`docs/ui/**`). Independent; mergeable any time.

Do not open these as overlapping PRs — B depends on A, C on B. None should merge
until you approve. (This report proposes the sequence; it does **not** open them.)

## 11. Confirmation — main & production untouched

- **Production image:** still `3467bc9`; not rebuilt, not redeployed. Merging this
  branch would **not** ship it — a separate `Build images` run + staged deploy is
  required, gated on the owner.
- **`main`:** the only commit beyond `3467bc9` is `bbbf134` (owner-authorized PR
  #63 — the dormant `visual.yml`). `git diff 3467bc9..main` = that one file.
- **No backend touched on the branch:** zero files under `apps/api/**`,
  `packages/shared/src/**`, or any `migrations/**`; no API/auth/RBAC/tenant/module
  /business-logic change (also proven by the §4 functional-parity diff).
