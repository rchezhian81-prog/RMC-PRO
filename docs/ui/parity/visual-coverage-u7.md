# U7 — visual coverage 8 → 55 + CI wiring

**Change type:** test coverage + a new **manual-only** CI workflow. No app code,
API, route, or production/release config touched. `ci.yml` and `build-images.yml`
are **not modified** (CI-release-config guardrail) — the visual job is a separate,
opt-in workflow that can't run unless someone clicks “Run workflow”.

## 1. Coverage: 8 → 55 screens

`apps/web/visual/baseline.spec.ts` `SCREENS` grew from 7 authenticated screens
(+login) to **54 authenticated screens (+login)** — one per route across every nav
group. `playwright test --list` confirms **220 tests = 55 screens × 4 viewports**;
each captures light + dark, so a full run is **440 screenshots per skin**.

The 7 original names (`dashboard`, `masters-customers`, `orders`,
`production-batch-queue`, `billing-invoices`, `roles`, `devices-sync`) are kept
**verbatim**, so their 128 committed baselines still match. Everything else is new.

Rendered against the freshly-seeded `VISUAL` tenant (all modules on, one seeded
plant), so lists show their deterministic **empty state** — no per-run data drift.

### Deliberately excluded (documented, not silently dropped)

| Route | Why | Covered by |
|---|---|---|
| `/app/audit` | per-run event timestamps | API integration/e2e |
| `/app/dispatch/tracking` | live GPS fixes + relative “15s” refresh clock | e2e |
| `/app/assistant`, `/app/sales/import-po` | AI-gated (hidden/disabled when AI off) | — |
| every `[id]`/`[name]` detail route | needs a seeded record id | integration |
| `/app` index | redirects to `/app/dashboard` | — |

## 2. CI wiring — `.github/workflows/visual.yml`

A new workflow, **`workflow_dispatch` only** (never push/PR), so it adds zero cost
to existing CI and gates nothing yet. It mirrors the `integration` job's Postgres
service + env and drives the existing `serve-stack.mjs` (migrate → seed → boot API
→ build + serve web → Playwright) — the exact recipe that already produced the
committed baselines, just in CI.

Inputs:
- **mode** — `v2` (default; Deep Violet Matte, diffs the `-v2` baselines) or `off`.
- **update_snapshots** — `false` diffs against committed baselines; `true` (re)writes them.

Artifacts: `visual-report` (HTML diff, always) and `visual-snapshots` (the fresh
PNGs, only when updating).

### Baseline-generation runbook (first use)

The 47 new screens have **no committed baselines yet** — they can't be generated in
the dev container (no Postgres). To seed them:

1. Actions → **Visual regression** → Run workflow → `mode: v2`, `update_snapshots: true`.
2. Download the **visual-snapshots** artifact; copy its PNGs into
   `apps/web/visual/__screenshots__/baseline.spec.ts-snapshots/` and commit.
3. (Optional) repeat with `mode: off` for the flag-OFF set.
4. Thereafter run with `update_snapshots: false` — it now **diffs** and the
   `visual-report` artifact shows any drift.

Until step 2 is done, a diff run is red on the new screens (Playwright writes the
missing shot and fails it) — expected, not a regression.

### Promoting to a merge gate (owner's call, one edit)

To make it block PRs later, add to `visual.yml`:

```yaml
on:
  workflow_dispatch: { ... }
  pull_request:
    branches: [main]
```

Left off deliberately — turning a 440-shot job into a per-PR gate is a cost/latency
decision, and touching the shared PR-gate set is exactly what the CI guardrail
reserves for you.

## Verification (here)

- [x] `playwright test --list` → 220 tests, 55 unique screens × 4 viewports — spec loads, no syntax error.
- [x] `visual.yml` parses (YAML valid; 1 job, 9 steps, `workflow_dispatch` only).
- [x] `ci.yml` and `build-images.yml` untouched (`git diff` shows only the new file).
- [x] Existing 7 baseline names unchanged → their committed PNGs still resolve.
- [x] The stack recipe reuses `serve-stack.mjs` verbatim (no behavioural fork).
