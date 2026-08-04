# RMC Plant SaaS — Deployment Runbook (Phase-1 Controlled Pilot)

**Status:** Runbook for the artifacts in this repo. **Nothing here has been executed.**
Companion to `DEPLOY-PLAN-01-phase1-pilot.md`. Do **not** run any step until the real
registered domain is confirmed and execution is approved.

**Scheme (5 hosts):** `app.<DOMAIN>` = web portal · `api.<DOMAIN>` = API ·
`admin.<DOMAIN>` = super-admin alias → web · apex + `www.<DOMAIN>` → 301 to `app.<DOMAIN>`.
`<DOMAIN>` is a **placeholder** everywhere (e.g. `mixnovas.com`).

## Artifacts this runbook uses
| File | Purpose |
|---|---|
| `apps/api/Dockerfile` | API image (multi-stage; runtime is dev-dep-free, runs compiled JS) |
| `apps/web/Dockerfile` | Web image (Next.js standalone; `NEXT_PUBLIC_API_URL` baked at build) |
| `docker/docker-compose.prod.yml` | Prod topology; only nginx is published |
| `docker/nginx/rmc.conf` | Reverse proxy + TLS (literal `<DOMAIN>` token to replace) |
| `.env.production.example` | Env sample — copy to `.env.production` and fill in |
| `apps/api` scripts | `migration:run:compiled`, `seed:prod:compiled` (no ts-node) |

---

## 0. Prerequisites (operator, on your infra — NOT done here)
- VPS (Ubuntu LTS) with Docker Engine + Compose plugin; firewall allows 22/80/443 only.
- DNS: apex `A` → VPS IP; `www`, `app`, `api`, `admin` `CNAME` → apex (see plan §3).
- The repo checked out on the VPS (or images built in CI and pulled).

## 1. Prepare env and domain
```bash
cp .env.production.example .env.production
# Replace EVERY __REPLACE__ with a CSPRNG secret (openssl rand -base64 36),
# and set DOMAIN + host URLs. Owner and app DB passwords MUST differ.
# Ensure: CORS_ORIGINS=https://app.<DOMAIN>,https://admin.<DOMAIN>
#    and: NEXT_PUBLIC_API_URL=https://api.<DOMAIN>

# Replace the placeholder token in the nginx template with your real domain:
sed -i 's/<DOMAIN>/mixnovas.com/g' docker/nginx/rmc.conf   # use your domain
```
Never commit `.env.production` (git-ignored). Only `*.example` files are tracked.

## 2. Issue TLS certificates (operator)
Use certbot on the host to obtain a cert covering the three names (webroot
`/var/www/certbot`, or DNS-01 for a wildcard). Point the nginx cert paths in
`rmc.conf` at the issued `fullchain.pem`/`privkey.pem`. Enable HSTS only after HTTPS
is confirmed working. *(TLS is not issued by this repo.)*

## 3. Build images
**Recommended — build OFF the pilot host (VM3 is 4 GB / no swap; an on-box `docker build`
can OOM the live stack).** Run the CI workflow `.github/workflows/build-images.yml`
(GitHub → Actions → “Build images” → Run, or push a `v*` tag). It builds both images and
pushes them to GHCR tagged by git SHA, baking `NEXT_PUBLIC_API_URL` for the web image.

Then on VM3, pull instead of build — set in `.env.production`:
```bash
IMAGE_TAG=<the-built-short-sha>          # e.g. 9463c1d (immutable; not 'latest')
IMAGE_REPO_API=ghcr.io/rchezhian81-prog/rmc-pro/rmc-api
IMAGE_REPO_WEB=ghcr.io/rchezhian81-prog/rmc-pro/rmc-web
```
```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <user> --password-stdin  # read:packages
docker compose --env-file .env.production -f docker/docker-compose.prod.yml pull
```
> Token creation + login + rotation are documented in `DEPLOY-GHCR-PULL-01-phase1-pilot.md`.
> `IMAGE_REPO_*` unset = the legacy on-VPS build path (fallback below). The web image
> bakes `NEXT_PUBLIC_API_URL` at build time — rebuild (re-run CI) to change it.

<details><summary>Fallback: build on the VPS (only if CI is unavailable)</summary>

```bash
export IMAGE_TAG=$(git rev-parse --short HEAD)
docker build -f apps/api/Dockerfile -t rmc-api:$IMAGE_TAG .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.<DOMAIN> -t rmc-web:$IMAGE_TAG .
```
</details>

## 4. Database migrate + production bootstrap (one-shot)
The `migrate` service applies migrations as the **owner** role, then runs the
idempotent `seed:prod` (catalogs/plans + one super admin from `SUPERADMIN_*`). It uses
compiled JS — no ts-node:
```bash
docker compose --env-file .env.production -f docker/docker-compose.prod.yml \
  up -d postgres
docker compose --env-file .env.production -f docker/docker-compose.prod.yml \
  run --rm migrate
```
Verify: 11 migrations present; `idx_users_tenant` + `idx_number_series_lookup` exist;
`rmc_app` is `rolsuper=false, rolbypassrls=false`; **no demo tenants**; the configured
super admin exists.

## 5. Bring up app + proxy
```bash
docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d
```
Order is enforced by `depends_on`: postgres(healthy) → migrate(completed) → api → web,
with nginx last. Reload nginx after TLS is in place.

## 6. Smoke tests (see plan §10 for the full list)
- `https://api.<DOMAIN>/health` → 200 `{status:"ok"}`.
- `https://app.<DOMAIN>` and `https://admin.<DOMAIN>` load over valid HTTPS; `http://…`
  redirects to HTTPS; apex + `https://www.<DOMAIN>` → 301 to `app.<DOMAIN>`.
- Postgres/Redis/MinIO NOT reachable from the public internet.
- CORS: a request with `Origin: https://app.<DOMAIN>` (or `admin.`) is allowed; a foreign origin is not.
- Super-admin login; create a pilot tenant + plan; tenant isolation spot-check.
- Order-to-cash happy path (quotation → … → receipt); offline plant-app sync; dashboards.

## 7. Rollback (see plan §11)
- App: redeploy the previous `IMAGE_TAG` (`docker compose ... up -d`).
- DB: restore the pre-deploy snapshot taken with
  `./scripts/backup/pg-backup.sh --label pre-migrate` — recover it via
  `./scripts/backup/pg-restore.sh --file <dump> --into rmc --confirm` (see
  `scripts/backup/README.md`). The index migration's `down` is safe (drops indexes only);
  prefer a snapshot restore when data may have changed.
- Keep the previous `rmc.conf`; `nginx -t` before every reload.

---

## Verification performed in-repo (no deployment)
- `docker compose --env-file .env.production.example -f docker/docker-compose.prod.yml
  config` resolves cleanly: `api` depends on `migrate`(completed) + `postgres`(healthy);
  `CORS_ORIGINS=https://app.<DOMAIN>,https://admin.<DOMAIN>`; web build arg
  `NEXT_PUBLIC_API_URL=https://api.<DOMAIN>`; only nginx publishes 80/443.
- The compiled one-shot commands were run locally against Postgres:
  `typeorm migration:run -d dist/core/database/data-source.js` → "No migrations are
  pending"; `node dist/core/database/seed-prod.js` → idempotent bootstrap. This is
  exactly what the `migrate` service runs (no ts-node in the image).
- Image builds could **not** be run in this environment (container registry egress is
  blocked — 403 pulling `node:22-alpine`). Build/validate the images in CI or on the VPS,
  where registry access is available.

> **Not done and out of scope until you approve execution and provide the real domain:**
> provisioning, DNS, TLS issuance, and any production `up`. No real secrets are committed.
