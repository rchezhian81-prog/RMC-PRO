# Ops — health monitoring

Two layers, because neither alone is enough:

## Layer 1 — External uptime check (do this too; it's the one that pages you when the box is down)

An on-box script **cannot** alert you when the box, Docker, or the network is
down — the alerter is down with it. So add a free external monitor that hits the
health endpoint from outside:

- **UptimeRobot** (free) or **Better Uptime** / **Healthchecks.io**.
- Monitor URL: `https://api.mixnovas.com/health` — expects HTTP 200 with `{"status":"ok"}`.
- Interval: 5 min. Alert to email + the provider's phone app (and optionally SMS).
- Add a second monitor for `https://app.mixnovas.com` so you catch the web portal too.

This needs an account but **no code** and no secrets on the box. It also catches
TLS-expiry and DNS problems end-to-end.

## Layer 2 — On-box monitor (internal detail the external check can't see)

`health-check.sh` inspects what's only visible from inside the box:

- every container's running/health state (`docker compose ps`)
- `https://api.<DOMAIN>/health` end-to-end (nginx + TLS + API)
- root filesystem usage (warns ≥ `DISK_WARN_PCT`, default 85%)
- TLS certificate days-to-expiry (warns < `CERT_WARN_DAYS`, default 14)

It logs every run and alerts **only on a state change** (healthy↔unhealthy), so
one incident = one ping, not one per minute. It's read-only.

### Install (every 5 min)

```bash
sudo ./scripts/ops/install-monitor-cron.sh
```

Writes `/etc/cron.d/rmc-monitor`, logs to `/var/log/rmc-monitor.log`, runs one
check immediately. Idempotent.

### Alerts (optional, no external account required if you already have a webhook)

Set a webhook in `.env.production` and the monitor POSTs `{"text":"…"}` to it on
each state change — works with Slack, Discord, a Telegram bot bridge, n8n, etc.:

```
RMC_ALERT_WEBHOOK=https://hooks.slack.com/services/…
```

With no webhook set, alerts still land in the log; the external monitor (Layer 1)
is what reaches your phone.

### Tuning

`DISK_WARN_PCT`, `CERT_WARN_DAYS`, and `DOMAIN` can be overridden via env or
`.env.production`. Run it by hand any time to see current status:

```bash
./scripts/ops/health-check.sh
```

---

# Ops — redeploy (quiet-window step)

`redeploy.sh` activates the pending **web-only auth fix** and the **nginx
envsubst cleanup**. The API/DB/Redis/MinIO are unchanged, so it only rebuilds
the web image and recreates web + nginx.

It is gated end-to-end: a pre-redeploy DB snapshot → a render-check of the nginx
template in a **throwaway** container (`nginx -t`) so a bad config can't reach
the live proxy → build web → recreate web then nginx → health-check api + app.
Recreating nginx is a few-seconds blip, so run it when traffic is low.

```bash
cd /opt/rmc
git pull --ff-only origin claude/rmc-plant-saas-requirements-6df8ur
./scripts/ops/redeploy.sh
```

If the health check fails it stops loudly with rollback guidance (previous image
still present; pre-redeploy snapshot taken in step 0). On 4 GB/no-swap, the only
memory-heavy step is the web build — if it OOMs, nothing running is affected;
retry or build the image in CI and pull it.

After it succeeds, confirm the auth fix by hand: sign in at `app.mixnovas.com`
(no demo creds prefilled), leave the tab idle ~20 min, and confirm you are **not**
kicked out — the session now refreshes silently.

---

# Ops — migration preflight (pre-deploy gate)

`migration-preflight.sh` is the guard that stops a bad migration from taking the
app down. A constraint-adding migration runs in the deploy's one-shot `migrate`
step, and `api` only starts once `migrate` **succeeds**. If a live row violates a
new CHECK/FK, the ALTER aborts, `migrate` exits non-zero, and the API never
comes back — an outage found only *after* the old app was torn down. (This is
exactly what happened: two customer rows with a negative `credit_limit` blocked
`chk_customers_nonneg`, and `app.mixnovas.com` returned 502 until the data was
fixed.)

Run it **before** `docker compose … up -d` on every deploy that ships a new
image, while the old app is still serving:

```bash
cd /opt/rmc
git pull --ff-only origin <deploy-branch>
./scripts/ops/migration-preflight.sh      # <-- gate: must pass before deploying
# only if it PASSES:
docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d
```

It's **read-only** — it just `SELECT`s the live data against the integrity
constraints the migrations will add (kept in one place in
`apps/api/src/core/database/integrity-constraints.ts`, in lock-step with the
constraint migrations). It runs in a throwaway container built from the new API
image, using the `migrate` service's own env (owner DB role, so it sees every
tenant's rows exactly as the migration's ALTER would).

Exit codes: `0` = safe to migrate · `1` = violations found (it prints the
offending rows — fix them, then re-run) · `2` = could not run (fail closed — do
not deploy). On a `1`, fix the data first, e.g.:

```bash
# example: the credit_limit case that caused the incident
docker compose --env-file .env.production -f docker/docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE customers SET credit_limit = 0 WHERE credit_limit < 0;"'
./scripts/ops/migration-preflight.sh      # re-run until it PASSES
```

When a future migration adds a new CHECK or FK, add it to
`integrity-constraints.ts` too — a unit test fails if the preflight and the
migration drift apart, so the gate can't silently miss a new constraint.

---

# Ops — SSH key-only hardening

`ssh-hardening.sh` disables SSH password login (key-only) and forbids root
password login — it stops password brute-force outright.

**Do the key setup first, from your own computer:**

```bash
ssh-keygen -t ed25519 -C "mixnova-admin"   # if you don't already have a key
ssh-copy-id root@65.20.69.69               # install your PUBLIC key on the box
ssh root@65.20.69.69                       # confirm key login works
```

**Then, on the VPS:**

```bash
sudo ./scripts/ops/ssh-hardening.sh            # dry run — shows what it will do
sudo ./scripts/ops/ssh-hardening.sh --confirm  # apply (your session stays open)
```

The script **refuses** to disable passwords unless a usable key is already
installed, validates with `sshd -t`, and only *reloads* sshd (never restarts) so
your current session survives. After applying, **test a new SSH session before
closing the current one**. Rollback:

```bash
sudo rm /etc/ssh/sshd_config.d/99-rmc-hardening.conf && sudo systemctl reload ssh
```

## Simpler alternative: fail2ban (server-only, no key needed)

Key-only SSH needs a key generated on *your* computer. If you'd rather not do
that, `install-fail2ban.sh` gets most of the security benefit with **zero
client-side steps** — it bans IPs that fail SSH login repeatedly, stopping
password brute-force. You keep logging in with your password.

```bash
sudo ./scripts/ops/install-fail2ban.sh
# optional: whitelist your home IP so a fat-fingered password can't ban you
IGNORE_IP="203.0.113.4" sudo -E ./scripts/ops/install-fail2ban.sh
```

Server-only, idempotent, reversible (`sudo systemctl disable --now fail2ban`).
Use this *or* key-only hardening — either closes the brute-force gap.

---

# Ops — live verification (read-only smoke test)

`verify-app.sh` checks the running system end to end and prints one pass/fail
report. Use it after a redeploy, before a pilot milestone, or any time you want
evidence of the live state to share.

**Read-only:** every request is a GET except the single POST to `/auth/login`
needed for a token. It creates nothing, changes nothing, and touches no
container or migration.

```bash
cd /opt/rmc
LOGIN='owner@example.com' bash scripts/ops/verify-app.sh
```

Use a **real** address — `bash scripts/setup/recover-login.sh` lists them. A
placeholder left in the command line is caught before any request is made,
because once it reaches the API it is indistinguishable from a wrong password:
both answer `AUTH_REQUIRED`, on purpose, so the sign-in form cannot be used to
discover which emails exist.

The password is asked for and not echoed. Set `RMC_PASSWORD` in the environment
instead for cron or CI.

Without `LOGIN` it still runs every unauthenticated check and marks the rest as
skipped, so it is safe to run with no credentials at hand.

## What it covers

| Section | Checks |
|---|---|
| Edge & TLS | app/api/admin hosts reachable, certificate expiry, http→https redirect |
| Web app | login page, app shell, admin portal, unknown route returns 404 |
| API | `/health`, and that protected routes reject missing/invalid tokens |
| Authenticated | login round-trip, dashboard, funnel, alerts, templates, outstanding, reports catalog, customers, **stock balances**, **roles & separation of duties**, **subscription & modules**, **plan limits**, **audit trail**, **error envelope**, AI state, RBAC permission catalogue |
| Containers | all services running/healthy, API errors in the last hour, disk usage |

### Stock balances

Matters most **after a reset**: the reset clears stock balances, and either the
seeder or the team's day-one entry puts them back. It **warns** on zero rows
("enter opening balances") — an empty table right after a reset is a task, not a
fault — **fails** on negative stock, warns when any material sits at zero, and
otherwise reports the count and the lowest material.

An absent low-stock *alert* proves nothing here — the alert rule joins
`stock_balances`, so no rows at all looks identical to full shelves. That is
exactly why this asserts on the rows themselves.

### Roles & separation of duties

Matters for **staff onboarding**: a role that exists but holds no permissions
silently locks its holders out of everything, and a role holding too many
quietly removes a control the business depends on. Neither is visible from the
outside, so this resolves every role to the permission keys it actually holds
and asserts the contents, not the names.

It fails when any of the twelve roles is missing, when an operational role is
empty, and when a separation of duty has broken — a sales executive able to
approve quotations or rate contracts, mix-design approval outside QC,
credit-hold release outside the plant manager, or users / roles / settings
reaching an operational role.

`platform.*` is checked against **every** role, not just the operational ones.
Those keys govern the SaaS platform — creating tenants, editing plans, granting
support access — so they belong to Mix Nova and to no customer. The role that
used to be handed all of them was the tenant's own Company Admin, which a
check scoped to operational roles walked straight past.

### Subscription & modules

Matters because the API now refuses any request whose module the tenant is not
entitled to, and blocks every user of a suspended company outright. This reads
`/auth/me` — the same entitlements the guard itself uses — and fails when the
tenant is suspended or cancelled, or when a core module (masters, sales, orders,
production, dispatch, inventory, billing, reports) is switched off.

It **warns** when every module in the catalogue comes back enabled. That is the
signature of a tenant with no `tenant_modules` rows at all: the guard passes
those through deliberately, so a provisioning gap never takes a live plant off
the air — but it also means nothing is being enforced. Fix it by assigning the
tenant a plan, or by re-running the production seed, which provisions any tenant
that has no rows and leaves configured ones untouched.

### Plan limits

How many seats and plants the subscription sells, against what is in use. Seats
count **active** users only, so deactivating someone who has left frees their
place rather than forcing an upgrade to replace them.

It **warns**, rather than failing, in two cases. No plan assigned means nothing
is capped — the same deliberate choice as modules, so a provisioning gap never
stops a plant hiring. Being over the cap is what a downgrade leaves behind: the
people already there keep working and only new additions are refused, because
silently disabling someone's login to fit a plan change is not a decision
software should make on its own.

### Audit trail

Confirms the trail is reachable and returns a list. The property that makes it
worth keeping — that the application role can insert and read entries but **not**
update or delete them — is a database grant, not something an API call can
observe, so it is asserted in the migration and proven in that change's tests
rather than here. Signed in as a role without `audit_logs.view` it warns rather
than fails, since that is a role-configuration matter, not a broken trail.

### Error envelope

Every refusal must carry `error.code`. Without it the web app cannot tell a role
problem from a subscription problem, and tells a plant operator to "ask your
administrator" about something only Mix Nova can change.

## Exit codes

`0` = all good (warnings allowed) · `1` = at least one check failed.
Suitable for a cron job or CI step.

## Environment

`DOMAIN` (default `mixnovas.com`), `LOGIN`, `RMC_PASSWORD`, `ENV_FILE`,
`COMPOSE_FILE`, `CERT_WARN_DAYS` (default 21).

The password is read from the environment only — never printed, never logged,
never written to disk. The access token is never displayed either.

---

# Ops — verify one user's role (read-only)

`verify-role.sh` signs in as a staff member and probes each guarded endpoint,
checking the API's answer against the permissions that user actually holds — a
200 where they have the permission, a 403 where they do not.

This is stronger evidence than clicking through the menu: the sidebar only shows
what the UI chose to draw, whereas this proves what the **server** would allow
if someone typed the URL directly.

```bash
cd /opt/rmc
read -rs RMC_PASSWORD; export RMC_PASSWORD          # run this line ALONE
LOGIN='operator@plant.com' bash scripts/ops/verify-role.sh

# optionally assert which role they should hold
LOGIN='operator@plant.com' EXPECT_ROLE=batching_operator bash scripts/ops/verify-role.sh
unset RMC_PASSWORD
```

**Read-only:** every probe is a GET, plus the one login POST. Nothing is created
or changed, so it is safe to run against production at any time.

## What it reports

- The role and permission count the login actually returns.
- `EXPECT_ROLE` mismatch, if you asserted one.
- A no-role warning — that user cannot use the app at all.
- Per endpoint: allowed where the permission is held, **403 where it is not**.
  A 200 on something the user lacks permission for is a failure, and so is a 403
  on something they do hold.
- The endpoints open to every signed-in user (dashboard, alerts, templates).

The company owner bypasses permission checks by design, so every probe allows
for that login; the script says so rather than pretending it proved anything.

Exit `0` when access matches the user's permissions exactly, `1` otherwise.

---

# Ops — TLS certificate renewal (containerized nginx)

The pilot cert (`mixnovas.com` + `www`/`app`/`api`/`admin`) is issued with
certbot's **standalone** authenticator, which binds port 80 itself to answer the
ACME challenge. In production that port belongs to the **nginx container**, so an
unaided `certbot renew` fails with *"port 80 in use"* and the cert lapses. The
host `certbot.timer` runs twice daily, but without help it would fail every time
a renewal is actually due.

`install-cert-renew-hooks.sh` fixes this by installing two renewal hooks:

- **pre-hook** — `docker compose … stop nginx` (frees port 80 for standalone)
- **post-hook** — `docker compose … start nginx` (loads the freshly-issued cert)

certbot runs these hooks **only when a certificate is actually due** for renewal
(within ~30 days of expiry), so nginx is untouched on the routine twice-daily
checks — a few seconds of downtime roughly every 60 days, not every run.

### Install

```bash
sudo ./scripts/ops/install-cert-renew-hooks.sh            # install (no downtime)
sudo ./scripts/ops/install-cert-renew-hooks.sh --verify   # install + dry-run test
```

Writes `/etc/letsencrypt/renewal-hooks/{pre,post}/10-rmc-*-nginx.sh`. Idempotent —
re-running overwrites the same two files and migrates any hand-installed
predecessors so nginx is never stopped/started twice per renewal. It does **not**
touch the certbot timer or the renewal config.

**Safety:** the script refuses to install unless a cert using the `standalone`
authenticator exists. If you ever switch the cert to a **webroot/nginx**
authenticator, these hooks would be wrong (webroot needs nginx *up* to serve the
challenge) — remove them: `rm -f /etc/letsencrypt/renewal-hooks/{pre,post}/10-rmc-*-nginx.sh`.

`--verify` runs `certbot renew --dry-run` against Let's Encrypt **staging**
(no rate-limit impact, real cert untouched); it briefly stops+starts nginx
(~10-15s HTTPS blip) to prove the whole path. A green dry-run — *"Congratulations,
all simulated renewals succeeded"* — means renewals are now hands-off.
