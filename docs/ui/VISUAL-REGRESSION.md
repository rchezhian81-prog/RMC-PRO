# Visual-regression baseline (PR-UI0)

The safety net the UI migration is gated on. It renders the **real** web app
against a **real** local API + Postgres (no mock data, no prototype routing) and
captures the current production UI (flag **OFF**) as the reference. Later UI PRs
re-run it and **diff** against these baselines; an unintended visual change fails.

- Framework: Playwright (`@playwright/test`, pinned to the pre-installed
  Chromium — browsers are never downloaded).
- Config: `apps/web/playwright.config.ts` · specs: `apps/web/visual/`
- Baselines (committed): `apps/web/visual/__screenshots__/`
- Stack runner: `apps/web/visual/serve-stack.mjs` (boots migrate + seed + API +
  a seeded tenant/owner with every module enabled + the standalone web build).

## Viewports & themes

Owner-approved sizes, one Playwright project each (all Chromium — viewport width
drives the responsive layout):

| Project | Width × height |
|---|---|
| `desktop-1440` | 1440 × 900 |
| `laptop-1280` | 1280 × 800 |
| `tablet-768` | 768 × 1024 |
| `mobile-390` | 390 × 844 |

Each screen is captured in **light and dark** → 4 viewports × 2 themes.
Non-essential animation is disabled at capture (`reduced-motion` + injected
`transition:none/animation:none` CSS + network-idle wait), so a baseline is never
an unstable animation frame.

## Baseline inventory (64 references)

8 representative screens × 2 themes × 4 viewports:

| Screen | Route | Protected surface |
|---|---|---|
| Login | `/login` | auth (captured unauthenticated) |
| Dashboard | `/app/dashboard` | KPIs, funnel, alerts (Overview) |
| Masters — Customers | `/app/entity/customers` | table + `MasterCrud` (forms/actions) |
| Orders | `/app/orders` | table + status filter |
| Production — Batch Queue | `/app/production/batch-queue` | operational screen |
| Billing — Invoices | `/app/billing/invoices` | financial table |
| Roles & Permissions | `/app/roles` | RBAC / permission surface |
| Devices & Sync | `/app/devices` | offline / sync indicators |

> The **Audit Trail** screen is intentionally excluded from pixel baselines: it
> renders per-run event timestamps (non-deterministic), which make a screenshot
> baseline flaky. Its behavior is covered by the API integration/e2e tests. In
> general, data-dependent screens with live timestamps are functional-tested, not
> pixel-baselined.

Coverage spans the owner's protected surfaces: routes, navigation shell, tables,
forms/dialogs (via MasterCrud), an operational screen, a financial screen,
permissions (audit), offline/sync (devices), and responsive behavior (4 widths).
Future PRs will extend the screen list as each module is migrated.

## How to run

Requires an **empty** Postgres reachable via `POSTGRES_*` (a CI service container
or a local throwaway), plus the pre-installed Chromium.

```bash
# from repo root, with @rmc/shared + @rmc/api already built (pnpm build)
export POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 POSTGRES_DB=rmc \
       POSTGRES_USER=rmc_owner POSTGRES_PASSWORD=… APP_DB_USER=rmc_app APP_DB_PASSWORD=…
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
       PW_CHROME_PATH=/opt/pw-browsers/chromium-<build>/chrome-linux/chrome

pnpm --filter @rmc/web test:visual            # boot stack + compare against baseline
pnpm --filter @rmc/web test:visual:update     # (re)write the baseline (intended changes only)
```

`serve-stack.mjs` builds the web pointed at the local API (so CSP `connect-src`
and the client BASE both target it), serves the production `standalone` build
with the flag **OFF**, then runs Playwright and tears everything down.

## Updating baselines

Only run `test:visual:update` when a visual change is **intended and reviewed**
(e.g. a UI PR that deliberately restyles a screen). Commit the regenerated PNGs
with the PR and attach before/after in the parity matrix. Never update baselines
to silence an unexplained diff.

## CI note

CI's `build` job already lints, typechecks, and `next build`s the web app, and
the shared unit tests (incl. the flag resolver) run under `pnpm coverage`. The
full browser+API visual suite is run on demand / locally for PR-UI0 (it requires
a browser + a booted stack); wiring it as a dedicated CI job is a small,
well-scoped follow-up and is intentionally **not** bundled into PR-UI0 to keep
this PR minimal.
