# UI V2 ("Deep Violet Matte") — completion audit & implementation plan

**Status:** read-only audit + planning package. **Nothing here modifies production**,
its monitored V2 image, configuration, DB, API, RBAC, routes, or navigation.
Prepared during the Stage-4 bake window on the isolated branch
`claude/ui-v2-completion-audit` (off `main` @ `41471fa`).

> **Honesty note:** completion figures below are derived from **code-level signals
> across all 61 routes** (design-token usage, primitive reuse, state components,
> a11y attributes, responsive rules) plus the **8 routes** that have pixel
> baselines. They are **not** a 61-route pixel audit. No route is claimed
> "100% complete" — see *Definition of done* and *Coverage honesty*.

---

## 1. Method & scope

- **Inventory:** all **61 App-Router routes** (`apps/web/src/app/**/page.tsx`), the
  14-group nav/module map (`app/app/layout.tsx`), the `ui/*` primitive library,
  and the token system (`globals.css`, 587 lines).
- **Design-system-of-record:** `docs/ui/DESIGN-TOKENS.md` (the `--mn-*` token set +
  the project's own **per-module migration order**), `PARITY-MATRIX-TEMPLATE.md`
  (the per-page completion contract), `VISUAL-REGRESSION.md` (the pixel safety net),
  `UI-V2-ROLLOUT.md` (the flag).
- **Figma handoff:** the repo's rule (`PARITY-MATRIX-TEMPLATE.md`) is *"the real
  application is the source of truth for behavior; the Figma reference informs
  appearance only."* No external Figma URL is committed; the **design-token doc +
  `:root[data-ui='v2']` blocks are the appearance source of record** and are what
  this audit compares against.

## 2. Architecture finding (this reframes "completion")

UI V2 is a **CSS token swap**: the same `--mn-*` variables carry new values under
`:root[data-ui='v2']`. Every screen already built on `var(--mn-*)` + the `mn-*`
class kit + the `ui/*` primitives **re-skins to base-V2 automatically** — which is
exactly why the *entire* app already renders Deep Violet Matte in production.

Objective scan across all 61 routes:

| Signal | Result | Reading |
|---|---|---|
| Routes using `--mn-*` tokens directly | **53 / 61** | rest delegate to token-based shared components |
| Routes with **hardcoded hex** (legacy signal) | **1** (`qc/cubes/[id]`, 1 color) | **no legacy-styling backlog** |
| Routes using shared `States` (empty/error) | **56 / 61** | broad state coverage… |
| Routes using **Loading/Skeleton** | **9 / 61** | …but loading states are thin |
| Routes with offline/sync handling | **4** | thin where capture screens may need it |
| `--mn-glass` command-surface usages | **0** (tokens defined only) | design step 3 pending |
| Responsive breakpoints in `globals.css` | **1** (`max-width:1024px`) | shell collapses; no per-screen 768/390 QA |
| Pixel baselines | **8 / 61** screens | coverage is the biggest verification gap |

**Conclusion:** completion is **not** about migrating legacy screens (there aren't
any). It is about **depth + coverage** on top of a finished base skin.

## 3. Honest completion

Two numbers, because the question has two honest answers:

- **Visible V2 skin (what is live and owner-approved): ~95%.** Every route renders
  in Deep Violet Matte; primitives, color, type (Outfit), radius, elevation, motion
  are done (PR-UI0/1/2, in production).
- **Full V2 UI/UX program — the design system's own definition of done: ~58%.**
  (weighted per-dimension, below). The remaining ~42% is depth (glass, dashboard),
  states (loading/offline), and **verification coverage** (responsive/a11y/dark
  across all routes; pixel baselines 8→61; per-page parity matrices).

### Per-dimension completion matrix

| # | Dimension | Evidence | Weight | ~Done |
|---|---|---|---:|---:|
| 1 | Token foundation + `ui/*` primitives | PR-UI2 landed; `globals.css` v2 light+dark | 15 | 100% |
| 2 | Component reuse / no legacy styling | 53/61 direct tokens; 1 stray hex | 10 | 97% |
| 3 | Empty / Error states | `States` used on 56/61 | 8 | 90% |
| 4 | **Loading / Skeleton states** | only 9/61 | 8 | 20% |
| 5 | **Offline / sync states** | 4 files (devices, numbering, shells) | 6 | 25% |
| 6 | **Glass command surfaces (shell/topbar)** | tokens defined, 0 usage | 8 | 0% |
| 7 | **Dashboard "Owner Command Centre" elevation** | on tokens, not elevated (step 4) | 6 | 40% |
| 8 | Responsive shell (sidebar→drawer) | `@media 1024`, mobile drawer present | 6 | 90% |
| 9 | **Responsive per-screen (768 / 390)** | tables scroll; no per-breakpoint QA | 8 | 55% |
| 10 | **Accessibility hardening (keyboard/SR, all routes)** | good base (skip link, dialog aria, `aria-current`), not comprehensive; `htmlFor`×7 | 10 | 55% |
| 11 | Dark-mode tokens | v2 light+dark complete; `ThemeToggle` live | 5 | 100% |
| 12 | **Dark-mode per-screen QA** | 8/61 dark baselines | 5 | 20% |
| 13 | **Visual-regression coverage** | 8/61 screens; suite not in CI | 10 | 15% |
| 14 | **Per-page parity matrices** | template exists; ~0 filled | 5 | 15% |

**Weighted aggregate ≈ 58%** of the full program. (Weights reflect user-visible
impact; the base-skin rows dominate, which is why the *visible* number is far
higher than the *program* number.)

## 4. Route / module gap matrix (14 nav groups, 61 routes)

Legend: **Base** = token re-skin · **St** = loading/empty/error/offline states ·
**Resp** = 768/390 hardening · **A11y** = keyboard/SR · **Dark** = per-screen QA ·
**Vis** = pixel baseline. ✅ done · ◑ partial · ○ pending.

| Group (routes) | Base | St | Resp | A11y | Dark | Vis | Notes |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Overview — dashboard, assistant, account (3) | ✅ | ◑ | ◑ | ◑ | ◑ | ◑ | dashboard needs step-4 elevation; 1 baseline |
| Setup — company, users, roles, numbering, imports, settings (8) | ✅ | ◑ | ◑ | ◑ | ○ | ◑ | roles baselined; rest not |
| Masters — entity/* customers…grades (10) | ✅ | ◑ | ◑ | ◑ | ◑ | ◑ | via `MasterCrud`; customers baselined |
| Sales — leads, quotations(+id), rate-contracts(+id), order-drafts, import-po (7) | ✅ | ◑ | ○ | ◑ | ○ | ○ | detail pages loading-state light |
| Orders — orders(+id), credit-holds (3) | ✅ | ◑ | ◑ | ◑ | ○ | ◑ | orders baselined |
| Production — mix-designs, plans, batch-queue, batch-tickets(+id), stock, reports (7) | ✅ | ◑ | ○ | ◑ | ○ | ◑ | batch-queue baselined; capture screens want offline |
| Quality — slump, cubes(+id) (3) | ✅ | ◑ | ○ | ◑ | ○ | ○ | 1 stray hex in cubes/[id] |
| Dispatch — board, tracking, challans(+id) (4) | ✅ | ◑ | ○ | ◑ | ○ | ○ | board/tracking are offline-relevant |
| Inventory — inward, weighbridge, adjustments, negative-stock, reports (5) | ✅ | ◑ | ○ | ◑ | ○ | ○ | weighbridge is offline/device-relevant |
| Purchase — orders, bills (2) | ✅ | ◑ | ○ | ◑ | ○ | ○ | — |
| Fleet — maintenance, fuel (2) | ✅ | ◑ | ○ | ◑ | ○ | ○ | — |
| Expenses — vouchers, heads (2) | ✅ | ◑ | ○ | ◑ | ○ | ○ | — |
| Billing — invoices(+id), receipts, outstanding, reports (5) | ✅ | ◑ | ◑ | ◑ | ○ | ◑ | invoices baselined |
| Control — reports, audit, corrections, devices (4) | ✅ | ◑ | ○ | ◑ | ◑ | ◑ | devices baselined + offline-aware |
| Admin (super) — admin, plans, tenants(+id) (4) | ✅ | ◑ | ○ | ◑ | ○ | ○ | separate `/admin` shell |
| Auth — login (1) | ✅ | n/a | ◑ | ◑ | ◑ | ✅ | baselined |

## 5. Dependency-aware implementation sequence (small PRs)

Follows the design system's own migration order, gap-first, **one module/concern
per PR** (no mega-PR). Each ships flag-gated behavior-neutral, with a parity matrix
+ visual diff. Sizes: S ≈ ½–1 day, M ≈ 1–2 days, L ≈ 3–4 days.

| PR | Scope | Size | Depends on | Acceptance criteria | Tests |
|---|---|:--:|---|---|---|
| **U1** | **Glass command surfaces** — apply `--mn-glass` to topbar + a command bar (step 3) | S | — | topbar/command bar use `--mn-glass`; contrast AA; OFF byte-identical | visual diff (shell), OFF-suite 32/32 |
| **U2** | **Dashboard "Owner Command Centre"** elevation — stat/insight/alert cards, hierarchy (step 4) | M | U1 | dashboard uses elevated cards/glow per tokens; no data/logic change | dashboard visual (light+dark), route-resolve |
| **U3a–e** | **Loading/Skeleton sweep**, batched per module group (Sales, Production/QC, Inventory/Purchase/Fleet/Expenses, Billing, Setup/Control) | M×5 | primitives (done) | every list/detail shows `Loading`/`Skeleton` on fetch; no layout shift | per-page visual (loading frame), unit render |
| **U4** | **Offline/sync states** for capture screens (dispatch board, weighbridge, batch-queue) | M | U3 | offline banner/queued indicator where writes can be offline; parity with `devices` pattern | integration (offline outbox), visual |
| **U5a–d** | **Responsive hardening** 768/390 per module group (tables, forms, dialogs) | M×4 | — | no horizontal body scroll; tap targets ≥44px; forms single-column on 390 | visual at 768+390 (both themes) |
| **U6** | **Accessibility hardening** — `htmlFor` sweep, dialog focus-trap audit, `aria-live` on async, keyboard workflows | M | — | axe-clean; every input labelled; focus visible; Esc/Enter in dialogs | axe run, keyboard e2e |
| **U7** | **Visual-regression coverage 8→61** + wire suite as CI job | L | U1–U6 land per module | every migrated route baselined (4 vp × 2 themes); CI gate green | the visual suite itself |
| **U8** | **Dark-mode per-screen QA** (rides U7 dark baselines) — fix any dark-only contrast/elevation issues | S | U7 | all routes AA in dark; no dark-only breakage | dark baselines |
| **U9** | **Per-page parity matrices** — fill `PARITY-MATRIX-TEMPLATE` for every migrated route | S (per module, ongoing) | each U-PR | each route has a completed matrix in its PR | doc gate |

**Rough total:** ~18–24 working days of focused UI work across ~15–18 small PRs.
**Parallelizable:** U3/U5/U6 are per-module and independent; U1→U2 and U7→U8 are the
only hard chains.

## 6. Definition of "100% UI/UX complete"

Per the project's own `PARITY-MATRIX-TEMPLATE.md`, a route is complete only when:

1. Every live control, field, action, **empty/loading/error/offline** state, and
   permission is mapped and its behavior **verified unchanged** (parity matrix filled).
2. Rendered correctly at **4 breakpoints × 2 themes** with **committed pixel
   baselines**, diff reviewed (intended changes only).
3. **Accessibility:** keyboard workflow intact, screen-reader labels present, focus
   visible, **WCAG 2.2 AA** contrast (already verified at token level).
4. Glass/command + dashboard treatments applied where the design system specifies.
5. No API/DB/RBAC/tenant/route/workflow change (presentation only), tests green.

**100% = all 61 routes meet 1–5, and the visual suite runs in CI as a gate.**
Today: base skin met app-wide; items 1–4 partially met; pixel coverage 8/61.

## 7. Coverage honesty

- **Screenshots** exist for the **8 baselined screens** (light/dark × 4 viewports) —
  see the preview comparison already delivered. The other **53 routes are audited
  by code signal, not pixels.** Extending pixel coverage is **PR U7** and is the
  gate that lets us claim per-route completion honestly.
- No route in this document is asserted "done" beyond what its evidence supports.

## 8. Production-untouched confirmation

- All work on branch `claude/ui-v2-completion-audit` (off `main` @ `41471fa`); **no
  push to `main`, no PR opened, no deploy, no image build, no `.env`/compose/server
  change.** Production remains `rmc-web:0e5e132-uiv2` (flag ON) + `rmc-api:df7cca1`,
  its Stage-4 monitoring untouched.
- This audit is **read-only** with respect to product code: it adds **only this
  document** (and, if approved later, the small PRs above — none started).
