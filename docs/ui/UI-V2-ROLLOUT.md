# UI V2 ("Deep Violet Matte Intelligence") — rollout flag & rollback

PR-UI0 adds the **presentation-only** flag that later UI PRs build behind. It ships
**OFF**, so nothing about the current production UI changes until UI V2 is
separately built with the flag on and approved.

## What the flag is

- **Env var:** `NEXT_PUBLIC_UI_V2` (build-time, `NEXT_PUBLIC_*` → inlined into the
  client bundle and read at runtime on the server from the same environment, so
  both resolve identically — no hydration mismatch, no flash of the wrong skin).
- **Resolver:** `packages/shared/src/ui-flag.ts` → `resolveUiV2(raw)` (pure,
  unit-tested). Web wrapper: `apps/web/src/lib/ui-flag.ts` → `isUiV2()`.
- **Effect:** when ON, the root layout stamps **`data-ui="v2"`** on `<html>`. When
  OFF, the attribute is omitted entirely. Nothing else changes in PR-UI0 — the
  future skin lives under `:root[data-ui='v2']` selectors added in PR-UI1.

### Fail-safe behavior (unit-tested)

| `NEXT_PUBLIC_UI_V2` value | Result |
|---|---|
| unset / missing | **OFF** |
| `` (empty) / whitespace | **OFF** |
| `0`, `false`, `off`, `no`, `yes`, `on`, `2`, `v2`, any other value | **OFF** |
| `1` or `true` (any case, surrounding whitespace ok) | **ON** |

**Only `1`/`true` turns it on.** Anything invalid is a safe OFF, so a typo or a
missing value can never flip tenants onto an unfinished skin.

### Hard guarantees

- **Presentation only.** The flag never gates a module, permission, route,
  tenant/plant boundary, or any server-side business decision — those stay
  enforced by the real module/RBAC system. It only toggles a CSS-selector hook.
- **No unauthorized module exposure.** Module visibility is unchanged; the flag
  does not touch `getAccess()`, nav gating, or entitlements.
- **No new JS of consequence.** The client bundle is byte-for-byte equivalent
  (First Load JS shared = 102 kB, unchanged); `@playwright/test` is a
  devDependency and is never shipped.

## How UI V2 is activated later (without affecting existing tenants)

UI V2 stays OFF in production until separately approved. Because the flag is a
build-time `NEXT_PUBLIC_*` constant, **a runtime env var can never flip it** — the
value is inlined into the bundle at `pnpm build`, so it can only change by building
a new image. `apps/web/Dockerfile` declares `ARG/ENV NEXT_PUBLIC_UI_V2` for exactly
this purpose.

### Build a flag-ON image (`ui_v2` workflow input)

`.github/workflows/build-images.yml` exposes a `ui_v2` boolean on **Run workflow**.
When ON it passes `--build-arg NEXT_PUBLIC_UI_V2=1` to the web build and **suffixes
every tag with `-uiv2`** (e.g. `rmc-web:<sha>-uiv2`), so a flag-ON image can never
overwrite the canonical flag-OFF `sha`/`branch`/`latest` tags; the API image (flag
is web-only) is skipped. Default is OFF, so ordinary production builds are unchanged.

### Preview it safely (isolated side container — recommended)

Run the `-uiv2` image as a **separate** container on an alternate port, pointed at
the same API, and reach it over an SSH tunnel. The live `web` service (flag-OFF)
is never touched, so no tenant sees the unfinished skin:

```bash
docker pull ghcr.io/<repo_lc>/rmc-web:<sha>-uiv2
docker run -d --name rmc-web-uiv2 -p 127.0.0.1:3001:3000 \
  -e NEXT_PUBLIC_UI_V2=1 ghcr.io/<repo_lc>/rmc-web:<sha>-uiv2
# from your laptop:  ssh -L 3001:127.0.0.1:3001 <server>  → http://localhost:3001
docker rm -f rmc-web-uiv2   # tear down when done
```

Authenticated XHR from `localhost:3001` may hit the API's CORS allowlist (the API
only allows the live web origin); the login screen and shell render the V2 skin
regardless, and the preview origin can be added to the allowlist briefly if a
click-through of authenticated screens is needed.

### Promote to an environment (all-or-nothing)

To actually turn V2 on for an environment (not just preview): build the `-uiv2`
image as above, then point that environment's web service at it **and** set
`NEXT_PUBLIC_UI_V2=1` in its `.env.production` (server-runtime value agreeing with
the inlined client value). This is a per-environment switch — flip it in staging
first. It changes only the `data-ui` attribute; every server-side business
decision is unchanged.

### Per-tenant rollout (future, not built here)

A per-environment flag is enough for PR-UI0. If a **per-tenant** visual rollout
is wanted later, the existing entitlement channel is the natural home:

- The API already returns `modules`/`permissions`/`roles` on `me()` and the web
  caches them via `getAccess()` (`apps/web/src/lib/session.ts`). A single
  additional `ui_version` field on `me()` could set `data-ui` per session,
  reusing that exact path — **without** overloading the `MODULE_CATALOG` /
  `tenant_modules` system (that is an entitlement/billing surface, not a skin).

This is documented as the future path only; PR-UI0 does not build it.

## Rollback procedure (instant)

Because the default is OFF and the new skin is purely additive CSS behind
`data-ui="v2"`:

- **If UI V2 is not yet enabled** (PR-UI0 state): there is nothing to roll back —
  the flag is OFF and the UI is unchanged. Reverting the PR-UI0 merge is a clean
  no-op on rendering.
- **If UI V2 was enabled in an environment and needs reverting:** set
  `NEXT_PUBLIC_UI_V2` back to empty/`0` (unset the build-arg and the service env),
  rebuild + redeploy the web image. The `data-ui="v2"` attribute disappears and
  the current UI returns immediately. No data, API, schema, RBAC, or workflow
  change is involved — it is a presentation revert only.
- **Code-level rollback:** reverting the PR restores the prior `layout.tsx` and
  removes the flag entirely; no migration or backend change is affected.
