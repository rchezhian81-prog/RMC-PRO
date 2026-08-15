# UI V2 ("Deep Violet Matte") — staged flag-ON rollout runbook

Operational runbook for turning **UI V2 ON in production**. Pairs with
`docs/ui/UI-V2-ROLLOUT.md` (the flag design & guarantees). This is the *how to
ship it safely* companion.

## Ground truths this runbook is built on

- **The flag is build-time.** `NEXT_PUBLIC_UI_V2` is a `NEXT_PUBLIC_*` constant
  inlined at `pnpm build`, so V2 lives in a specific web image
  (`rmc-web:<sha>-uiv2`, produced by the `ui_v2` input of `build-images.yml`).
  Running that image = V2 on; running a normal `<sha>` image = V2 off. **A runtime
  env var cannot flip it** — the compose `web` service isn't even passed
  `NEXT_PUBLIC_UI_V2`; the baked value governs.
- **Presentation only.** V2 changes just the `data-ui="v2"` attribute and the CSS
  behind it. No data, schema, migration, RBAC, route, or API-contract change at any
  stage. Web content in the `-uiv2` image is identical to the paired flag-OFF
  release; only the skin differs.
- **Independent web tag.** `docker-compose.prod.yml` normally shares one
  `IMAGE_TAG` across `api` + `web`. `IMAGE_TAG_WEB` overrides only `web`, so the V2
  skin flips and rolls back **without rebuilding or touching the api image**. Unset
  → falls back to `IMAGE_TAG` (normal deploys unchanged).
- **One production environment** (no separate staging yet) → we stage **in time**:
  parallel-container validation, a canary flip in an off-peak window, and an
  instant one-line rollback armed throughout.

## The image you ship is the image you previewed

The `rmc-web:<sha>-uiv2` image validated in preview **is** the release artifact —
there is no separate "release build" to re-validate. Confirm its baked
`NEXT_PUBLIC_API_URL` equals the production API origin before promoting.

---

## Stage 0 — Sign-off & window  · gate: owner approval

- [ ] Approve V2 from the preview (all screens, light **and** dark). Land tweaks now.
- [ ] Confirm the release image `rmc-web:<sha>-uiv2` and that its baked
      `NEXT_PUBLIC_API_URL` matches the prod API origin. (To refresh: dispatch
      **Build images** from `main` with `ui_v2` checked; use the new `<sha>-uiv2`.)
- [ ] Pick a **low-traffic window**; notify users the look is changing, nothing else.

## Stage 1 — Land the enabling change  · gate: CI green, deploy is a no-op

`IMAGE_TAG_WEB` (this PR) defaults to `IMAGE_TAG`, so merging + deploying changes
nothing. Deploy it first so the mechanism is in place and proven inert.

## Stage 2 — Internal validation (parallel container = "staging")  · gate: reviewers + verify green

Run the flag-ON image alongside prod, against the **real API**, for a few internal
reviewers (temporary route; live `web` untouched):

```bash
IMG=ghcr.io/rchezhian81-prog/rmc-pro/rmc-web:<sha>-uiv2
docker pull "$IMG"
docker run -d --name rmc-web-uiv2 -p 127.0.0.1:3001:3000 -e NEXT_PUBLIC_UI_V2=1 "$IMG"
# reach it via SSH tunnel or a temporary reverse-proxy route; click real flows.
docker rm -f rmc-web-uiv2   # tear down after
```

- [ ] `verify-app.sh` green, no visual breakage, reviewers sign off.
- If a real staging environment exists later, deploy there instead of the side container.

## Stage 3 — Canary flip (in the window, rollback armed)  · gate: verify green + error rate flat

```bash
cd /opt/rmc
sed -i 's/^IMAGE_TAG_WEB=.*/IMAGE_TAG_WEB=<sha>-uiv2/' .env.production \
  || echo 'IMAGE_TAG_WEB=<sha>-uiv2' >> .env.production
grep -E '^IMAGE_TAG_WEB=' .env.production
C="docker compose --env-file .env.production -f docker/docker-compose.prod.yml"
$C pull web && $C up -d web          # only web recreates (~seconds); api + db untouched
LOGIN='owner@pilot1.com' bash scripts/ops/verify-app.sh
```

Watch API 5xx / error alerts and container health for a few minutes; eyeball key
screens live.

## Stage 4 — Bake & monitor  · gate: a clean business day/week

Leave it live through a full working day, then a week. Watch error alerts, health,
user feedback. Rollback stays one command away.

## Stage 5 — Make it the default  · gate: confident

Fold V2 into the normal release line — either keep `IMAGE_TAG_WEB` as the standing
switch, or make flag-ON the default build and retire the OFF path. Update
`docs/ui/UI-V2-ROLLOUT.md` to "V2 is live".

---

## Rollback ladder (fastest → deepest)

| Situation | Action | Cost |
|---|---|---|
| V2 looks wrong / user pushback | clear `IMAGE_TAG_WEB`, `up -d web` | seconds, visual only |
| Deeper web issue | `IMAGE_TAG=<prior OFF release>`, `up -d` | seconds |
| api issue (unrelated) | `IMAGE_TAG` → last-good, `up -d` | seconds; no DB |

Skin rollback in full:

```bash
cd /opt/rmc && sed -i '/^IMAGE_TAG_WEB=/d' .env.production
docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d web
```

→ web falls back to `IMAGE_TAG` (flag OFF). No data, api, or migration involved.

## Notes

- **All-or-nothing per environment.** Every user flips at once. For gradual
  **per-tenant** exposure, use the documented future path (a `ui_version` field on
  `me()` → per-session `data-ui`) — that is dev work, not this rollout.
- **CORS** is a non-issue for the real flip (the V2 web runs on the same prod
  origin). It only matters for the Stage-2 side container if reached from a
  different origin — see `docs/ui/UI-V2-ROLLOUT.md`.
