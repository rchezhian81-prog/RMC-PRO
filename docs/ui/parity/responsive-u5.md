# Parity note — U5 responsive hardening (tablet 768 / mobile 390)

**Change type:** presentation only — CSS layout at narrow breakpoints, plus two
class hooks on existing shell markup. No data, API, route, permission, auth,
form, validation, or handler change. Nothing added or removed from the DOM tree
(the email readout is hidden by CSS on small screens, still present for a11y/
desktop).

## Audit first — what was already responsive (left untouched)

The foundation was already solid; U5 only closes the remaining gaps.

- **Shell** — `.mn-shell` collapses `248px 1fr` → `1fr` at ≤1024px; the sidebar
  becomes a fixed off-canvas drawer (hamburger + scrim). Content column already
  carries `min-width: 0` (the flexbox fix that lets wide children shrink).
- **Tables** — `Table` already wraps in `overflow-x: auto; width:100%`, so wide
  registers scroll inside their own container, never the page.
- **Grids** — every `gridTemplateColumns` in the app is `auto-fit`/`auto-fill
  minmax(...)` (or the skeleton's `repeat(cols,1fr)`); none is a fixed multi-up
  layout that would stay 3-wide on a phone.
- **Command surfaces** — `.mn-cmdbar`/`.mn-toolbar`/`.mn-filterbar` already
  `flex-wrap: wrap` with ≤768/≤480 rules; `.mn-modal` is `min(480px,100%)`;
  `.mn-drawer` goes full-width at ≤480.

## What U5 changed

| # | Gap | Fix |
|---|---|---|
| 1 | `<main>` had **inline** `padding:28` — inline styles can't be overridden by a media query, so phones permanently lost 56px of width. | Moved padding to `.mn-main` (class on the same element). `28px` base → **18px @≤768** → **14px 13px @≤480**. `maxWidth:1120`/`width:100%` stay inline. |
| 2 | `.mn-topbar` is a single **non-wrapping** flex row; the email readout (up to 180px) pushed it into a **horizontal page scroll** below ~550px. | Tighten to `padding:10px 14px; gap:10px` @≤768, and **hide the email echo** (`.mn-topbar-email{display:none}`) @≤768. Identity still shows on **My Account**; the email stays in the DOM for desktop + assistive tech at wider widths. |

Two one-line markup hooks: `className="mn-main"` on `<main>` (padding removed
from its inline style) and `className="mn-topbar-email"` on the email `<span>`.
Nothing else in the shell touched.

## Verification (real markup + real globals.css, 6 widths × light/dark)

Authenticated routes need Postgres (absent in the dev container), so the shell
was rendered from its exact class markup against the real `globals.css` and
probed for horizontal overflow at 1440 / 768 / 480 / 390 / 360 and the open
drawer:

```
1440 · 768 · 480 · 390 · 360 · open-390   →  h-overflow = NO  (light & dark)
```

Visually confirmed at 390: topbar fits (email hidden), command bar wraps,
StatCards go 2-up, the 9-column invoice table scrolls inside its card, and the
off-canvas drawer + scrim open cleanly. (Harness was throwaway — not committed;
durable authenticated baselines land in **U7** when the visual suite runs against
the real app in CI.)

## Behaviour preserved (regression checklist)

- [x] No horizontal page scroll at 360–1440 (measured), open drawer included.
- [x] `/ui-kit` baselines **unchanged** — none of the U5 selectors (`.mn-main`,
      `.mn-topbar*`) exist in the gallery; content-primitive responsiveness is
      already evidenced by the U1/U4 768/390 baselines.
- [x] Desktop (>768) shell pixel-identical — every U5 rule is inside a ≤768/≤480
      media query except the `.mn-main` base padding, which equals the old inline
      `28`.
- [x] Email visible at >768 and in the DOM at all widths (a11y unaffected).
- [x] typecheck / build (ESLint) green — re-verified.
