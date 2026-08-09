# Mix Nova RMC Software — Pre-Pilot UI/UX Visual Polish Plan (Phase 1)

**Product:** Mix Nova · **Full brand:** Mix Nova RMC Software · **Tagline:** *Smart Mix. Stronger Future.*
**Status:** PLAN ONLY — awaiting approval. **No polish code written.**
**Scope:** Visual/UX polish of **existing Phase-1 web screens** + mobile-responsive web +
a Mix Nova design-system foundation. **No backend business-logic changes. No native mobile
app. No new features. No deployment/DNS/TLS/VPS.**
**Baseline commit:** `4adb10e` · branch `claude/rmc-plant-saas-requirements-6df8ur`.

> **Logo note:** the attached Mix Nova logo file was **not received** on the build side.
> This plan defines brand usage from the stated palette/direction; the exact logo asset
> will be wired in once dropped into `apps/web/public/brand/` (SVG preferred + PNG + favicon).

---

## 1. Current UI audit summary (code-verified)

| Aspect | Current state | Gap vs. "world-class premium SaaS" |
|---|---|---|
| Styling | 100% inline `style={{…}}` (~453 sites) + small `lib/ui.ts` | No component kit → inconsistent; no brand identity |
| Tokens | 5 dark-only CSS vars (`--bg #0b1020`, `--brand #f2a33c` amber) | No ramp, no semantic tokens, wrong brand color |
| Color | ad-hoc status hex (`#ff8080`/`#6ee7a8`/`#e0b341`) | Not tokenized, contrast unaudited |
| Type | `system-ui` only | No brand type, no scale, no tabular figures |
| Icons | **none** (0 libs/SVG) | Reads utilitarian, not premium |
| Shell | grouped left sidebar, 44 pages | Solid IA; not collapsible, no brand header |
| Responsive | **0 `@media`** | Unusable on tablet/phone on the floor |
| States | minimal empty/error/loading | No skeletons/standard empties |
| i18n | English only, no script fonts | Not ready for Indian languages |
| Branding | title "RMC Pro — Plant SaaS" | No Mix Nova identity anywhere |

**Verdict:** IA and data flows are sound; the presentation layer is bare-functional.
Plan = a Mix Nova **token + component-kit foundation**, then a screen-by-screen re-skin
that preserves all behavior.

---

## 2. Proposed Mix Nova visual direction

**"Industrial Nova"** — a serious industrial operating system with a premium, modern
(Gen-Z-informed) polish: confident purple/violet identity, deep-dark contrast moments,
and **subtle Nova gradients used only on identity surfaces** (logo lockup, login hero,
sidebar brand header, active-nav, hero KPI accent) — **never behind data tables or body
text**. Everything operational stays calm, high-contrast and dense-but-legible.

- **Not playful.** Geometric, precise, generous spacing, restrained motion. No cartoon
  illustrations, no bright candy colors, no bouncy animation.
- **Theme:** ship **both**; **Light = default for daily operations** (best legibility on
  low-end monitors in daylight, long data-entry sessions), **Dark = first-class,
  brand-forward** alternative. Login/dashboard use tasteful Nova-gradient accents in both.
- **Status = color + label always** (never color alone — greyscale/printed challans, a11y).
- **Signature Nova gradient:** `linear-gradient(135deg, #6C2BD9 0%, #8A4FFF 100%)`.

---

## 3. Full color token system

Brand anchors (from Mix Nova): Primary Purple `#6C2BD9`, Electric Violet `#8A4FFF`,
Soft Lavender `#B78CFF`, Deep Navy `#1E1E2E`, Neutral Grey `#8E8E9A`, white/off-white.
A premium SaaS needs an accessible **ramp** derived from these — all shipped as CSS
custom properties; components read tokens, never raw hex.

### 3.1 Purple ramp (brand identity)
| Token | Hex | Use |
|---|---|---|
| `--purple-50` | `#F4EEFF` | selected row/badge tint (light), hover |
| `--purple-100` | `#E9DDFF` | subtle fills |
| `--purple-300` | `#B78CFF` | **Soft Lavender** — focus ring, accents on dark |
| `--purple-500` | `#8A4FFF` | **Electric Violet** — hover, gradient end, dark-theme action |
| `--purple-600` | `#6C2BD9` | **Primary Purple** — default action (white text, ~7:1 AA✓) |
| `--purple-700` | `#5A1FB8` | button hover (light) |
| `--purple-800` | `#481A90` | pressed/active |
| `--purple-900` | `#2E1160` | deep accents |

### 3.2 Light theme (default)
| Role | Token | Hex | Notes |
|---|---|---|---|
| App bg | `--bg` | `#F7F7FB` | cool off-white |
| Surface / card | `--surface` | `#FFFFFF` | |
| Border | `--border` | `#E6E6EF` | |
| Text | `--text` | `#1E1E2E` | brand navy, 16:1 ✓ |
| Text muted | `--muted` | `#5B5B6B` | AA 4.5 ✓ (body-muted) |
| Placeholder/divider/icon | `--subtle` | `#8E8E9A` | brand grey, 3:1 (non-text/large only) |
| Primary action | `--primary` | `#6C2BD9` | white text |
| Focus ring | `--focus` | `#B78CFF` | 2px glow |

### 3.3 Dark theme (brand-forward)
| Role | Hex |
|---|---|
| bg / surface / elevated | `#14141F` / `#1E1E2E` / `#2D2D40` |
| border | `#33334A` |
| text / muted | `#ECECF3` / `#A9A9B8` |
| primary action / hover | `#8A4FFF` / `#9E6BFF` |
| accent / focus | `#B78CFF` |

### 3.4 Semantic colors (kept universal for instant plant-staff recognition)
Purple is **identity**, not status. "In-progress/processing" may use on-brand violet tint;
success/warning/danger stay the universal green/amber/red.
| Semantic | Light (text / tint) | Dark |
|---|---|---|
| Success | `#15803D` / `#DCFCE7` | `#4ADE80` |
| Warning | `#B45309` / `#FEF3C7` | `#FBBF24` |
| Danger | `#B91C1C` / `#FEE2E2` | `#F87171` |
| Info / processing | `#6C2BD9` / `#F4EEFF` | `#B78CFF` |

### 3.5 Status → domain map (badges)
draft → grey · submitted/pending → info-violet · approved/confirmed → success ·
batching/in-progress/in-transit → info-violet · delivered/paid → success ·
invoiced → neutral/info · partially_paid → warning · on_hold / credit-hold → warning ·
negative_stock → danger · cancelled/rejected → grey/danger.

---

## 4. Font recommendation
- **Display / headings: Space Grotesk** (or Sora) — geometric, modern, premium "Nova"
  feel for page titles, KPI numbers, the wordmark; keeps it Gen-Z-modern but serious.
- **UI / body / data: Inter** — the premium SaaS workhorse; **tabular figures**
  (`"tnum"`) on all tables/amounts so ₹ and quantity columns align.
- **Indian scripts: Noto Sans** family (Devanagari/Tamil/Telugu/Kannada/Bengali/Gujarati…)
  as per-script fallbacks.
- **All self-hosted** via `next/font/local` — CSP-safe, works offline & on poor
  connectivity (no external CDN calls).

| Style | Font | Size/LH/Weight |
|---|---|---|
| Display | Space Grotesk | 30/38/600 |
| H1 / H2 / H3 | Space Grotesk / Inter | 24/32/600 · 20/28/600 · 16/24/600 |
| Body / Small / Label | Inter | 14/22/400 · 13/20/400 · 12/16/500 (tracked caps) |
| Numeric (tables/KPIs) | Inter tnum | as context |

---

## 5. Icon recommendation
**Lucide** (`lucide-react`, MIT, tree-shakeable, **no runtime network calls**) — clean,
consistent 24px stroke set; professional, not childish. Sizes 16/18/20/24, stroke ~1.75,
`currentColor`; **active nav icon** tinted Soft Lavender / Nova-gradient. Domain map:
Dashboard→LayoutDashboard, Orders→ClipboardList, Dispatch→Truck, Challan→FileText,
Invoice→ReceiptText, Inventory→Boxes, Production→Factory, Weighbridge→Scale,
Customers→Building2, Users→Users, Reports→BarChart3, Settings→Settings.

---

## 6. Component style guide (`apps/web/src/components/ui/`)

- **Buttons:** `primary` (purple-600, white), `secondary` (surface + border), `ghost`,
  `danger`; sizes sm·md; icon-leading; `disabled`+`loading` (spinner); ≥40px (touch);
  focus ring `--focus`.
- **Sidebar/topbar:** Nova-gradient brand header with Mix Nova lockup; collapsible groups;
  active item = lavender indicator + tinted icon; sticky top bar (tenant/plant context +
  user menu + theme toggle); collapses to a **drawer** under `md`.
- **Cards:** header (title + actions) / body / footer; section card; **stat/KPI card**
  (label · Space-Grotesk value · delta · icon · optional gradient accent bar).
- **Tables:** sticky header, row hover, optional zebra, **numeric right-align + tabular
  figures**, status-badge column, dense mode, empty-row; mobile fallback = horizontal
  scroll → stacked "record cards" under `sm`.
- **Forms/inputs:** label + help + error text, focus ring, select, date, textarea,
  inline validation, required markers; error = danger border + message.
- **Status badges:** pill, dark-text-on-tint per §3.4/§3.5.
- **Dashboard widgets:** KPI tiles, operations-funnel bar, trend sparkline, list widget —
  token-driven; gradient only on the hero/first tile.
- **States:** skeleton loaders; standard **empty** (icon + one line + primary CTA);
  **error** (banner + retry); **toasts** for action feedback.
- **Motion:** 150–200ms ease; hover/press/focus only; respect `prefers-reduced-motion`.

### English + Indian-language readiness
Noto fallbacks cover Indian scripts; layout tolerates longer/different-script strings
(no fixed-width label truncation; wrap/ellipsis rules; touch targets preserved); no text
baked into icons; component copy centralized so a later translation track can slot in
(full translation is a **separate track**, not this one).

### Mobile-responsive web rules
Breakpoints `sm 640 / md 768 / lg 1024 / xl 1280`; sidebar→drawer under `md`; tables→
scroll/stacked under `sm`; forms single-column; targets ≥44px. **No native mobile app.**

---

## 7. Phase-1 screen polish priority list (all 44 web + plant-app)

Delivered as **small, separately-committed increments**; behavior preserved; e2e re-run each phase.

- **Phase A — Foundation (no screen visually changes):** Mix Nova tokens + both themes +
  Nova gradient in `globals.css`; self-hosted fonts; Lucide; `components/ui` kit
  (Button, Card, Table, Field, Badge, StatCard, Skeleton, EmptyState, ErrorState, Toast,
  ThemeToggle, Icon, Logo). `lib/ui.ts` → thin wrappers over the kit.
- **Phase B — Brand & first impression:** app shell (Nova sidebar/topbar, responsive,
  brand header), `/login` (Nova-gradient hero + lockup + tagline), `/app/dashboard`.
- **Phase C — High-traffic ops:** orders (+`[id]`), credit-holds, dispatch board,
  challans (+`[id]`), batch-queue, batch-tickets (+`[id]`), stock, invoices (+`[id]`),
  receipts, outstanding.
- **Phase D — Masters/setup/sales/admin/reports:** `MasterCrud`-driven `entity/*`
  (customers, sites, materials, suppliers, vehicles, drivers, grades, plants,
  number-series), company/users/roles/settings/devices, sales (leads/quotations/
  rate-contracts/order-drafts +details), production plans/mix-designs/reports, inventory
  inward/weighbridge/adjustments/negative-stock/reports, billing reports, `/app/reports`,
  super-admin `/admin`,`/admin/plans`,`/admin/tenants`(+`[id]`).
- **Phase E — Polish & QA:** plant-app renderer re-skin, full responsive pass, AA/contrast
  + keyboard/focus a11y audit, Indian-script font QA.

---

## 8. Risk / impact notes

| Area | Risk | Mitigation |
|---|---|---|
| Backend logic | **None** — UI-only | No service/DB/API changes; display formatting only |
| 44 inline-styled screens | Medium (broad) | Foundation-first + **additive** token layer (old inline styles keep working during migration); small per-screen commits; each reversible |
| E2E gate (34/34) | Low — hits **API**, not DOM | Re-run `pnpm test:e2e` each phase; preserve any test hooks |
| New deps | Low | `lucide-react` + self-hosted Inter/Space Grotesk/Noto — all MIT, **no external runtime calls** (CSP/offline-safe), tree-shaken/subset |
| Theme default | Reversible | Ship both; default Light for ops (your call) |
| Contrast (brand purples) | Handled | Ramp derived for AA; lavender/violet limited to non-text/accents (documented in §3) |
| PDF letterhead branding | Touches `apps/api` (pdfkit) | **Optional, separate follow-up** — excluded from core UI polish to honor "no backend change" |

**Rollback:** each phase is an isolated commit; token layer is additive, so any phase reverts independently.

---

## 9. Files that will be changed later (if approved)

*Foundation (Phase A):*
- `apps/web/src/app/globals.css` — Mix Nova tokens, light+dark themes, Nova gradient, font vars
- `apps/web/src/app/layout.tsx` — self-hosted fonts (`next/font/local`), metadata → "Mix Nova RMC Software", `data-theme`
- `apps/web/src/lib/ui.ts` — re-point to token-based kit
- **NEW** `apps/web/src/components/ui/*` — Button, Card, Table, Field, Badge, StatCard, Skeleton, EmptyState, ErrorState, Toast, ThemeToggle, Icon, Logo
- **NEW** `apps/web/public/brand/*` — logo SVG/PNG + favicon *(pending your logo file)*
- **NEW** `apps/web/src/app/fonts/*` — self-hosted font files
- `apps/web/package.json` — add `lucide-react`

*Shell & screens (Phases B–E):*
- `apps/web/src/app/app/layout.tsx` (shell), `apps/web/src/app/login/page.tsx`,
  `apps/web/src/app/app/dashboard/page.tsx`, then the remaining ~40 screens under
  `apps/web/src/app/**` and `apps/web/src/components/MasterCrud.tsx`
- `apps/web/src/app/globals.css` favicon/app-icon wiring; `apps/web/next.config.mjs` (only if needed)
- **Phase E:** `apps/plant-app/src/renderer/index.html`

*Optional, separate (not in core polish):* `apps/api` PDF templates (quotation/challan/
invoice) for Mix Nova letterhead.

---

## 10. Open decisions before Phase A
1. **Default theme:** Light-default for ops + Dark option (recommended) · Dark-default · Light-only.
2. **Display font:** Space Grotesk (recommended) · Sora · Inter-only.
3. **Rollout depth:** approve A–E · or stop after **B** (shell+login+dashboard) to review the look first.
4. **Logo asset:** add the Mix Nova logo to `apps/web/public/brand/` so Phase A/B can wire it.

## What this plan does NOT do
No deployment/DNS/TLS/VPS · no backend logic change · no native mobile app · no Phase-2
features · no coding until you approve.
