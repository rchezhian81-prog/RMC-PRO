# UI/UX Evidence-Closure Report

Verification-and-evidence checkpoint for the V2 (Deep Violet Matte) UI on branch
`claude/ui-v2-completion-audit`. **No merge, no deploy.** `main` and the
production image (`3467bc9`) are untouched. All seeding is in a **throwaway local
Postgres + the VISUAL test tenant** — never production, no real data.

---

## 1. Exact completion formula & final percentage

**61 product routes** = 62 `page.tsx` − `/ui-kit` (dev harness). Each route is
**VERIFIED** (evidence on every applicable dimension), **N/A-EXCEPTION** (approved
non-applicable, justified), or **PARTIAL**.

Two figures, reported separately (N/A never counted as visually verified):

```
A. Applicable-route verification = VERIFIED / (61 − N/A) = 58 / 58 = 100%
B. Total disposition             = 58 VERIFIED + 3 N/A-EXCEPTION = 61
```

| Status | Count |
|---|---|
| VERIFIED | 58 |
| N/A-EXCEPTION (redirects) | 3 |
| PARTIAL | 0 |

**100% of the 58 applicable routes are VERIFIED**, and the 3 N/A classifications
(`/`, `/app`, `/admin` — redirect-only) remain valid. The 8 `[id]` detail routes
that were PARTIAL are now VERIFIED against seeded synthetic records (§3).

> "VERIFIED" = every applicable dimension has evidence. Most routes carry gated
> pixel baselines; a minority (the 8 detail routes + `audit` + `dispatch/tracking`)
> carry **evidence captures** (page screenshots) + functional fingerprints instead
> of pixel baselines, because their data contains per-record timestamps — the
> pixel-regression *dimension* is a justified N/A for those, but the routes are
> fully verified on render, function, responsive and dark.

## 2. All 61 routes — verified / partial / N/A

- **N/A-EXCEPTION (3):** `/`, `/app`, `/admin` (redirect-only, nothing to render).
- **PARTIAL: none.**
- **VERIFIED (58):** the 50 previously verified + the 8 detail routes below.

## 3. The eight detail `[id]` routes — verification table

Owner's list reconciled to the real route files (`dispatch/deliveries` =
`dispatch/challans`; `sales/orders` = top-level `orders`; `billing/receipts/[id]`
**does not exist** — receipts has no detail page — and the real 8th is
`qc/cubes/[id]`).

| # | Route | Fixture record | Role / tenant | Light+Dark × 4vp | Fingerprint parity | Status |
|---|---|---|---|---|---|---|
| 1 | `/app/sales/quotations/[id]` | QTN0001 | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 2 | `/app/sales/rate-contracts/[id]` | RC-0001 | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 3 | `/app/orders/[id]` | ORD0001 (confirmed) | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 4 | `/app/production/batch-tickets/[id]` | BATCH-0001 (confirmed) | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 5 | `/app/dispatch/challans/[id]` | DC0001 (delivered) | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 6 | `/app/qc/cubes/[id]` | CUBE-0001 | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 7 | `/app/billing/invoices/[id]` | INV0001 (issued, ₹2,95,000) | owner / VISUAL | ✅ | ✅ | VERIFIED |
| 8 | `/admin/tenants/[id]` | VISUAL tenant | super-admin / platform | ✅ | ✅ | VERIFIED |

Real-data render confirmed (e.g. INV0001: M25/DC0001, 50 m³ @ ₹5,000 → taxable
₹2,50,000, CGST ₹22,500 + SGST ₹22,500, total ₹2,95,000 — GST maths correct).
Permission behaviour verified: `/admin/tenants/[id]` renders only under the
super-admin session (the owner session is 403 on `/admin/*`, per the e2e suite).

**Defect found & fixed during this verification** — the not-found/error state of
all 7 tenant detail pages showed a **perpetual loading spinner** on a failed
initial fetch (bad link / deleted record / cross-tenant id): the `if (!record)
return <Loading/>` guard ran before any error render. Fixed (presentation only,
one line each): render `<ErrorState>` when the record is null *and* an error is
set, else the spinner. Loaded-page inline errors unchanged. Commit `03284d2`.

## 4. Flag-OFF vs V2 functional parity

Per-route functional fingerprints (headings, actions, links, inputs, table
columns, nav) captured against **both** skins from the same commit, fixture,
tenant and role, then diffed (`visual/parity-diff.mjs`):

```
routes compared: 64  (56 list/form + 8 detail)
functional differences: 0
✅ flag-OFF and V2 are identical in routes, information, actions, inputs, tables and nav
```

Two classes of non-functional artifact were identified and normalized: React
`useId` values, and record **UUIDs embedded in detail-link hrefs** (each seed run
mints different ids — same link text/path). Visual differences are expected and
allowed; **functional differences = 0.** This is the empirical counterpart to the
structural proof (the flag's whole app-logic footprint is one `data-ui` attribute).

## 5. Responsive + light/dark evidence

- **456 V2 baselines** for the 57 gated screens at **375 / 768 / 1024 / 1440**,
  light+dark (1024 = the shell's sidebar-collapse breakpoint; 375/768 emulate
  touch). Nav, tables, forms, dialogs, drawers, filters, overflow verified across
  all four.
- **8 detail routes** + super-admin `/admin/*` + `audit`/`tracking`: light+dark ×
  4 viewports evidence captures in `visual/evidence/`.
- **Dark:** 57/57 gated screens genuinely dark (luminance sweep); all dark token
  pairs pass **WCAG AA** (4.52–14.28); 0 hardcoded colours bypass the tokens.
- **A11y:** functional probe 9/9 (label↔input, `aria-describedby`, Tab/Shift+Tab
  focus-trap, Esc restore); shared `States` ship `role="alert"`/`status`.

## 6. Fixture & cleanup details (data safety)

- **Where:** local throwaway Postgres, VISUAL test tenant only. Never production;
  no real customer/employee/supplier/commercial data.
- **What:** ONE synthetic order-to-cash chain + rate-contract + QC cube-set,
  created via existing domain endpoints (`seed-fixtures.mjs`), fixed FY-2026-27
  dates, `VISUAL-TEST` markers on free-text fields, reusing the seeded CUST-001
  sample customer.
- **No app change:** goes through the real API only — no API/business-rule change,
  no auth/RBAC/tenant-isolation weakening, and **no ids hard-coded into the app**
  (ids flow spec-side via `.fixtures.json`, which is **gitignored**).
- **Idempotent + removable:** serve-stack resets the DB each run (fresh, identical
  result); the entire cluster + tenant are ephemeral. **No fixture record is
  committed** and none touches any real database.
- **No secrets/PII in evidence:** screenshots show synthetic data only.

## 7. Test results (gates)

| Gate | Result |
|---|---|
| Lint (`eslint .`) | ✅ clean |
| Typecheck (turbo, 5 pkgs) | ✅ |
| Production build (turbo, fixed source) | ✅ 3/3 |
| Unit tests | ✅ 452/452 (82.5% stmt) — shared/api, unaffected by the web-page fix |
| Integration | ✅ 29/29 test files (local) + green on PR #64 CI |
| E2E (isolation·rbac·uat·security) | ✅ 34/0 (local) + green on CI |
| Accessibility probe | ✅ 9/9 |
| Visual generation | ✅ 237 passed + detail/evidence captures |
| Functional parity | ✅ 0 diffs / 64 routes |
| Baseline integrity | ✅ 0 theme-anomalies, 0 blanks, 0 byte-duplicates |
| Console errors/warnings | benign only — API logs "AI not set up" (AI off by design); no client console errors |
| Dependency/security (`pnpm audit`) | ⚠️ 21 pre-existing advisories (9 mod / 12 high) — **0 introduced** (no deps added) |
| Fixture cleanup | ✅ ephemeral DB reset per run; `.fixtures.json` gitignored; no fixture committed |

## 8. Remaining PARTIAL / N/A / risks

- **PARTIAL: none.**
- **N/A-EXCEPTION (3):** `/`, `/app`, `/admin` — redirect-only; unchanged, valid.
- **`PermissionDenied` component wired in 1 place** — routes gate by hiding nav
  rather than rendering the explicit "restricted" state; pre-existing pattern, not
  introduced here.
- **21 dependency advisories** — pre-existing, unrelated to UI/UX; separate
  remediation recommended.
- Detail routes carry **evidence captures**, not pixel-regression baselines (data
  has timestamps) — a deliberate, documented choice.

## 9. Proposed split PR sequence (dependency-aware) — see §10 of the checkpoint

Prepared, **not opened**. PR #64 stays open and is marked *superseded-by-split*
once the split PRs exist; the two are never both merged.

## 10. Confirmation — main & production untouched

- **Production image `3467bc9`** — not rebuilt, not redeployed. Merging this branch
  ships nothing without a separate `Build images` run + staged deploy (owner-gated).
- **`main`:** `git diff 3467bc9..main` = only `.github/workflows/visual.yml` (the
  dormant #63 workflow).
- **Backend:** the only app-code change on the branch is the 7-line detail-page
  error-state fix (§3, presentation only). Zero files under
  `packages/shared/src/**` or any `migrations/**`; no API contract, auth, RBAC,
  tenant-isolation, module-permission or business-logic change — also proven by
  the §4 zero-diff functional parity.
