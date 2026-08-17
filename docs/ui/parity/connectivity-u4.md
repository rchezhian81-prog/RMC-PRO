# Parity note — U4 connectivity notice (offline banner)

**Change type:** presentation only — a global, non-blocking connectivity hint.
No data, API, route, permission, auth, form, validation, or handler change.
Nothing is queued, retried, blocked, or gated. The request layer stays the sole
source of truth for whether a call actually succeeded.

## What was added

| File | What |
|---|---|
| `apps/web/src/lib/use-online.ts` | `useOnline()` — a `useSyncExternalStore` hook over the browser's `online`/`offline` events. Returns `navigator.onLine`; SSR/first-paint snapshot is `true` (no offline flash before hydration). |
| `apps/web/src/components/OfflineBanner.tsx` | `<OfflineBanner />` — renders **only while offline**; a bottom-pinned amber pill: *"You're offline — changes may not save until the connection returns."* `role="status"` + `aria-live="polite"`. |
| `apps/web/src/app/globals.css` | `.mn-offline-banner` — fixed, bottom-centre, `pointer-events:none`, warning tokens, `mn-pop-in` entrance (reduced-motion honoured). Theme-aware via existing `--mn-warning*` tokens. |
| `apps/web/src/app/app/layout.tsx` | Mounts `<OfflineBanner />` once inside the app shell (below `<main>`), so it covers every authenticated route. |
| `apps/web/src/app/ui-kit/UiKitGallery.tsx` | Static (non-fixed) preview of the pill for the visual baseline. |

## Why "may not save" — and why this is the honest wording

The web app has **no offline outbox** (verified: no service worker/PWA, no request
queue, no `navigator.onLine` usage anywhere before this change). A submit made
while disconnected simply fails. The banner tells the operator that *before* they
try — it does not promise queuing or sync it cannot deliver. This is the safe,
truthful indicator for flaky plant Wi-Fi.

## Deliberately NOT done (guardrail-respecting)

- **No global submit-disabling.** Blocking or disabling every form's submit while
  offline would be a *behaviour* change (it stops the user acting) touching dozens
  of forms — outside the "presentation-only, no business-workflow change" guardrail.
  The banner is the warning; the existing per-request error states remain the
  feedback when a call fails. `navigator.onLine` is also optimistic (LAN-up ≠
  internet-up), so gating submits on it would produce false blocks.
- **No queue / retry / sync.** None added, none implied.

## Behaviour preserved (regression checklist)

- [x] While online: nothing renders — zero DOM, zero layout impact (`return null`).
- [x] Offline → banner appears; back online → banner disappears (event-driven).
- [x] `pointer-events:none` — the pill never intercepts clicks; non-blocking.
- [x] SSR snapshot `true` → no hydration mismatch, no first-paint offline flash.
- [x] Every existing route/handler/form unchanged; no API calls added or altered.
- [x] Theme-aware (light + dark, base + V2) via existing warning tokens.
- [x] a11y: `role="status"` + `aria-live="polite"` announces the transition; icon `aria-hidden`.
- [x] typecheck / build (ESLint) green — re-verified.
- [x] Visual baseline — `/ui-kit` "Connectivity notice (U4)" section, light + dark, 3 widths.

## Screenshots

`apps/web/visual/__screenshots__/ui-kit/ui-kit-{light,dark}-v2-{desktop-1440,tablet-768,mobile-390}.png`
— the "Connectivity notice (U4)" section shows the pill in both themes.
