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

UI V2 stays OFF in production until separately approved. To turn it on for an
**environment** (the supported PR-UI0 mechanism):

1. Build the web image with the flag set as a build-arg **and** provide the same
   value to the running web service, so the inlined client value and the server
   runtime value agree:
   - In `.github/workflows/build-images.yml`, pass `NEXT_PUBLIC_UI_V2=1` as a
     `build-arg` for the `web` image (alongside `NEXT_PUBLIC_API_URL`).
   - Set `NEXT_PUBLIC_UI_V2=1` in the web service environment (`.env.production`)
     so the server component reads the same value.
2. Rebuild + redeploy the web image. Existing tenants are unaffected until the
   image carrying the flag is deployed.

This is an **all-or-nothing, per-environment** switch — appropriate for a staged
rollout (e.g. flip it on in a staging environment first). It changes only the
`data-ui` attribute; every server-side business decision is unchanged.

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
