# Owner visual approval checklist — live premium UI (V2 "Deep Violet Matte" + V3)

Sign-off checklist for the premium UI now live on the pilot. **Presentation review
only** — this documents *what to look at*, not a code or deploy step.

## How to run it

- Open **https://app.mixnovas.com** in an **incognito window** (or hard-refresh,
  `Ctrl+Shift+R`, to bust the browser cache).
- Widths: **Desktop ≥ 1280 · Tablet ~ 768 · Mobile ~ 390**. In Chrome, the device
  toolbar (`Ctrl+Shift+M`) gives you tablet/mobile widths.
- Check **light and dark** on at least **Dashboard** and **Login**.
- Live reference at time of writing: web image `rmc-web:282f1a5-uiv2`
  (V3 app + premium split-screen login), api `3467bc9`.

## Global pass criteria (apply to every screen)

- [ ] Deep-indigo violet **command rail** on the left (not the old flat grey/white sidebar)
- [ ] No clipped text / numbers; **no page-level horizontal scroll on mobile**
      (only tables scroll, inside their own container)
- [ ] **Dark mode readable** everywhere — no invisible or same-colour-on-same text
- [ ] Consistent premium feel — matte card depth, refined type, violet accents — across all screens

## Per-screen checklist

Tick each screen on all three widths (D = desktop, T = tablet, M = mobile).

| # | Screen | What "premium / approved" looks like | D | T | M |
|---|---|---|:--:|:--:|:--:|
| 1 | **Login** | Split-screen: violet brand hero + soft glow on left; clean "Welcome back" panel + gradient button on right; stacks (hero on top) on mobile | ☐ | ☐ | ☐ |
| 2 | **Dashboard** | Bold KPI numerals in 4 wider cards; refined violet icon chips; "Needs attention" + order-to-cash funnel cards | ☐ | ☐ | ☐ |
| 3 | **Sidebar / Topbar** | Grouped nav; active item = glowing pill + violet accent bar; topbar matte/blur with display-font title; mobile hamburger opens the violet rail | ☐ | ☐ | ☐ |
| 4 | **Plans / Tenants** (super-admin) | Premium form card + violet "Create" button + refined plans/tenants table | ☐ | ☐ | ☐ |
| 5 | **Company profile** | Card-framed form; refined inputs with violet focus; clean save action | ☐ | ☐ | ☐ |
| 6 | **Masters** (customers / materials / etc.) | New-record form + list table (tinted uppercase header, roomy rows, hover); Edit / Deactivate buttons | ☐ | ☐ | ☐ |
| 7 | **Quotation** | List + detail; line-items table; totals aligned (tabular ₹); PDF opens clean | ☐ | ☐ | ☐ |
| 8 | **Orders** | List with status badges (hairline pills) + detail; convert / confirm actions | ☐ | ☐ | ☐ |
| 9 | **Production** (mix designs / plans) | Forms + schedule/plan tables render premium | ☐ | ☐ | ☐ |
| 10 | **Batch queue / tickets** | Queue board + ticket detail; ticket PDF clean | ☐ | ☐ | ☐ |
| 11 | **Dispatch / challan** | Dispatch board + challan detail; challan PDF clean | ☐ | ☐ | ☐ |
| 12 | **Invoice** | List + detail; money columns aligned; invoice PDF clean *(plain GST math — e-invoice / IRN is out of scope)* | ☐ | ☐ | ☐ |
| 13 | **Receipt / Outstanding** | Receipt entry + allocation; outstanding aging table readable | ☐ | ☐ | ☐ |
| 14 | **Reports** | Reports center + one rendered report (numbers legible, tabular) | ☐ | ☐ | ☐ |
| 15 | **Audit trail** | Dense event table, tinted header, readable rows | ☐ | ☐ | ☐ |

**Sign-off = every row ticked on all three widths + the global criteria met.**

## What to capture (evidence)

- One screenshot per screen above × the 3 widths (~45; the 15 desktop shots are the core set).
- Dark-mode screenshots of **Dashboard** and **Login**.

## Blocker vs. can-wait (visual)

**BLOCKER (fix before sign-off):** a listed screen fails to load / 500s · login broken ·
unreadable UI on a **core** screen (invisible dark-mode text, clipped invoice/outstanding
figures) · mobile layout that breaks a **core** task (page-level side-scroll).

**Can wait (post-pilot polish):** spacing / colour / icon nits · cosmetic dark-mode
imperfections on **secondary** screens · empty / error / loading-state refinement ·
full pixel-baseline coverage for edge screens · login micro-details.
