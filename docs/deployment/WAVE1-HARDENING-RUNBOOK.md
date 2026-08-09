# Wave 1 Hardening — Owner Runbook

> The Wave 1 security/reliability work that can only be finished **on the box or
> in your infra**. The code side is already merged and CI-green; this runbook is
> the operator's half. Do the steps in order; each is independently safe and
> reversible. Nothing here changes until *you* run it.

Companion: `docs/audit/DEPENDENCY_AWARE_IMPLEMENTATION_ROADMAP.md` (Wave 1),
`docs/audit/SECURITY_PRIVACY_THREAT_MODEL.md`.

---

## 1. Cookie-based auth — flip the web to the httpOnly refresh cookie

**Already done (server side, backward-compatible, CI-verified):** the API now
issues the refresh token as an **httpOnly cookie** (`rmc_rt`, scoped to
`/api/v1/auth`) *and* still returns it in the body, and accepts a refresh from
the cookie **or** the body. So today nothing changes for the current web app —
this step is the deliberate flip that closes the localStorage-XSS exposure.

**Why it's staged:** the flip is the one thing that can't be verified without a
real browser + your production DNS (`app.` → `api.` is cross-site), and a
misconfigured cross-site cookie would log everyone out. So do it in **staging
first**.

### 1a. Server env (already defaulted for cross-site; confirm)
In `.env.production` the defaults already suit `app.<domain>` → `api.<domain>`:
```
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=none
# AUTH_COOKIE_DOMAIN=   (leave unset → host-only api.<domain> cookie)
```
CORS already sends `Access-Control-Allow-Credentials: true` with an explicit
origin allowlist (never `*`) — required for cross-site cookies.

### 1b. Web change (the flip)
In `apps/web/src/lib/session.ts` / `api.ts`:
1. On login, **stop storing `refreshToken`** in `localStorage` (keep only the
   access token + the non-secret fields). The cookie now holds the refresh token.
2. In `apiFetch` and the refresh call, send `credentials: 'include'` so the
   browser attaches the cookie to `api.<domain>` requests.
3. In `refreshAccessToken`, call `/auth/refresh` **with no body** (the cookie
   carries the token) and `credentials: 'include'`.
4. On sign-out, call `POST /auth/logout` (clears the cookie) in addition to
   clearing local state.

### 1c. Verify in staging, then production
- Log in, hard-refresh, confirm the session survives (silent refresh via cookie).
- In DevTools → Application → Cookies, confirm `rmc_rt` is `HttpOnly`, `Secure`,
  `SameSite=None`, and is **not** readable from `document.cookie`.
- Confirm a 15-min-idle tab still refreshes.
- **Rollback:** the server stays dual-mode, so reverting the web bundle restores
  the body-token path instantly — no server change needed.

> Access token: it stays a Bearer header (short-lived, 15 min). Moving it to
> memory-only is a later polish; the high-value win is the **refresh** token
> leaving localStorage, which this delivers.

---

## 2. Secrets at rest — sops + age (no new infrastructure)

Goal: stop keeping `.env.production` in plaintext on the box; encrypt it at rest,
decrypt only at deploy. `age` + `sops` is the cheapest path (no vault to run).

```bash
# 1. Install (Debian/Ubuntu)
sudo apt-get update && sudo apt-get install -y age
curl -Lo /usr/local/bin/sops https://github.com/getsops/sops/releases/latest/download/sops-linux-amd64 \
  && sudo chmod +x /usr/local/bin/sops

# 2. Generate an age key, kept ONLY on the box (and a copy in your password manager)
age-keygen -o ~/.config/sops/age/keys.txt      # prints a public key age1...
chmod 600 ~/.config/sops/age/keys.txt

# 3. Encrypt the live env into a committ=able, encrypted file
export SOPS_AGE_RECIPIENTS=age1...              # the public key from step 2
sops --encrypt --input-type dotenv --output-type dotenv .env.production > .env.production.sops
#    .env.production.sops is safe to keep in the repo/backup; .env.production is NOT.

# 4. At deploy, decrypt to the file the stack reads (add to redeploy.sh, step 0):
SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt \
  sops --decrypt --input-type dotenv --output-type dotenv .env.production.sops > .env.production
```

**Rotation:** re-`sops --encrypt` after any secret change; to rotate the age key,
decrypt with the old key and re-encrypt with the new recipient. Keep the age
private key **off** the repo and out of chat. (Postgres/MinIO at-rest disk
encryption is a separate, host-level step — enable LUKS on the data volume, or
use a managed DB per §3 which encrypts at rest by default.)

---

## 3. Staging + managed Postgres + PITR

The single 4 GB box has no staging and no point-in-time recovery. The default
direction is **managed cloud Postgres** (encrypts at rest, automated backups +
PITR, multi-AZ option) plus a small **staging** deploy of the same compose stack.

1. Provision a managed Postgres (e.g. a small instance) with **PITR / automated
   backups** enabled; note the connection string.
2. Point a **staging** `.env` at it (`POSTGRES_*`), deploy the same
   `docker-compose.prod.yml` on a cheap second host or the same box with a
   `staging` compose project name and separate subdomains.
3. Run migrations + `seed:prod` against staging; smoke-test (including the §1
   cookie flip) here before every production deploy.
4. Once staging is trusted, migrate production's DB to the managed instance
   during a maintenance window (backup → restore into managed → repoint
   `POSTGRES_*` → redeploy). Keep the on-box GFS backups + Backblaze B2 off-box
   copy (Wave 0) as belt-and-braces.
5. Quantify and publish **RPO/RTO** (see the restore-runbook) once PITR is on —
   RPO drops from ≤24 h (daily dumps) to minutes (WAL/PITR).

---

## 4. Observability backend

The API already emits **one structured JSON line per request** tagged with
`tenantId`/`userId`/latency/status (Wave 1, `REQUEST_LOG`). To turn that into
real observability:

1. **Logs:** ship container stdout to an aggregator. Default (SaaS, low ops):
   a hosted log service; self-hosted alternative: Grafana **Loki** + Promtail.
   The JSON is already parseable — index on `tenantId`, `status`, `path`.
2. **Error tracking:** add a SaaS error tracker (e.g. Sentry-class) to the API
   and web for exceptions with stack traces and release tagging.
3. **Metrics/traces (later):** add OpenTelemetry (OTLP exporter) to the API and
   tag spans with `tenantId`/`plant_id`; point it at the same backend. Gate it on
   `OTEL_EXPORTER_OTLP_ENDPOINT` so it's a no-op until configured.
4. **External uptime:** keep the recommended UptimeRobot/Better-Uptime check on
   `api.<domain>/health` and `app.<domain>/` — an on-box monitor can't tell you
   the box is down.

Pick SaaS to start (fastest to value); revisit self-hosting if per-seat cost
grows. None of this changes application behavior — it's additive wiring.

---

## Done-when

- [ ] §1 cookie flip verified in staging, then production; `rmc_rt` is HttpOnly/Secure/SameSite=None; sessions survive refresh.
- [ ] §2 `.env.production` no longer plaintext; decrypt-on-deploy wired; age key backed up off-box.
- [ ] §3 managed Postgres w/ PITR live; staging mirrors prod; RPO/RTO published.
- [ ] §4 logs shipped + error tracking live + external uptime configured.

Each closes a top-5 audit risk (token/secret compromise, host loss, undetected
incident) without touching the strong RLS/data core.
