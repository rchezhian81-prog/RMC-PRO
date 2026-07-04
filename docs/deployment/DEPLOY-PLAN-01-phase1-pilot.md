# RMC Plant SaaS — Deployment Stage Plan (Phase-1 Controlled Pilot)

**Status:** PLAN — awaiting approval. Nothing in this document has been executed.
**Baseline commit:** `8e7fbabb631af4c82d621b0443c086d14f605e70`
**Readiness verdict referenced:** GO for controlled pilot (`docs/development/PHASE1-DEPLOYMENT-READINESS.md`)
**Scope:** Deploy the Phase-1 order-to-cash platform to a single VPS for a controlled
pilot with a small number of real tenants. **No new features**; deferred integrations
(QC, GPS live tracking, live GSTN/e-invoice/e-way, direct Tally API, live payment
collection, customer portal) remain out of scope.

> **Approval gate:** This is the deployment *plan* only. Execution (provisioning,
> Docker/Nginx build, TLS, seed, tenant onboarding) begins **only after explicit
> approval**. See §14 Go/No-Go.

---

## 0. What we are deploying (from the codebase)

| Component | Detail |
|---|---|
| Web portal | Next.js 15 (`apps/web`), listens `:3000`. Reads **`NEXT_PUBLIC_API_URL`** — **baked at build time**. |
| API | NestJS 11 (`apps/api`), listens `:4000`. Global prefix `/api/v1`; health at **`/health`** (unprefixed). CORS currently open (`enableCors()`) — **must be restricted** (§4/§12). |
| Database | PostgreSQL 16. Two roles: owner **`rmc`** (superuser — migrations/seed only) and app **`rmc_app`** (non-superuser, RLS-subject — API runtime). `rmc_app` is created by the Init migration from `APP_DB_USER`/`APP_DB_PASSWORD`. |
| Cache/queue | Redis 7. |
| Object storage | S3-compatible (MinIO for pilot). |
| Plant app | Electron desktop app (`apps/plant-app`), offline sync over the API. **Distributed to plant PCs**, not server-hosted. |
| Migrations | 11, `1720000000000-Init` … `1720000010000-Indexes`. Run via `pnpm --filter @rmc/api migration:run` as the **owner** role. |
| CI gate | `pnpm test:e2e` (34/34) — Tenant Isolation, RBAC, UAT, Security. |
| Toolchain | Node ≥ 20 (plant-app sync engine uses Node 22 `--experimental-sqlite`), pnpm 10.33, Turborepo. |

Current infra assets in repo: `docker/docker-compose.yml` (dev infra: Postgres/Redis/
MinIO only). **No app Dockerfiles, no production compose, no Nginx config yet** — these
are execution deliverables (§6), authored after approval.

---

## 1. Pilot deployment architecture

Single-VPS, Docker-Compose topology (right-sized for a controlled pilot; horizontal
scale is a post-pilot concern):

```
                        Internet (HTTPS 443)
                               │
                     ┌─────────▼─────────┐
                     │   Nginx (host)    │  reverse proxy + TLS termination
                     │  app.<domain>     │──► web  container  :3000
                     │  api.<domain>     │──► api  container  :4000  (/health, /api/v1)
                     └─────────┬─────────┘
                               │ (internal docker network, not published)
        ┌──────────────┬───────┴────────┬─────────────────┐
        ▼              ▼                ▼                  ▼
   postgres:16    redis:7          minio (S3)         (api runs migrations
   rmc_pgdata     rmc_redisdata    rmc_miniodata       on deploy as owner role)
   volume         volume           volume
```

Principles:
- Only Nginx binds public ports (80/443). **Postgres/Redis/MinIO are NOT published to
  the host** in production — internal Docker network only (the dev compose publishes
  5432/6379/9000 for convenience; the prod compose will not).
- API runs as `rmc_app`; a **separate one-shot migration step** connects as `rmc`.
- Web is a **build-time artifact** keyed to `NEXT_PUBLIC_API_URL=https://api.<domain>`;
  a domain change requires a web rebuild.
- Browser calls the API cross-origin (`app.<domain>` → `api.<domain>`), so **CORS must
  allow exactly `https://app.<domain>`** and cookies/JWT handling must match.

Pilot deliberately runs **single-instance** each of web/api/db. No HA, no read replica
— acceptable for a pilot; flagged for scale-up.

---

## 2. VPS / server requirements

Single VPS (Ubuntu 22.04 LTS or 24.04 LTS):

| Resource | Pilot minimum | Recommended |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 80 GB SSD (DB + object storage + backups grow) |
| Network | Public IPv4, 443/80 open | + fail2ban / provider firewall |

Software: Docker Engine + Docker Compose plugin, Nginx (host) OR containerized Nginx,
certbot (Let's Encrypt), `ufw` firewall (allow 22/80/443 only), unattended-security-
updates. Node/pnpm needed only if building on the VPS; prefer **building images in CI
and pulling** (see §6).

Sizing note: Postgres is the memory-sensitive component. 4 GB is the floor for a handful
of pilot tenants with light concurrency; revisit with load testing before scale-up.

---

## 3. Domain / subdomain plan

Two subdomains under the pilot domain (placeholder `rmcpro.example.in` — to be
confirmed):

| Host | Points to | Purpose |
|---|---|---|
| `app.rmcpro.example.in` | Nginx → web:3000 | Tenant + super-admin web portal |
| `api.rmcpro.example.in` | Nginx → api:4000 | REST API (`/api/v1`, `/health`) |

- DNS: two `A` records → VPS public IP (or one `A` + one `CNAME`).
- Super-admin portal is served from the same web app under a route (no separate host in
  Phase 1).
- Reasoning for a dedicated `api.` host: the web client reads `NEXT_PUBLIC_API_URL`
  directly from the browser, so the API must be publicly reachable and CORS-scoped. A
  path-based split (`app.<domain>/api`) is an alternative that avoids cross-origin; if
  chosen, it changes CORS/build config. **Decision needed at execution:** subdomain
  (default, above) vs path-based. Default = subdomain.

---

## 4. Environment variable checklist

Source of truth: `.env.example`. Production `.env` is created on the VPS, **never
committed**, with **every secret replaced**. Checklist (✅ = must set a real value):

**PostgreSQL**
- ✅ `POSTGRES_HOST` (internal service name, e.g. `postgres`)
- `POSTGRES_PORT=5432`
- `POSTGRES_DB=rmc`
- ✅ `POSTGRES_USER` (owner role; migrations/seed only)
- ✅ `POSTGRES_PASSWORD` (strong, unique)
- ✅ `APP_DB_USER=rmc_app`
- ✅ `APP_DB_PASSWORD` (strong, unique — **different** from owner)

**Redis** — ✅ `REDIS_HOST`, `REDIS_PORT=6379` (add password/ACL for prod).

**Object storage (S3/MinIO)** — ✅ `S3_ENDPOINT`, ✅ `S3_ACCESS_KEY`, ✅ `S3_SECRET_KEY`,
`S3_BUCKET=rmc`, `S3_REGION`.

**API** — `API_PORT=4000`, ✅ `NODE_ENV=production`,
✅ `JWT_ACCESS_SECRET` (32+ random bytes), ✅ `JWT_REFRESH_SECRET` (distinct 32+ random),
`JWT_ACCESS_TTL=900`, `JWT_REFRESH_TTL=1209600`.

**Web (build-time)** — ✅ `NEXT_PUBLIC_API_URL=https://api.rmcpro.example.in` (must be
present at `pnpm build`, not just runtime).

**CORS (implemented — pre-go-live fix):**
- ✅ `CORS_ORIGINS=https://app.rmcpro.example.in,https://api.rmcpro.example.in`
  — comma-separated browser-origin allowlist. Open `enableCors()` has been replaced;
  unset = localhost-only (dev). The API is never opened to `*`.

**Production bootstrap (implemented — `pnpm seed:prod`):**
- `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` (strong, non-demo), optional
  `SUPERADMIN_NAME` — used once to create the platform super admin if absent.

Hard rules: no `change-me-*` values in production; secrets generated with a CSPRNG;
`.env` file perms `600`, owned by the deploy user; secrets stored in the provider's
secret manager / a vault, not in shell history.

---

## 5. Database backup and migration plan

**Migration (deploy-time):**
1. Bring up `postgres` only; wait for healthcheck.
2. Run migrations as **owner** role: `pnpm --filter @rmc/api migration:run`
   (idempotent; applies only new migrations — the Init migration also **creates the
   `rmc_app` role** from `APP_DB_USER`/`APP_DB_PASSWORD`).
3. Verify: `SELECT name FROM migrations ORDER BY timestamp;` → 11 rows through
   `Indexes1720000010000`; confirm `idx_users_tenant` and `idx_number_series_lookup`
   exist; confirm `rmc_app` is `rolsuper=false, rolbypassrls=false`.
4. Never run `synchronize`; schema changes only via new timestamped migrations.

**Backups:**
- Nightly `pg_dump` (custom format) to the VPS, then off-VPS (S3 bucket / provider
  snapshot). Retain 7 daily + 4 weekly for the pilot.
- Pre-deploy backup: **always `pg_dump` immediately before running new migrations** so
  rollback (§11) has a restore point.
- Object storage: enable MinIO bucket versioning; include the MinIO data volume in
  volume snapshots.
- Quarterly (at minimum, once during the pilot) **restore drill** into a scratch DB to
  prove backups are usable.
- Document RPO/RTO targets for the pilot: RPO ≤ 24 h (nightly) / ≤ deploy for migrations;
  RTO ≤ a few hours (single-VPS manual restore).

---

## 6. Docker / Nginx deployment plan

**Authored ✅ (repo artifacts — not yet executed).** Option A host scheme
(`app.`/`rmc.`/`pilot.`); step-by-step usage in `DEPLOY-RUNBOOK-01-phase1-pilot.md`.
1. ✅ `apps/api/Dockerfile` — multi-stage; runtime is dev-dep-free (`pnpm deploy --prod`)
   and runs compiled JS; non-root `node` user; `/health` healthcheck.
2. ✅ `apps/web/Dockerfile` — Next.js **standalone** build with `NEXT_PUBLIC_API_URL` as
   a build arg; runs `node apps/web/server.js` on `:3000`; non-root.
3. ✅ `docker/docker-compose.prod.yml` — `postgres`, `redis`, `minio`, one-shot
   `migrate` (owner role → migrations + `seed:prod`), `api`, `web`, `nginx`.
   **DB/Redis/MinIO NOT published**; only nginx exposes 80/443. Named volumes.
4. ✅ `docker/nginx/rmc.conf` — server blocks for `app.` (→web:3000), `rmc.` (→api:4000)
   and `pilot.` (301→app), TLS, HTTP→HTTPS redirect, security headers (HSTS,
   X-Content-Type-Options, X-Frame-Options, Referrer-Policy), `client_max_body_size`
   for PDF/CSV, proxy timeouts, WebSocket-upgrade map. Literal `<DOMAIN>` to replace.
5. Build strategy: **build images in CI**, push to a registry, `docker compose pull` +
   `up -d` on the VPS (keeps the VPS clean of build toolchain). Fallback: build on VPS.

Deploy sequence: `pull` → `migrate` (one-shot) → `up -d api web` → reload Nginx →
smoke tests (§10). Image builds must be validated in CI/on the VPS (registry egress is
blocked in the dev sandbox).

---

## 7. SSL / HTTPS plan

- **Let's Encrypt** via certbot for `app.` and `api.` (two names; or a wildcard
  `*.rmcpro.example.in` via DNS-01 if preferred).
- TLS terminates at Nginx. Redirect all `:80` → `:443`.
- Auto-renewal (certbot systemd timer / cron); post-renew Nginx reload hook.
- HSTS enabled after HTTPS is confirmed working end-to-end (not before, to avoid
  locking in a broken cert).
- Modern TLS only (TLS 1.2+; strong ciphers). Verify with an SSL test before go-live.
- API cookies/JWT served only over HTTPS.

---

## 8. Seed / admin setup plan

> ⚠️ **Critical:** the current `apps/api/src/core/database/seed.ts` **`TRUNCATE`s core
> tables and creates DEMO tenants (Alpha/Beta) + demo master data**. It is a
> development bootstrap and is **destructive** — it must **never** be run against a
> tenant-loaded production database.

1. ✅ **Production bootstrap (idempotent, non-destructive) — IMPLEMENTED as
   `pnpm seed:prod`** (`apps/api/src/core/database/seed-prod.ts`). Inserts **only** the
   platform-global data required to operate: module catalog, permission catalog, default
   subscription plans (+ module grants). No demo tenants, no demo master data, no
   `TRUNCATE`. Every step inserts only what is missing, so it is safe to run repeatedly.
2. ✅ **Super-admin credential** — `seed:prod` creates **one** super admin only when
   `SUPERADMIN_EMAIL` is set and that email does not already exist; the password comes
   from `SUPERADMIN_PASSWORD` and is **rejected if weak or a demo value** (≥12 chars,
   upper+lower+digit). Communicate it out-of-band; rotate on first login (nice-to-have).
3. **Never ship** `admin@alpha.test` / `admin@beta.test` / `super@platform.test` /
   `Passw0rd!` to production.
4. Verify post-bootstrap: super-admin can log in; permission/module/plan catalogs are
   present; **no demo tenants exist**.

(Real pilot tenants are created through the platform flow in §9, not the seed.)

---

## 9. Pilot tenant setup plan

Per pilot tenant, via the super-admin/platform portal (no code, no seed):
1. Create tenant + assign a subscription plan (enables the correct modules —
   `MODULE_NOT_ENABLED` enforcement is live).
2. Tenant admin user created; strong password out-of-band; verify login lands in the
   tenant (not cross-tenant).
3. Tenant self-setup (or assisted): company/GST details, plant(s), then masters —
   customers/sites, materials + opening stock, concrete grades, **approved mix
   design(s)**, vehicles/drivers, number series.
4. Confirm module access matches the plan; confirm tenant isolation by spot-check
   (tenant A cannot see tenant B data — mirrors the isolation suite).
5. Plant app: install the Electron app on plant PC(s), register the device against the
   tenant, reserve number ranges, verify an offline challan/batch syncs to cloud.

Start with **one** friendly tenant; expand only after that tenant clears smoke tests.

---

## 10. Smoke test checklist (post-deploy, before handing to pilot users)

Infra:
- [ ] `https://api.<domain>/health` → 200 `{status:"ok"}`.
- [ ] `https://app.<domain>` loads over valid HTTPS; HTTP redirects to HTTPS.
- [ ] Postgres/Redis/MinIO **not reachable** from the public internet.
- [ ] Migrations = 11 rows; hardening indexes present; `rmc_app` non-superuser.

Application (against a scratch/pilot tenant):
- [ ] Super-admin login; create tenant + plan; module enforcement works.
- [ ] Tenant admin login; isolation spot-check (no cross-tenant data).
- [ ] Order-to-cash happy path: quotation → PDF → order + credit → batch (stock
      reduces) → dispatch/challan → inward → invoice (GST) → receipt/outstanding.
- [ ] Offline plant-app challan syncs with a reserved number.
- [ ] Dashboards + reports populate.
- [ ] Security: login rate limit (429 after burst); `/users` & `/auth/me` leak no
      password hash; unauthenticated `/sync/*` → 401.

Optionally run `pnpm test:e2e` against a **dedicated scratch tenant/DB** (it trips the
login limiter and creates data — do not run against a live pilot tenant DB).

---

## 11. Rollback plan

Triggers: smoke tests fail, migration error, data-integrity or isolation regression,
sustained 5xx.

- **App rollback:** `docker compose` pin to the previous image tag and `up -d`
  (immutable image tags make this instant). Keep the last known-good tag.
- **DB rollback:** if a migration is at fault, restore the **pre-deploy `pg_dump`**
  (§5). Prefer restore over `migration:revert` when data may have changed; `revert`
  exists (`pnpm --filter @rmc/api migration:revert`) but the index migration's `down`
  is safe (drops indexes only). Schema+data rollback = restore snapshot.
- **DNS/TLS:** keep the previous Nginx config; `nginx -t` before reload; revert config
  and reload on failure.
- **Comms:** notify pilot tenant(s) of any rollback window; the pilot is small enough
  for direct contact.
- Every deploy records: image tags, migration list before/after, and the pre-deploy
  backup filename — so rollback is deterministic.

---

## 12. Monitoring / logging checklist

- [x] **CORS hardening** (pre-go-live, code) — ✅ **DONE**: open `enableCors()` replaced
      with an env allowlist (`CORS_ORIGINS`). Set it to the pilot web origin(s) at deploy.
- [ ] Container logs shipped/retained (`docker compose logs` + rotation; or a light
      log agent). API logs are structured Nest logs.
- [ ] Health monitoring: external uptime check on `api/health` and `app` root;
      alert on failure.
- [ ] Resource monitoring: CPU/RAM/disk on the VPS; alert at 80% disk (DB + backups).
- [ ] Postgres: connection count, slow-query log; watch the known benign
      `pg` "client already executing a query" deprecation warning and trace it out
      before scale-up.
- [ ] Error tracking (e.g. Sentry) for API + web — recommended for the pilot to catch
      real-tenant issues fast.
- [ ] Backup success alerting (fail loud if a nightly `pg_dump` fails).
- [ ] Rate-limit / auth-failure visibility (429/401 counts) to spot abuse.
- [ ] Audit trail: confirm sensitive actions are attributable (created_by/updated_by
      are captured); centralized audit logging is a scale-up enhancement.

---

## 13. Training checklist for pilot users

- [ ] Roles & login: super-admin vs tenant admin vs operational roles; password policy;
      how RBAC gates features.
- [ ] Master setup walkthrough: company/plant, customers/sites, materials + opening
      stock, grades, **mix designs + approval** (a grade needs an approved mix to
      batch), number series.
- [ ] Order-to-cash walkthrough: quotation → order + credit check → production/batching
      → dispatch/challan → inventory → invoice → receipt/outstanding.
- [ ] Plant app: install, device registration, number reservation, **offline capture**
      and sync-when-online; what to do on a sync conflict.
- [ ] Dashboards & reports: where to find operational and financial views; Tally
      **export** (file-based in Phase 1 — no direct Tally API).
- [ ] Scope expectations: what Phase 1 does **not** do yet (QC, GPS live tracking, live
      e-invoice/e-way, live payment collection, customer portal) so pilot feedback is
      framed correctly.
- [ ] Support path: how pilot users report issues and expected response during the
      pilot.
- [ ] Quick-reference guide + a recorded walkthrough for each persona.

---

## 14. Go / No-Go checklist

**Go requires ALL of:**
- [ ] Deployment plan approved (this document).
- [ ] VPS provisioned; firewall (22/80/443 only); Docker/Compose installed.
- [ ] DNS for `app.` and `api.` resolving to the VPS.
- [ ] Production `.env` complete — **no `change-me-*`/demo secrets**; distinct owner vs
      app DB passwords; JWT secrets random; `NEXT_PUBLIC_API_URL` set for the web build.
- [ ] Dockerfiles + prod compose + Nginx config authored and reviewed.
- [ ] CORS restricted to the web origin (code change merged).
- [ ] TLS valid for both hosts; HTTP→HTTPS redirect working.
- [ ] Migrations applied (11); indexes present; `rmc_app` non-superuser verified.
- [ ] Production bootstrap run (catalogs + super-admin only; **no demo tenants**).
- [ ] Backups configured; **pre-go-live backup taken**; one restore drill passed.
- [ ] Smoke tests (§10) all green.
- [ ] Monitoring/alerting + error tracking live.
- [ ] Rollback plan validated (previous image tag available; restore path tested).
- [ ] Pilot tenant(s) onboarded and trained; support path agreed.
- [ ] `pnpm test:e2e` green on the baseline commit.

**No-Go if any of:** open DB ports to the internet, demo/default secrets in prod, no
verified backup, failing isolation/security smoke tests, invalid TLS, or CORS still
open.

---

## 15. Proposed execution order (after approval)

Pre-go-live code fixes ✅ **DONE** (this change): env-based CORS allowlist
(`CORS_ORIGINS`) and idempotent production bootstrap (`pnpm seed:prod`).

1. Provision VPS + firewall + Docker.
2. Author Dockerfiles, prod compose, Nginx config. *(CORS allowlist + `seed:prod`
   already done.)*
3. DNS records; TLS issuance.
4. Bring up DB; pre-deploy backup; run migrations (owner role); verify.
5. Run production bootstrap `pnpm seed:prod` (super-admin + catalogs/plans).
6. Build/pull images (`CORS_ORIGINS` set to the web origin); `up -d` api + web;
   configure Nginx; enable HTTPS + HSTS.
7. Smoke tests (§10); wire monitoring/backups/alerts.
8. Onboard first pilot tenant; train; validate; expand.

> **Status.** The two pre-go-live safety fixes are now implemented: the env-based CORS
> allowlist (`CORS_ORIGINS`) and the idempotent, non-destructive production bootstrap
> (`pnpm seed:prod`). The remaining §6 execution artifacts (Dockerfiles, prod compose,
> Nginx config) and all provisioning/production changes are **not** started and are
> deferred until the final pilot domain is confirmed and execution is approved.
