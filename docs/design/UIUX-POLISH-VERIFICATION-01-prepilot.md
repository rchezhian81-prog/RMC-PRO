# Mix Nova — UI/UX Polish Verification (Phase E, pre-pilot)

**Product:** Mix Nova · _Smart Mix. Stronger Future._
**Scope:** Final visual polish & QA only. No backend/business-logic changes, no new
features. This document is the sign-off checklist for the Phase E polish pass.
**Verified on:** production build (`next build` + `next start`), Chromium via Playwright.

---

## 1. Plant-app renderer & offline screen polish (E1/E2)

The Electron plant-app renderer (`apps/plant-app/src/renderer/index.html`) was
re-skinned to the Mix Nova design language. **No bridge/business logic changed** —
every `window.rmc.*` call (auth, register, reserve, createChallan, createBatch,
push, pull, status) is preserved byte-for-byte.

| Item | Before | After | Status |
|------|--------|-------|--------|
| Brand identity | none (bare dark page) | Nova-gradient header, "M" mark + Mix Nova wordmark | ✅ |
| Layout | stacked dark cards | light Mix Nova cards, 2-col responsive grid | ✅ |
| Connection state | none | online/offline pill driven by `navigator.onLine` (pure UI) | ✅ |
| Sync visibility | raw JSON only | Pending-push / Local-challans / Local-batches stat tiles | ✅ |
| Buttons | single amber style | Mix Nova primary/secondary, focus-visible rings | ✅ |
| Activity log | plain `<pre>` | timestamped, scrollable, `aria-live="polite"`, Clear action | ✅ |
| Fonts | system-ui only | Inter + Noto (Tamil/Devanagari) in the stack for Indic names | ✅ |
| Offline messaging | "(works without network)" inline | explicit "stored locally & queued until next push" hint | ✅ |

Verified narrow (tablet) reflow at 480px — cards collapse to single column, no
horizontal scroll.

---

## 2. Indian-script font QA (E3/E4)

Loaded at build time via `next/font/google` (self-hosted, **no runtime external
calls**), wired into `--mn-font-body`:

- **Noto Sans** (`devanagari` subset) → Hindi
- **Noto Sans Tamil** (`tamil` subset) → Tamil
- Latin stays on **Inter**; the browser only reaches a Noto face for codepoints
  Inter lacks, so English/number columns are unchanged.

| Script | Sample rendered | Tofu (□)? | Status |
|--------|-----------------|-----------|--------|
| Hindi / Devanagari | मिक्स नोवा — रेडी मिक्स कंक्रीट संयंत्र प्रणाली | none | ✅ |
| Hindi + digits | ग्राहक — साइट अभियंता — 6 घन मीटर M25 | none | ✅ |
| Tamil | மிக்ஸ் நோவா — ரெடி மிக்ஸ் கான்கிரீட் ஆலை அமைப்பு | none | ✅ |
| Tamil + digits | வாடிக்கையாளர் — தளப் பொறியாளர் — 6 கன மீட்டர் | none | ✅ |
| Latin + ₹ (tabular) | Mix Nova — 1,250.00 ₹ · M25 · 120mm | n/a | ✅ |

Real glyphs render for every line — customer / site / receiver names entered in
Hindi or Tamil will display correctly across the web app and the plant app.

> Coverage note: Devanagari (Hindi/Marathi) and Tamil are loaded now. Telugu,
> Kannada, Malayalam, Gujarati, Bengali, etc. still fall back to the OS font if
> installed; adding those Noto subsets is a one-line-each follow-up when a pilot
> plant needs them (not a code change to any screen).

---

## 3. Accessibility pass (E3)

| Check | Implementation | Status |
|-------|----------------|--------|
| Skip-to-content link | `.mn-skip` in both shells → focuses `<main id="main" tabindex="-1">` | ✅ |
| Visible focus rings | `:focus-visible` 2px `--mn-focus` outline on all interactive elements | ✅ |
| Active nav semantics | `aria-current="page"` on the active link (app + admin) | ✅ |
| Labelled nav regions | each sidebar group `<nav aria-label="…">` | ✅ |
| Live regions | `Loading` → `role="status"`; `ErrorState` / login error → `role="alert"` | ✅ |
| Decorative icons | `aria-hidden` on Lucide glyphs paired with a text label | ✅ |
| Icon-only buttons | `aria-label` on hamburger, close, theme toggle | ✅ |
| Form labels | `<label htmlFor>` + `autoComplete` on login username/password | ✅ |
| Drawer scrim | `aria-hidden` (decorative), click-to-close preserved | ✅ |
| Reduced motion | `@media (prefers-reduced-motion)` disables spinner/skeleton animation | ✅ |

---

## 4. Contrast pass (WCAG AA)

Semantic tokens were chosen/kept for AA on both themes. Key text pairs:

| Pair | Ratio (approx) | AA (4.5:1 text) |
|------|----------------|-----------------|
| `--mn-text` #1e1e2e on `--mn-surface` #ffffff | ~15.9:1 | ✅ |
| `--mn-muted` #5b5b6b on #ffffff | ~6.4:1 | ✅ |
| `--mn-muted` on `--mn-bg` #f7f7fb | ~6.0:1 | ✅ |
| White on `--mn-primary` #6c2bd9 (buttons, active nav) | ~6.5:1 | ✅ |
| `--mn-danger` #b91c1c on `--mn-danger-tint` #fee2e2 | ~5.9:1 | ✅ |
| `--mn-warning` #b45309 on `--mn-warning-tint` #fef3c7 | ~5.2:1 | ✅ |
| Dark: `--mn-text` #ececf3 on `--mn-surface` #1e1e2e | ~13.2:1 | ✅ |
| Dark: `--mn-muted` #a9a9b8 on #1e1e2e | ~6.7:1 | ✅ |

`--mn-subtle` #8e8e9a is reserved for non-text / large-label use only (section
captions), consistent with AA large-text rules. Verified visually in both light
and dark dashboards.

---

## 5. Responsive / mobile web QA

| Breakpoint | Result | Status |
|------------|--------|--------|
| Login @ 375px | card centred, wordmark + form scale, no overflow | ✅ |
| App shell @ ≥1024px | fixed 248px sidebar + fluid content | ✅ |
| App shell < 1024px | sidebar → off-canvas drawer, hamburger + scrim | ✅ |
| Mobile drawer @ 390px | opens over scrim, X-close, grouped nav, active pill | ✅ |
| Topbar @ mobile | hamburger + breadcrumb + toggle + truncated email + Logout | ✅ |
| Content max-width | `main` capped at 1120px for readable line length | ✅ |
| Plant app @ 480px | 2-col grid → 1 col, no horizontal scroll | ✅ |

---

## 6. Loading / empty / error state consistency

All three states are centralised in `components/ui/States.tsx` and used across
every re-skinned screen:

- **Loading** — spinner + label, `role="status"`, honours reduced-motion.
- **Skeleton** — `.mn-skel` pulse blocks, honours reduced-motion.
- **EmptyState** — tinted icon chip + title + description + optional action.
- **ErrorState** — danger-tint banner, `role="alert"`, optional retry action.

Consistency verified: the live "Failed to fetch" banner (dashboard, no API)
renders identically in light and dark with the correct `role="alert"` semantics.

---

## 7. Final UI/UX polish checklist

- [x] Mix Nova brand system (purple palette, gradient, Inter + Space Grotesk) applied app-wide
- [x] Light default for ops; dark opt-in via toggle; both AA-contrast
- [x] All ~40 tenant + admin screens on the shared UI kit (Card/Table/Badge/Button/Field/StatCard/States)
- [x] Plant-app renderer re-skinned to Mix Nova (offline app polish)
- [x] Indian-script fonts loaded (Hindi/Devanagari + Tamil) — no tofu
- [x] Accessibility: skip link, focus rings, aria-current, live regions, labelled controls
- [x] Responsive/mobile verified (login, app shell, drawer, plant app)
- [x] Loading/empty/error states consistent and centralised
- [x] Logo: wordmark placeholder retained; auto-detect wired for the real asset (`public/brand/`)
- [x] Build + typecheck + lint clean
- [x] No backend/business-logic changes; no new features

---

## 8. Known remaining cosmetic issues (non-blocking for pilot)

1. **Indic coverage is Hindi + Tamil only.** Other Indian scripts fall back to OS
   fonts; add the relevant Noto subset per pilot region when needed.
2. **Logo is still the typographic placeholder.** By design — swaps automatically
   the moment `apps/web/public/brand/mix-nova-logo.svg` (+ `-white`) is committed.
   No code change required.
3. **Plant-app is the functional dev renderer.** Polished and brand-consistent,
   but it remains the operator test console, not a final field-hardened kiosk UI
   (out of scope for pre-pilot polish).
4. **Charts/data-viz** on report screens use plain tables/stat cards; richer
   visualisations are a post-pilot enhancement, not a polish gap.
5. **Favicon / browser-tab icon** still default; ships with the real logo asset.

---

## 9. Verdict

**Mix Nova UI/UX is pilot-ready.** The visual language is consistent across the
web app, super-admin portal, and offline plant app; Indian-language names render
correctly; accessibility and contrast meet AA; and responsive behaviour is verified
from 375px to desktop. Remaining items are additive (extra Indic subsets, the real
logo asset) and require no screen rework.
