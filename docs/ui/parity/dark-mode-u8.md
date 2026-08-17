# U8 — Dark-mode per-screen QA (V2 "Deep Violet Matte")

**Outcome: PASS — no corrections required.** The V2 dark theme is production-grade
across all 55 rendered routes. This is an evidence-based finding, not an unexamined
sign-off — the evidence is below. **No app code changed in U8** (the only change was
the visual-harness dark-render fix in U7).

## Method

Dark mode in this app is a **pure token swap**: `globals.css` redefines the
`--mn-*` custom properties under `:root[data-ui='v2'][data-theme='dark']`, and every
screen consumes those tokens. So dark correctness is (a) *systemic* — the tokens —
and (b) *per-screen only where a screen hardcodes a colour instead of a token*.
Both were checked, plus a full render sweep.

## 1. Per-screen render sweep — 55/55 genuinely dark

Mean luminance of every `*-dark-v2-desktop-1440` baseline vs its light twin
(0 = black, 255 = white):

```
dark mean ≈ 29–34   ·   light mean ≈ 241–249   ·   gap ≈ 215 on every screen
55 dark screens checked → 55 OK, 0 flagged
```

Every route renders a deep dark surface in dark mode — none slipped through as
light. (This same sweep is what caught the harness bug fixed in U7.)

## 2. Token-bypass audit — 0 offenders

A repo-wide search for hardcoded colours in `app/**` + `components/**`:

- `#1e1e2e` — only as the `var(--mn-text, #1e1e2e)` **fallback** (token always wins).
- `#E9DDFF` — `Logo.tsx` `onDark` variant (intentional: light lilac on dark).
- `#fff` — either `var(--mn-surface, #fff)` fallbacks or white-on-violet-gradient.
- No `'white'`/`'black'` literals; no non-token `rgba()` on content (only shadows/scrims).

→ **No screen bypasses the token system**, so none can render a light-on-light or
dark-on-dark surface in dark mode.

## 3. WCAG AA contrast — all dark pairs pass

| Pair | Ratio | AA (≥4.5) |
|---|---|---|
| text `#e8e6f2` on bg `#17172a` | 14.28 | ✅ AAA |
| text `#e8e6f2` on card `#21213a` | 12.68 | ✅ AAA |
| muted `#a8a6c0` on card | 6.61 | ✅ |
| subtle `#8b89a8` on card | 4.65 | ✅ (non-essential/large per design) |
| primary-btn `#fff` on `#8a4fff` | 4.52 | ✅ |
| success `#34d399` on card | 8.13 | ✅ |
| danger `#f87171` on card | 5.65 | ✅ |

## 4. The owner's specific concerns — each avoided by design

| Concern | Finding |
|---|---|
| Harsh **pure-black** | bg is `#17172a`, surfaces `#21213a`/`#272743` — deep violet-black, never `#000`. |
| Uncontrolled **glass** | `--mn-glass` used only on `.mn-cmdbar-sticky` via `backdrop-filter: saturate(1.15)` — a mild saturate, no unbounded blur, one element. |
| Excessive **glow** | `--mn-glow-primary` (violet, α 0.28) only on the primary button + selected row — selective, not ambient. |
| Muddy **gradients** | brand gradient appears only in the logo / `mn-gradient-text`, never on content surfaces. |

## 5. Component/state coverage (owner's checklist)

Verified via the token architecture + the rendered baselines: **tables** (materials,
11 seeded rows) · **forms + inputs + selects** (materials, billing) · **KPI cards /
stat tiles** (dashboard) · **funnel** (dashboard) · **alerts** (dashboard "Needs
attention") · **empty states** (billing invoices) · **badges** (token fg/bg tints) ·
**buttons** primary/secondary/ghost/danger (materials Deactivate) · **dialogs/drawers**
(`var(--mn-surface)` — U6 shots). No **charts** exist (funnels/stats are token-styled
divs). Interaction states (hover/focus/selected/disabled) are token- and
`:root[data-ui='v2']`-scoped (U1/U6), so they inherit dark correctly.

## Evidence artifacts

- 55 × light+dark × 4 viewports V2 baselines (committed, U7).
- Luminance sweep (this doc §1), contrast table (§3), token-bypass audit (§2).
- Visual confirmations: dashboard, billing-invoices, masters-materials (dark, desktop).

**No before/after pairs — because no screen needed correcting.** Recording that
honestly rather than manufacturing edits.
