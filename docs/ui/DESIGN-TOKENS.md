# Deep Violet Matte — design tokens (UI V2)

PR-UI1 introduces the "Deep Violet Matte Intelligence" token foundation, **scoped
entirely to `:root[data-ui='v2']`** in `apps/web/src/app/globals.css`. With the
flag OFF the default `:root` tokens are untouched, so the current UI is
byte-for-byte unchanged. When `data-ui="v2"` is present, the **same `--mn-*`
variable names** carry the new values, so every component that already reads
`var(--mn-*)` (inline styles or the `mn-*` class kit) re-skins automatically —
**no component edits in this PR**.

## How components consume tokens (unchanged mechanism)

- Colors/surfaces/borders/shadows/radius: `var(--mn-*)` via inline `style` and the
  `mn-btn` / `mn-card` / `mn-input` / `mn-badge` / shell classes.
- Theme: `data-theme` attribute (light default / dark). v2 defines both.
- Nothing about the consumption path changes — only the token *values* under the
  v2 scope. That is the clean seam this whole migration rides on.

## Token reference (v2)

| Token | v2 Light | v2 Dark (violet-black) |
|---|---|---|
| `--mn-bg` / `--mn-surface` / `--mn-surface-2` | `#f6f7fb` / `#ffffff` / `#f4f3fa` | `#17172a` / `#21213a` / `#272743` |
| `--mn-text` / `--mn-muted` / `--mn-subtle` | `#1c1c2e` / `#56566a` / `#8a8a99` | `#e8e6f2` / `#a8a6c0` / `#8b89a8` |
| `--mn-border` / `--mn-border-strong` | `rgba(20,20,45,.08)` / `.14` | `rgba(138,79,255,.18)` (ambient violet) / `.30` |
| `--mn-primary` / `-hover` / `-on` / `--mn-focus` | `#6c2bd9` / `#5a1fb8` / `#fff` / `#6c2bd9` | `#8a4fff` / `#9e6bff` / `#fff` / `#8a4fff` |
| status success / warning / danger / info | `#0f6f34` / `#8a4409` / `#b91c1c` / `#6c2bd9` (+ light tints) | `#34d399` / `#fbbf24` / `#f87171` / `#b78cff` (+ dark tints) |
| **elevation** `--mn-shadow-1/2/card/pop` | soft multi-layer, low-reflection | dark equivalents |
| **`--mn-glow-primary`** | `0 6px 20px rgba(108,43,217,.18)` — selected/primary only | `0 6px 22px rgba(138,79,255,.28)` |
| **glass** `--mn-glass` / `-border` (command surfaces only, applied later) | `rgba(255,255,255,.9)` / `rgba(20,20,45,.08)` | `rgba(33,33,58,.72)` / `rgba(138,79,255,.22)` |
| radius `--mn-radius-sm/md/lg/pill` | 6 / 8 / 12 / 999 | same |
| **spacing** `--mn-space-1..8` | 4·8·12·16·20·24·32·40 | same |
| **motion** `--mn-dur-micro/std/drawer` · `--mn-ease` | 160 / 240 / 300 ms · `cubic-bezier(.4,0,.2,1)` | same (collapsed under reduced-motion) |

## Typography

- **Display → Outfit** (self-hosted `apps/web/src/app/fonts/Outfit-latin.woff2`,
  ~32 KB, `next/font/local`, **`preload: false`**). `--mn-font-display` points to
  Outfit only under `[data-ui='v2']`, so flag-OFF users never download it.
- **Body → Inter**, with **Noto Sans Devanagari + Tamil** fallbacks (unchanged) —
  Indian-language names still render with real glyphs. Tabular numerals kept for data.

## Accessibility — WCAG 2.2 AA contrast (verified)

All text pairs ≥ 4.5:1 (normal text):

| Pair | v2 Light | v2 Dark |
|---|---|---|
| text on surface | 16.7:1 | 12.7:1 |
| text on bg | 15.6:1 | 14.3:1 |
| muted on surface | 7.2:1 | 6.6:1 |
| white on primary (button) | 7.0:1 | 4.5:1 |
| primary on bg (link/icon) | 6.6:1 | — |
| success on tint | 5.6:1 | 6.9:1 |
| warning on tint | 6.3:1 | 8.3:1 |
| danger on tint | 5.3:1 | 5.9:1 |

Focus: `--mn-focus` is the primary violet (a stronger, AA-visible ring than the
prior lavender), consumed by the existing `:focus-visible` rule. Reduced motion:
the v2 motion durations collapse to `0.01ms` under `prefers-reduced-motion`.

## Per-module migration order (later PRs, not this one)

Reach-first, one PR each, all flag-gated + parity-matrixed:
`ui/*` primitives (`Button`/`Card`/`Table`/`Badge`/`Field`/`States`) → `MasterCrud`
→ app shell + sidebar (+ glass command bar) → Owner Command Centre (dashboard) →
one operational module at a time → responsive/a11y hardening.

## Rollback

Flag defaults OFF → zero visible change on merge. Reverting the PR removes the v2
blocks and the Outfit wiring entirely; no backend/migration involved.
