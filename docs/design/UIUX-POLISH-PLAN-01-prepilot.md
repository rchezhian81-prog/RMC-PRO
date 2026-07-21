# RMC Plant SaaS — Pre-Pilot UI/UX Visual Polish Plan (Phase 1)

**Status:** PLAN ONLY — awaiting approval. No polish code has been written.
**Scope:** Visual/UX polish of the **existing Phase-1 web screens** + mobile-responsive
web + design-system foundation. **No backend business-logic changes. No native mobile
app. No new features** (QC, GPS, live GSTN/e-invoice/e-way, Tally API, live payments,
customer portal all remain out of scope).
**Baseline commit:** `624f28d` · branch `claude/rmc-plant-saas-requirements-6df8ur`.

---

## 1. Visual design audit (current state, code-verified)

| Aspect | Current state | Assessment |
|---|---|---|
| Styling method | 100% inline `style={{…}}` (~453 sites) + a small `lib/ui.ts` (card/input/button/table tokens) | Functional; no reusable component kit → inconsistent spacing/variants |
| Design tokens | 5 CSS vars in `globals.css` (`--bg #0b1020`, `--panel`, `--text`, `--muted`, `--brand #f2a33c`) | Minimal, dark-only, no scale (no neutral ramp, no semantic tokens) |
| Color usage | Ad-hoc inline hex for status (`#ff8080` red, `#6ee7a8` green, `#e0b341` amber) | Not tokenized, contrast not audited (AA unknown) |
| Typography | `system-ui` stack only | No brand type, no scale, no tabular figures for numeric tables |
| Icons | **None** (0 icon libs, 0 SVG) | Text-only nav/actions → reads utilitarian, not premium |
| Layout / shell | Grouped left sidebar (`app/app/layout.tsx`), 44 pages | Solid IA; sidebar not collapsible |
| Responsiveness | **0 `@media` queries** — fixed desktop layout | Not usable on tablet/phone on the plant floor |
| States | Minimal empty/loading/error handling | No skeletons, no standard empty/error patterns |
| i18n | English only, no script-coverage fonts | Not ready for Indian-language rendering |
| Plant app | 55-line `renderer/index.html` | Bare; polish deferred to Phase E |

**Verdict:** the information architecture and data flows are sound; the *presentation
layer* is bare-functional. The right move is a **token + component-kit foundation**,
then a screen-by-screen re-skin that preserves all existing behavior.

---

## 2. Proposed design direction

**"Industrial Premium"** — a clean, high-legibility operational SaaS look: the calm/clarity
of modern SaaS dashboards (Stripe/Linear-grade spacing and type) tuned for **plant-floor
legibility** (high contrast, large touch targets, dense data tables with clear status).

- **Light-first, dark-optional.** Recommend **light theme as default** — plant offices,
  weighbridge cabins, and low-end monitors read high-contrast light UIs better in
  daylight; keep the existing dark theme as a user-toggle. (Open decision — see §6.)
- **Concrete + construction** cue: neutral "concrete" greys as the base, a **trust-blue**
  primary for actions, and **construction amber** (brand continuity with today's
  `#f2a33c`) as a highlight/status accent — not the primary CTA color (contrast).
- Calm surfaces, one clear primary action per view, status always color **and** label
  (never color alone — accessibility + printed/greyscale challans).

---

## 3. Design system proposal

### 3.1 Color palette (WCAG AA targeted)

**Light theme (default)**
| Role | Token | Hex |
|---|---|---|
| App background | `--bg` | `#F6F8FB` |
| Surface / card | `--surface` | `#FFFFFF` |
| Border / divider | `--border` | `#E2E8F0` |
| Text primary | `--text` | `#0F172A` |
| Text muted | `--muted` | `#475569` |
| Primary (action) | `--primary` | `#1D4ED8` (hover `#1E40AF`, on-primary `#FFFFFF`) |
| Accent (construction) | `--accent` | `#F59E0B` (text-on-light `#B45309`) |
| Success | `--success` | text `#15803D` / tint `#DCFCE7` |
| Warning | `--warning` | text `#B45309` / tint `#FEF3C7` |
| Danger | `--danger` | text `#B91C1C` / tint `#FEE2E2` |
| Info | `--info` | text `#1D4ED8` / tint `#DBEAFE` |

**Dark theme (refined from current, optional)**
| Role | Hex |
|---|---|
| bg / surface / border | `#0B1220` / `#141B2E` / `#26314B` |
| text / muted | `#E7ECF5` / `#9AA6BD` |
| primary / accent | `#3B82F6` / `#F2A33C` (brand kept) |
| success / warning / danger | `#4ADE80` / `#FBBF24` / `#F87171` (brightened for dark) |

All tokens ship as CSS custom properties in `globals.css`, themed via
`:root` / `[data-theme="dark"]` — components read tokens, never raw hex.

### 3.2 Typography / font scale
- **UI (Latin + numerals): Inter** — the premium SaaS default; **self-hosted** via
  `next/font/local` (no external CDN → CSP-safe, works on poor India connectivity and in
  the offline plant app).
- **Indian scripts: Noto Sans** family (Devanagari, Tamil, Telugu, Kannada, Bengali,
  Gujarati…) as per-script fallbacks — Noto is purpose-built for multi-script coverage.
- **Numbers:** enable tabular figures (`font-feature-settings: "tnum"`) for all data
  tables/amounts (aligned columns for quantities and ₹).

| Style | Size / line-height / weight |
|---|---|
| Display | 30 / 38 / 700 |
| H1 | 24 / 32 / 700 |
| H2 | 20 / 28 / 600 |
| H3 | 16 / 24 / 600 |
| Body | 14 / 22 / 400 |
| Small | 13 / 20 / 400 |
| Caption/Label | 12 / 16 / 500 (uppercase, tracked) |

### 3.3 Icon system
- **Lucide** (`lucide-react`, MIT, tree-shakeable, self-contained — no runtime calls).
  Consistent 24px stroke set; sizes 16/18/20/24, stroke ~1.75, `color: currentColor`.
- Domain mapping (examples): Dashboard→`LayoutDashboard`, Orders→`ClipboardList`,
  Dispatch→`Truck`, Challan→`FileText`, Invoice→`ReceiptText`, Inventory→`Boxes`,
  Production→`Factory`, Weighbridge→`Scale`, Customers→`Building2`, Users→`Users`.

### 3.4 Spacing, radius, elevation
- **4px spacing scale**: 4·8·12·16·20·24·32·40·48.
- **Radius**: sm 6 · md 8 · lg 12 (cards) · pill (badges).
- **Elevation**: 3 subtle shadow tokens (card / dropdown / modal); flat by default.

### 3.5 Components (reusable kit → `apps/web/src/components/ui/`)
- **Buttons**: `primary` / `secondary` / `ghost` / `danger`; sizes sm·md; icon-leading; `disabled` + `loading` (spinner) states; ≥40px height (touch).
- **Cards**: header (title + actions) / body / footer; section card; stat card.
- **Tables**: sticky header, row hover, optional zebra, **numeric right-align + tabular figures**, status column, dense mode, empty-row, and a mobile fallback (horizontal scroll container → stacked "record cards" under `sm`).
- **Forms/inputs**: label + help + error text, focus ring (`--primary`), select, date, textarea, inline validation, required markers.
- **Status badges**: pill, dark-text-on-tint per semantic; a documented **status→color map** for domain states (draft, submitted, approved, confirmed, batching, dispatched, delivered, invoiced, partially_paid, paid, on_hold, negative_stock, cancelled).
- **Dashboard widgets**: KPI stat tile (label / value / delta / icon), operations-funnel bar, simple trend sparkline, list widget — all token-driven.
- **States**: skeleton loaders, standard **empty state** (icon + one line + primary CTA), **error state** (banner + retry), and **toasts** for action feedback.

### 3.6 English + Indian-language readiness (readiness, not full translation)
- Fonts above cover Indian scripts (Noto fallbacks).
- Layout tolerates longer/different-script strings: no fixed-width label truncation, wrap/ellipsis rules, min touch target preserved.
- No text baked into icons/images.
- Component copy centralized so a future i18n/translation track can slot in. (Full multi-language translation is a **separate track**, not this one.)

### 3.7 Mobile-responsive web polish
- Shell: sidebar collapses to a hamburger **drawer**; sticky top bar with context + user menu.
- Breakpoints: `sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280.
- Tables → scroll container or stacked record-cards under `sm`; forms single-column; touch targets ≥44px.
- **No native mobile app** — responsive web only (per constraint).

---

## 4. Screens to polish (all 44 web screens + plant-app), phased

Delivered as **small, separately-committed increments** (constraint #8). Each phase is
its own reviewable commit/PR; behavior preserved.

- **Phase A — Foundation (no screen visually changes yet):** design tokens in
  `globals.css` (light+dark), self-hosted fonts, Lucide, and the `components/ui` kit
  (Button, Card, Table, Input/Field, Badge, StatCard, Skeleton, EmptyState, ErrorState,
  Toast). Expand `lib/ui.ts` → thin wrappers over the kit.
- **Phase B — Shell & first impression:** responsive app shell/sidebar+topbar, `/login`,
  `/app/dashboard`.
- **Phase C — High-traffic operations:** `/app/orders` (+ `[id]`), `/app/credit-holds`,
  `/app/dispatch/board`, `/app/dispatch/challans` (+ `[id]`),
  `/app/production/batch-queue`, `/app/production/batch-tickets` (+ `[id]`),
  `/app/production/stock`, `/app/billing/invoices` (+ `[id]`), `/app/billing/receipts`,
  `/app/billing/outstanding`.
- **Phase D — Masters, setup, sales, admin, reports:** the `MasterCrud`-driven
  `/app/entity/*` screens (customers, sites, materials, suppliers, vehicles, drivers,
  grades, plants, number-series), `/app/company` `/app/users` `/app/roles`
  `/app/settings` `/app/devices`; sales (`/app/sales/leads|quotations|rate-contracts|order-drafts`
  + detail pages); production plans/mix-designs/reports; inventory inward/weighbridge/
  adjustments/negative-stock/reports; billing reports; `/app/reports`; super-admin
  `/admin`, `/admin/plans`, `/admin/tenants` (+ `[id]`).
- **Phase E — Polish & QA:** plant-app `renderer` re-skin, full responsive pass,
  contrast/AA audit, keyboard/focus a11y, Indian-script font QA.

---

## 5. Risk / impact

| Area | Risk | Mitigation |
|---|---|---|
| Backend logic | **None** — UI-only; constraint #7 honored | No service/DB/API changes; only display formatting |
| Regression across 44 inline-styled screens | Medium (broad surface) | Foundation-first, then re-skin screen-by-screen in small commits; preserve DOM semantics & any test hooks; visual check each |
| E2E CI gate (34/34) | Low — suite hits the **API**, not the DOM | Re-run `pnpm test:e2e` after each phase; unaffected by styling |
| New deps | Low | `lucide-react` + self-hosted Inter/Noto — all MIT, **no external runtime calls** (CSP/offline-safe); icons tree-shake, fonts subset |
| Default theme flip (dark→light) | Visible change | Ship both; **you choose default** (§6) — reversible token switch |
| Bundle size | Low | Tree-shaken icons; subset self-hosted fonts |
| Scope creep into i18n | Contained | Readiness only (fonts + layout tolerance); full translation is a separate track |

**Rollback:** each phase is an isolated commit; the token layer is additive (old
inline styles keep working during migration), so any phase can be reverted independently.

---

## 6. Open decisions for you (before Phase A)
1. **Default theme:** light-first (recommended) vs keep dark-default vs ship both with a toggle (recommended regardless).
2. **Primary color:** trust-blue `#1D4ED8` (recommended) vs keep amber `#f2a33c` as primary.
3. **Rollout:** all phases A–E, or stop after B (shell + login + dashboard) to review the look before committing to the full re-skin.

---

## 7. What this plan does NOT do
No deployment/DNS/TLS/VPS. No backend logic change. No native mobile app. No Phase-2
features. No coding of the polish until you approve.
