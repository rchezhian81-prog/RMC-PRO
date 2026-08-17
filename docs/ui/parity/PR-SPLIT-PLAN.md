# Proposed split-PR sequence (prepared, NOT opened)

PR #64 currently bundles UI implementation + test infrastructure + ~589 generated
images + docs, which is hard to review. This is the dependency-aware split. **None
of these are opened yet** — this is the preparation the owner asked for. When they
are opened, **PR #64 is marked _superseded-by-split_ and closed; #64 and the split
PRs are never both merged.** Nothing here merges or deploys.

Base for the stack is `main` (which already carries the dormant `visual.yml` from #63).

| PR | Title | Base | Contents | Files | Rollback point |
|---|---|---|---|---|---|
| **PR-A** | UI V2 implementation (presentation) | `main` | `apps/web/src/**` except `visual/**` — primitives (Surface, CommandBar, Toolbar, FilterBar, SearchInput, SummaryStrip, AlertSurface, Drawer, Dialog, OfflineBanner), hooks (`use-online`, `use-focus-trap`), `globals.css` V2 tokens, U2–U8 page restyles, U3 loading gates, U6 a11y, the `/ui-kit` harness, **and the 7-line detail-page not-found fix**. No tests, no images. | ~61 | revert PR-A → back to `main` |
| **PR-B** | Visual/test infrastructure | PR-A | `apps/web/playwright.config.ts`, `apps/web/visual/*.ts` + `*.mjs` (screens, baseline.spec, evidence.spec, global-setup, serve-stack, ui-kit-shots, seed-fixtures, parity-diff), `apps/web/.gitignore`. (`.github/workflows/visual.yml` already on `main`.) No images. | ~10 | revert PR-B → app unaffected |
| **PR-C** | Generated baselines & evidence | PR-B | `apps/web/visual/__screenshots__/**` (462 gated baselines) + `apps/web/visual/evidence/**` (129 evidence captures after the 2026-08-17 re-run). | ~591 | revert PR-C → only baselines lost |
| **PR-D** | UI parity/closure documentation | `main` | `docs/ui/**` (parity notes, EVIDENCE-CLOSURE, U9 matrix, this plan). Independent. | ~15 | revert PR-D |

## Order & dependency

```
main ──┬─▶ PR-A ──▶ PR-B ──▶ PR-C        (stacked; merge A, then B, then C)
       └─▶ PR-D                          (independent; merge any time)
```

- **Merge order:** A → B → C, then (or any time) D. Never merge C before B or B before A.
- **Each PR is independently reviewable:** A is pure app diff; B is test harness;
  C is artifacts (spot-check); D is prose.
- **Why the detail-page fix rides in PR-A:** it is app presentation code (error vs
  loading render). Called out explicitly in PR-A's description as a distinct defect
  fix so a reviewer can approve it separately from the token work.

## Executable recipe (to run only on the owner's go — NOT run yet)

```sh
BR=claude/ui-v2-completion-audit
git fetch origin main
# PR-A — implementation
git checkout -B ui-v2-A origin/main
git checkout $BR -- apps/web/src            # excludes visual/ (not under src)
git commit -m "feat(ui): UI V2 implementation (U1–U8) + detail not-found fix"
# PR-B — test infra (on top of A)
git checkout -B ui-v2-B ui-v2-A
git checkout $BR -- apps/web/playwright.config.ts apps/web/visual/*.ts apps/web/visual/*.mjs apps/web/.gitignore
git commit -m "test(visual): visual-regression + evidence harness"
# PR-C — evidence (on top of B)
git checkout -B ui-v2-C ui-v2-B
git checkout $BR -- apps/web/visual/__screenshots__ apps/web/visual/evidence
git commit -m "test(visual): generated V2 baselines + detail/evidence captures"
# PR-D — docs (off main)
git checkout -B ui-v2-D origin/main
git checkout $BR -- docs/ui
git commit -m "docs(ui): UI V2 parity + evidence-closure"
# push all four, open PRs A→main, B→A, C→B, D→main, then mark #64 superseded + close.
```

**Recommendation:** keep #64 open as the review vehicle until the owner approves
this plan; then execute the recipe, open A–D, and close #64 as superseded. Do not
merge anything without explicit approval; deploy is a separate, later, gated step.
