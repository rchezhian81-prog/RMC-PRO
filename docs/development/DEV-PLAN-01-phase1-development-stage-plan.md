# RMC Plant SaaS Software
## Development Stage Plan — Phase 1

**Status:** Planning (no code yet — execution begins only after this plan is approved).
**Approved baseline:** Requirement SRS v1.4 (`bf0ef34`) · Design Stage complete & signed off (`27609ff`).
**Tech stack (locked, Design Doc 9 §26):** Next.js + NestJS + PostgreSQL + Redis + SQLite (plant app) + S3-compatible object storage + Docker/Nginx.

---

## 0. Development Guardrails

1. No development beyond this plan until it is approved.
2. **Build order is fixed:** multi-tenant foundation + authentication first, then everything else.
3. Every tenant table carries `tenant_id`; PostgreSQL **Row-Level Security** is enabled as defense-in-depth (Doc 11 §6.4).
4. Every module ships with its unit + integration + **tenant-isolation** tests before it is "done."
5. The existing prototype (`index.html`, `service-worker.js`, `manifest.json`, `icons/`) is **archived, not deleted** — moved to `/prototype/` as a UI reference.
6. Residual sign-off items are handled inline (Section 11), not deferred silently.

---

## 1. Repo / App Skeleton Plan

A **pnpm + Turborepo monorepo** holding three apps and shared packages.

- **apps/api** — NestJS (REST + WebSocket), TypeORM (or Prisma) migrations, background workers (BullMQ/Redis).
- **apps/web** — Next.js (App Router) tenant + super-admin web portal, i18n-ready.
- **apps/plant-app** — Electron desktop standalone plant app (local SQLite + sync engine). *(Packaging decision — see Section 7.)*
- **packages/shared** — TypeScript types, DTOs, enums, **permission keys**, error codes (single source shared by all apps).
- **packages/ui** — shared React components (web + plant-app reuse).
- **packages/config** — tsconfig / eslint / prettier presets.
- **docker/** — `docker-compose.yml` for Postgres + Redis + MinIO (S3) local stack.

Tooling: TypeScript strict, ESLint + Prettier, Husky pre-commit, Turborepo task graph, GitHub Actions CI (lint → typecheck → test → build), Playwright for E2E (Chromium is pre-installed in this environment).

---

## 2. Environment Setup Plan

- **Runtime:** Node LTS, package manager **pnpm**.
- **Local infra via Docker Compose:** PostgreSQL, Redis, MinIO (S3-compatible), Mailhog (email testing).
- **Env config:** `.env` per app; a committed `.env.example`; secrets never committed. Integration secrets (WhatsApp/Tally/payment) go through an encrypted field / secret manager (Doc 11 §12).
- **Environments:** `local` → `dev/staging` → `production`. Same Docker images; managed Postgres/Redis in cloud.
- **Config module (api):** validates all env vars at boot; fails fast if missing.
- **Seed script:** system roles, permission keys (from the RBAC addendum), default subscription plan, languages, one demo tenant for local dev.

---

## 3. Monorepo / Folder Structure

```text
rmc-pro/
├── apps/
│   ├── api/                      # NestJS backend
│   │   ├── src/
│   │   │   ├── common/           # response envelope, error codes, guards, interceptors (audit)
│   │   │   ├── core/             # config, database, redis, storage, logging, health
│   │   │   ├── tenancy/          # tenant-context middleware, RLS session setter
│   │   │   ├── auth/             # login/refresh/logout/reset, JWT, hashing
│   │   │   ├── rbac/             # roles, permissions, guards (permission/plant/module/subscription)
│   │   │   ├── platform/         # super-admin: tenants, plans, billing, coupons, support access
│   │   │   ├── tenant-setup/     # company, legal entities, plants, number series, settings
│   │   │   ├── masters/          # customers, sites, materials, grades, mix designs, vehicles, ...
│   │   │   ├── sales/            # leads, quotations, rate contracts
│   │   │   ├── orders/           # orders, order items, credit check, credit hold
│   │   │   ├── production/       # plans, batch queue, batch tickets, batching import
│   │   │   ├── dispatch/         # dispatches, board, delivery challans
│   │   │   ├── inventory/        # stock, inward, weighbridge, negative stock
│   │   │   ├── billing/          # invoices, items, e-inv/e-way fields, receipts, outstanding
│   │   │   ├── integrations/     # whatsapp, tally export, providers, logs
│   │   │   ├── sync/             # device register, bootstrap, push, pull, conflicts, reservations
│   │   │   ├── approvals/        # generic approval engine
│   │   │   ├── reports/          # reports + exports
│   │   │   ├── dashboards/       # role dashboards
│   │   │   ├── realtime/         # WebSocket gateway
│   │   │   └── workers/          # queues: whatsapp, pdf, export, sync, backup
│   │   └── db/                   # migrations, seeds, RLS policies
│   ├── web/                      # Next.js
│   │   └── src/{app,components,features,lib,i18n}
│   └── plant-app/                # Electron + SQLite + sync engine
├── packages/{shared,ui,config}/
├── docker/docker-compose.yml
├── prototype/                    # archived original PWA (reference)
├── docs/{requirements,design,development}/
├── package.json  pnpm-workspace.yaml  turbo.json
```

---

## 4. Database Migration Sequence

Ordered by dependency; each migration adds `tenant_id` + common columns (Doc 6 §2.3), tenant-scoped unique constraints, indexes, and RLS enablement. Tables per Doc 6 §21 + Doc 6.1.

| # | Migration group | Tables |
|---|-----------------|--------|
| M0 | Extensions & RLS base | `pgcrypto`/uuid, `app.current_tenant_id` GUC, RLS helper |
| M1 | Platform | tenants, subscription_plans, plan_modules, tenant_subscriptions, saas_invoices, saas_payments, coupons, tenant_coupon_usage, platform_users, integration_providers, languages |
| M2 | Tenant setup | companies, legal_entities, plants, number_series, tenant_settings |
| M3 | Users & RBAC | users, roles, permissions, role_permissions, user_roles, user_plant_access, support_access_logs |
| M4 | Masters | customers, customer_contacts, sites, materials, suppliers, uoms, hsn_tax_rates, transporters, banks, payment_modes, concrete_grades, mix_designs, mix_design_materials, vehicles, drivers |
| M5 | Pricing & Sales | rate_contracts, rate_contract_items, leads, quotations, quotation_items, quotation_revisions |
| M6 | Orders | orders, order_items, credit_hold_requests, order_status_history |
| M7 | Production & Dispatch | production_plans, production_plan_items, batch_queue, batch_tickets, batch_ticket_materials, batching_connector_configs, dispatches, delivery_challans, delivery_status_history |
| M8 | Inventory & Weighbridge | stock_balances, stock_transactions, material_inwards, weighbridge_entries, negative_stock_requests |
| M9 | Billing | invoices, invoice_items, invoice_challans, invoice_einvoice_fields, invoice_ewaybill_fields, payments, payment_allocations, customer_outstanding_snapshots |
| M10 | Integration & Notify | tenant_integrations, integration_logs, notification_templates, notification_logs, notification_rules, tally_export_batches, tally_export_items |
| M11 | Offline & Control | devices, sync_queue, sync_conflicts, local_number_reservations, approval_requests, approval_actions, audit_logs |
| M12 | RLS policies, indexes, seed | RLS policies on all tenant tables; composite indexes (Doc 6 §23); seed roles/permissions/plan/languages |

---

## 5. Backend Module Build Sequence (NestJS)

Cross-cutting **audit interceptor** is wired at B0 and the **approval engine** lands before B8 (credit hold needs it).

```text
B0  Core + common (config, db, redis, storage, health, response envelope, error codes, audit interceptor)
B1  Tenancy (tenant-context middleware, RLS session setter)
B2  Auth (JWT access/refresh, hashing, rate limit, /auth/me)
B3  RBAC (roles, permissions, guards: permission + plant + module + subscription)
B4  Platform / Super-Admin (tenants, plans, modules, subscriptions, saas billing, coupons, support access)
B5  Tenant setup (company, legal entities, plants, number series + reserve, settings)
B6  Users & roles (tenant side)
B7  Masters (all Doc 6 §7 + 6.1 masters)
B8  Approvals engine  →  Orders + credit check + credit hold
B9  Production (plans, batch queue, manual batch ticket, variance, CSV import)
B10 Dispatch (dispatches, board, delivery challans, number reservation)
B11 Inventory (stock, inward, transactions, weighbridge, negative stock)
B12 Billing (invoice-from-challans, invoice items [generic quantity + hsn_sac + cess], e-inv/e-way fields, receipts, allocations, outstanding)
B13 Integrations (WhatsApp foundation, Tally export, integration settings/logs)
B14 Offline sync (device register, bootstrap, push, pull, conflicts, reservations)
B15 Reports + Dashboards + Exports
B16 Realtime WebSocket gateway (dispatch/approvals/stock/sync events)
```

---

## 6. Frontend Module Build Sequence (Next.js)

```text
F0  App foundation (design tokens, app shell: top bar + sidebar per Doc 5 §2, i18n scaffold, API client, auth context, route guards)
F1  Auth screens (login, forgot, reset, profile, notification center)
F2  Super Admin portal (dashboard, tenants, plans/modules, saas billing, coupons, support access, audit)
F3  Tenant setup (setup dashboard, company, plants, users, roles, number series, GST/language/print settings, integrations)
F4  Masters screens
F5  Sales (leads, quotations, rate contracts)
F6  Orders + credit hold
F7  Production (plan, batch queue, manual batch ticket, variance)
F8  Dispatch board (kanban) + delivery challan
F9  Inventory + weighbridge + negative stock
F10 Billing (challan→invoice, invoices, receipts, outstanding) — Phase-3 widgets hidden (residual #2)
F11 Approvals center + notifications
F12 Reports center + role dashboards
```

Shared components go to `packages/ui` so the plant app reuses them.

---

## 7. Standalone Plant App Plan

**Recommended packaging: Electron desktop app (Windows-first)** + local **SQLite** + local sync engine.
Rationale: the plant office PC needs a **file-watcher** on the batching-controller export folder (Doc 10 §5.3, e.g. `C:/IDS/Export`), **local printing** (challan/batch ticket/weighbridge), and robust offline operation — all stronger in Electron than a browser PWA. React components are reused from `packages/ui`. *(This is the one new implementation decision; confirm before Sprint 10. Alternative: keep a PWA — simpler but weaker file/print/offline.)*

Components:
- Local SQLite schema = a subset of cloud tables that can be created/edited offline (Doc 8 §12.2).
- **Sync engine**: bootstrap → push → pull → conflict handling (Doc 8), calling the B14 sync APIs.
- **Reserved numbering** store (`local_number_reservations`) — no unreserved offline numbers (Doc 8 §14).
- **Offline screens** (Doc 5 §39–42): home/today, batch queue, manual batch entry, dispatch board, challan print, inventory, weighbridge, sync center, local backup.
- **Offline security**: device registration, cached-credential login with **3-day** expiry, encrypted local DB (Doc 11 §10).
- Built **after** backend sync APIs (B14) are live.

---

## 8. Phase 1 Sprint Plan

Two-week sprints. Exit criteria gate each sprint (green tests for that sprint's modules).

| Sprint | Goal | Modules | Exit criteria |
|--------|------|---------|---------------|
| **0** | Repo skeleton + infra | Monorepo, Docker (PG/Redis/MinIO), CI, base app boot, archive prototype | `pnpm dev` boots api (health 200) + web; `docker compose up` brings up PG/Redis/MinIO |
| **1** | **Multi-tenant foundation + auth** | M0–M3, tenancy middleware + RLS, Auth, RBAC guards, seed | Login works; `/auth/me` returns tenant+permissions; **cross-tenant query blocked by RLS** (isolation test passes) |
| **2** | Super Admin platform | B4 + F2, subscription/module foundation | Super admin can create/suspend a tenant, assign plan/modules; module-disabled → `MODULE_NOT_ENABLED` |
| **3** | Tenant setup + masters (1) | B5–B7 (partial) + F3–F4 | Tenant admin completes company/plant/user/role setup; number-series reserve works |
| **4** | Masters (2) + Sales | B7 complete, B8-sales + F5 | Quotation create→approve→PDF→convert; rate contract usable |
| **5** | Orders + credit control | B8 (approvals + orders + credit) + F6 | Order booking with **credit block at booking**; credit-hold approval flow + audit |
| **6** | Production & batching | B9 + F7 | Production plan → batch queue → manual batch ticket (variance vs tolerance) → inventory reduced |
| **7** | Dispatch & challan | B10 + F8 | Dispatch board status flow; delivery challan generate/print/share; reserved numbering |
| **8** | Inventory & weighbridge | B11 + F9 | Material inward → stock ledger; **negative stock only with approval**; weighbridge → inward |
| **9** | Billing + export + WhatsApp | B12–B13 + F10 | Invoice-from-challans (generic quantity, HSN/SAC, e-inv/e-way ready fields); receipt; outstanding; Tally export file; WhatsApp send + log |
| **10** | Offline plant app + reports | B14–B16 + F11–F12 + plant-app | Offline challan/batch entry + sync + conflict resolve; Phase-1 reports + dashboards |
| **11** | Hardening + UAT | Cross-cutting | Full tenant-isolation suite green; security tests; owner UAT on end-to-end flow |

---

## 9. Testing Checkpoint Plan

- **Unit tests** — services/business rules (credit check, tolerance, tax calc).
- **Integration tests** — API + real Postgres **with RLS on** (each module).
- **Tenant-isolation suite (gating CI check)** — the 6 mandatory cases from Doc 11 §21.2 (Tenant A cannot read/query/export/receive-events/sync Tenant B data). Must be green before any sprint is "done."
- **Authorization tests** — assert the RBAC addendum matrix (each role gets exactly its permissions; approvals restricted to defined approvers).
- **Contract tests** — API responses match `packages/shared` types.
- **E2E (Playwright)** — key flows: login, order-to-credit-hold, challan-to-invoice, offline-sync.
- **Security checks** — rate limiting, webhook signature, offline sync authorization, no-secrets-to-frontend.
- **UAT gates** — Sprint 5 (order+credit), Sprint 8 (order→dispatch), Sprint 9 (billing), Sprint 10 (offline).
- **Definition of Done (per module):** code + unit + integration + isolation tests green, permissions enforced, audit-logged, documented in shared types.

---

## 10. First Development Task Recommendation

**Sprint 0 → start of Sprint 1: repo skeleton + multi-tenant foundation + auth.** Two concrete tasks:

**Task 1 — Repo skeleton & local infra** *(Sprint 0)*
- pnpm + Turborepo monorepo; `apps/api` (NestJS boot + `/health`), `apps/web` (Next.js + login placeholder), `packages/shared`, `packages/config`.
- `docker/docker-compose.yml`: Postgres + Redis + MinIO; `.env.example`.
- CI (lint → typecheck → test → build); archive existing prototype to `/prototype/`.
- **Acceptance:** `docker compose up` brings the stack up; `pnpm dev` boots api (health 200) and web (login page renders); CI green.

**Task 2 — Multi-tenant foundation + authentication** *(Sprint 1)*
- Migrations **M0–M3**; `app.current_tenant_id` GUC + **RLS policies** on tenant tables.
- **Tenant-context middleware** (derive `tenant_id` from JWT; set RLS session var).
- **Auth**: login / refresh / logout / forgot / reset, bcrypt/argon2 hashing, login rate-limit, `/auth/me`.
- **RBAC guards** scaffold (permission + plant + module + subscription) + seed system roles/permissions (RBAC addendum) + one super-admin.
- **Acceptance:** a seeded tenant user logs in; `/auth/me` returns tenant + roles + permissions; **isolation test #3 passes** (Tenant A user querying Tenant B order by ID is blocked by RLS); a `MODULE_NOT_ENABLED` path is demonstrable.

---

## 11. Residual Sign-Off Items — Handling in Development

Carried from `DESIGN-STAGE-FINAL-SIGNOFF.md` §4:

1. **`quantity_m3` → `quantity`** — implement invoice items with generic `quantity` (+ `hsn_sac`, `cess`) in **Sprint 9 / B12**; concrete-specific fields keep `quantity_m3`.
2. **Phase-3 screens hidden in Phase 1** — CN/DN and full-ledger UI hidden/disabled in **F10** (Sprint 9).
3. **NFR scale/SLA numbers** — to be finalized before **production deployment planning** (not a Phase-1 build blocker).
4. **Phase-1 outstanding aging buckets** — confirm scope before **Sprint 9**; default to including basic aging (0–30/31–60/61–90/90+) unless deferred.
5. **RBAC matrix** — done (addendum `8d664f7`); drives Sprint 1 seed + authorization tests.

---

## 12. Next Step

This is a **plan only** — no code has been written. On approval, execution begins with **Task 1 (repo skeleton)**, then **Task 2 (multi-tenant foundation + auth)**.

Open decision to confirm: **plant-app packaging = Electron (recommended) vs PWA** (Section 7) — needed before Sprint 10, not before Sprint 0.
