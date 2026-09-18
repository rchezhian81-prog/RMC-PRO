Mix Nova is the operating system for a Ready Mix Concrete plant: orders, batching, dispatch, weighbridge, billing and collections, used for long shifts by owners, office staff and plant operators. The tagline is *Smart Mix. Stronger Future.* The look is "Deep Violet Matte": violet is the identity, white cards on a cool grey ground are the work surface, and status colours stay the universal green, amber and red so plant staff read them instantly.

## Voice and content

- Write plain, operational English in sentence case: "New Challan", "Export", "More filters", "Approve override", "Show more". Keep button labels to a verb or a verb and a noun.
- Statuses are the API's own words with underscores turned into spaces and shown lowercase inside a badge: `credit_hold` renders as "credit hold". Never invent friendlier names for a status; map its tone instead (see Colour).
- Say what will actually happen, including the bad case. The offline banner reads "You're offline — changes may not save until the connection returns." because the app has no offline outbox. A capped list says "Showing the 500 most recent records — an export from this screen covers the same rows, and no more."
- Money is Indian rupees with Indian grouping: "₹18,40,000.00". Counts use `toLocaleString('en-IN')`. Set every figure in tabular numerals so columns align (the body enables `'tnum'`).
- Names of customers, sites and receivers may be in Devanagari or Tamil; the `body` family carries Noto Sans fallbacks so they never render as tofu. Do not transliterate.
- No emoji, no exclamation marks, no marketing adjectives inside the app. The public landing page may use one short eyebrow (`eyebrow`) and a lede (`lp-lede`).
- Three audiences, three densities: owners get a dashboard-first screen of KPI tiles and alerts; office staff get tables, filters, forms and exports; plant operators get very few fields, large buttons and a visible offline status.

## Colour

- Grounds: `mn-bg` behind everything, `mn-surface` for cards, sidebar, topbar, inputs and overlays, `mn-surface-2` for the second step (hover, neutral badges, v2 table headers). Never stack a third surface; use a hairline (`mn-border`) or a shadow instead.
- Ink: `mn-text` for content, `mn-muted` for labels and secondary text, `mn-subtle` only for non-text detail or an uppercase label of 11px and up. In the two light themes `mn-subtle` is about 3.2:1 on white, so it is never body copy.
- Brand: `mn-primary` is the one accent. It fills the primary button, the active nav pill and the icon chip behind KPI and empty-state icons, and colours links and selected-row keylines. Text on it is `mn-on-primary`, never literal white. `mn-gradient` (Primary Purple to Electric Violet, 135°) is reserved for the logo mark, the login and landing heroes and the optional gradient KPI tile.
- Purple is identity, not status. Info and processing states (`submitted`, `pending`, `batching`, `in_transit`, `dispatched`, `invoiced`) use `mn-info` on `mn-info-tint`, which happens to be violet; success, warning and danger keep their universal hues. Success and danger differ by hue only (about 1.3:1 between them), so every status also carries its word; never a coloured dot alone.
- Status map, from the source: draft and new are neutral; approved, confirmed, delivered, paid, posted, active, received, matched, cleared are `mn-success`; partially paid, on hold, credit hold, low stock, unpaid, not invoiced, expired, grace are `mn-warning`; cancelled, rejected, negative stock, overdue, failed, suspended, bounced, reversed, written off are `mn-danger`. An unmapped status falls back to neutral, so add new API statuses to the map before they ship.
- Tones always pair text with its tint: `mn-success` on `mn-success-tint`, `mn-warning` on `mn-warning-tint`, `mn-danger` on `mn-danger-tint`, `mn-info` on `mn-info-tint`. Each pair holds 4.5:1 or better in all four themes. The danger button is the exception the source keeps: white on `mn-danger` is 6.5:1 in the light themes but 2.8:1 in both dark themes.
- The v2 finish adds a deep-violet sidebar rail (a gradient in `bundle.css`, ink in `mn-rail-fg`, items in `mn-rail-muted`, group headers in `mn-rail-title`) and chart colours for the receivables donut (`mn-age-current`, `mn-age-ageing`, `mn-age-overdue`, never used as text) and the funnel gradient (`mn-gauge-a` to `mn-gauge-b`).
- Legacy Phase-1 screens still read `bg`, `panel`, `text`, `muted`, `brand` and `brand-contrast`; they are aliases of the `mn-` tokens and must stay so.

## Type

- Display face: `display` (Space Grotesk) for every heading, title and big number; `display-v2` (Outfit, falling back to Space Grotesk) under the v2 finish. Headings are weight 600 with letter-spacing -0.01em; KPI values are 700 with -0.02em.
- Body face: `body` (Inter, then Noto Sans Devanagari and Noto Sans Tamil) for every label, control and cell. 14px is the working size (`body`, `button`, `input`); labels are `label` at 13px/500; help and error text `small` at 12px.
- Uppercase labels are short and tracked: `nav-group` (11px, 0.04em), `stat-label` (11px, 0.06em), `table-header` (11–12px), `eyebrow` (13px, 0.08em). Nothing else is uppercase.
- Sizes follow the source exactly, including the half-pixels: alert body 13.5px, captions 12.5px, landing body 14.5px. Do not snap them.
- All five faces are self-hosted files under `fonts/`; the app loads them with `next/font/local` and never reaches a font CDN, because production blocks every remote origin.

## Spacing, layout and radii

- The app shell is a 248px sidebar beside a fluid main column; the main column pads 28px (24px 28px under v2, 18px at 768px, 14px 13px at 480px). Below 1024px the sidebar becomes a 268px off-canvas drawer with a scrim and a hamburger.
- The topbar is sticky (z-index 20), 12px 22px, with the page label in `card-title`, a theme toggle and a ghost Logout button. The v2 finish blurs it slightly and it is near-opaque.
- Cards pad 18px (v2: head 13px 18px, body 16px 18px). A KPI strip is an auto-fit grid of 168px-minimum tiles with a 12px gap (v2: 212px, 14px). Under v2 a CRUD page may set its form beside its list on screens 1120px and wider.
- Use the `mn-space-*` scale for new work: 4, 8, 12, 16, 20, 24, 32, 40. Existing components keep their literal values; copy them exactly when recreating a component.
- Radii: `mn-radius-sm` for skeletons and small chips, `mn-radius-md` for buttons, inputs, bars and rows, `mn-radius-lg` for cards, dialogs and the command bar, `mn-radius-pill` for badges and the offline banner. The v2 finish rounds each step up (`mn-radius-*-v2`: 9, 12, 18).
- Borders are 1px and always a token: `mn-border` for seams and dividers, `mn-border-strong` for anything you can type into. Tables and forms never carry shadows.
- Stacking, from the source: topbar 20, mobile scrim 35, mobile sidebar 40, offline banner 50, drawer scrim 60, drawer 61, dialog scrim 70, skip link 100, confirm dialog 1000.

## Elevation and motion

- Resting cards take `mn-shadow-card`; anything floating (drawer, dialog, offline banner, mobile sidebar, a hovered v2 card) takes `mn-shadow-pop`. Command surfaces take `mn-elev-command`. The v2 finish adds `mn-shadow-1` (a whisper of lift on bars and secondary buttons) and `mn-glow-primary`, which goes under the primary button and nowhere else.
- Transitions are 160ms (`mn-dur-micro`) for colour and press, 240ms (`mn-dur-std`) for fades, lifts and pop-ins, 300ms (`mn-dur-drawer`) for the drawer slide, all on `mn-ease`. A pressed v2 button drops 1px; a hovered v2 card lifts 2–3px. Skeletons pulse (v2: shimmer). Every animation collapses under `prefers-reduced-motion`.

## States and accessibility

- Keyboard focus is a 2px solid `mn-focus` outline with a 2px offset on every link, button and field (the v2 input adds a decorative 3px violet halo beneath it). The base light ring is the source's Soft Lavender at 2.6:1 on white, below the 3:1 floor; the v2 themes use the primary violet and pass. Never remove the outline; `main` alone suppresses it because the skip link targets it.
- A page starts with a skip link ("Skip to content") that stays hidden until focused, then pins top-left on `mn-primary`. Use `mn-sr-only` for text that only screen readers need.
- Disabled controls drop to 60% opacity (rows 55%) and keep their colours. A busy button shows a spinner in place of its icon, sets `aria-busy`, and refuses further clicks until its promise settles, because a second tap on slow plant Wi-Fi must never create a second document.
- Dialogs and drawers trap focus, close on Escape and on a backdrop click, and return focus to the trigger. Confirmations use the app dialog, never `window.confirm`.
- Text pairs verified in every theme: `mn-text` on the surfaces 13.8:1 or better, `mn-muted` 5.9:1 or better, tone text on its tint 4.5:1 or better. The pairs that miss are listed on their tokens and kept as the source has them.

## Iconography

- Lucide (`lucide-react`), stroke icons drawn with `currentColor`. Sizes in use: 15px inside a small button, 16px in a button, badge or KPI chip, 18px in an icon button, alert or state, 22px in an empty-state chip.
- Domain map, from the source: Dashboard → LayoutDashboard, Orders → ClipboardList, Dispatch → Truck, Challan → FileText, Invoice → ReceiptText, Inventory → Boxes, Production → Factory, Weighbridge → Scale, Customers → Building2, Users → Users, Reports → BarChart3, Settings → Settings. States: Loader2 (spinning) for busy, Inbox for empty, AlertTriangle for error, Lock for permission denied, WifiOff for offline, CheckCircle2 / AlertTriangle / XCircle / Info for the four alert tones.
- The icon library is not copied into this system (it lives in the app's dependencies); previews inline a few Lucide paths by hand.

## Logo

- The real mark is on the brand board under `assets/LOGO/`: the initials M and N carrying a concrete mixer, a circular sweep, a skyline and a nova star, over the wordmark and "RMC SOFTWARE". It has not yet been exported as a standalone file, so the app ships the two simplified SVG lockups under `assets/Logos/`: `mix-nova-logo.svg` on light surfaces, `mix-nova-logo-white.svg` on the violet gradient or the v2 rail. Never redraw or recolour either, and never add a second tagline; the lockups already carry "RMC SOFTWARE". When the standalone mark is exported, drop it in `apps/web/public/brand/` under those two names and the `Logo` component picks it up with no code change.
- Render it at 26px tall in the sidebar, 32px in headers and 42px on the login page. If the file is unavailable the `Logo` component falls back to a typographic wordmark: a gradient rounded square holding "M" beside "Mix **Nova**" in the display face, with "Nova" in `mn-gradient` text.

## Not synced

- Components are built from the repository's own source: `components/bundle.js` is `apps/web/src/components/ui` bundled as `window.MixNova` for React 18 (the app runs React 19; nothing in these components needs it). Two stand-ins were used in the build: Next's `Link` becomes a plain anchor, and the build-time v2 flag (`NEXT_PUBLIC_UI_V2`) is read from the frame's theme instead, so `Card` and `StatCard` switch to their v2 markup under the two v2 themes. `Logo` gained one design-system-only hook (`window.MixNovaBrand`) so previews can hand it the lockup files without probing the app's `/brand/` paths.
- Previews of `Shell`, `IconButton` and `Row` are static markup because those are layout and CSS patterns, not exported components; `ThemeToggle` and `OfflineBanner` are in the bundle but shown statically (one rewrites the frame's theme on mount, the other renders nothing while online).
- `mn-selected` and `mn-selected-border` under v2, and the sidebar rail gradient, use `color-mix()` and `linear-gradient()`; they live in `bundle.css` rather than as tokens.
- Not built as cards: `MasterCrud`, `ExportButton`, `TemplateButton`, `ListCap`, `AlertsCard`, `InsightsCard` (screen-level compositions), and the dashboard chart classes (`mn-funnel`, `mn-donut`, `mn-gauge`, `mn-spark`, `mn-seg`), which are in `bundle.css` but have no card. `ConfirmProvider`, `useConfirm` and `Form` ship in the bundle and are demonstrated on the Dialog and Button cards.
- The archived PWA prototype under `prototype/` carries an older green identity and its own app icons; it is not part of this system.
