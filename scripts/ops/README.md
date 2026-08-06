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
read -rs RMC_PASSWORD; export RMC_PASSWORD    # run this line ALONE
LOGIN='owner@example.com' bash scripts/ops/verify-app.sh
unset RMC_PASSWORD
```

Without `LOGIN`/`RMC_PASSWORD` it still runs every unauthenticated check and
marks the rest as skipped, so it is safe to run with no credentials at hand.

## What it covers

| Section | Checks |
|---|---|
| Edge & TLS | app/api/admin hosts reachable, certificate expiry, http→https redirect |
| Web app | login page, app shell, admin portal, unknown route returns 404 |
| API | `/health`, and that protected routes reject missing/invalid tokens |
| Authenticated | login round-trip, dashboard, funnel, alerts, templates, outstanding, reports catalog, customers, **stock balances**, **roles & separation of duties**, AI state, RBAC permission catalogue |
| Containers | all services running/healthy, API errors in the last hour, disk usage |

### Stock balances

Matters most **after a reset**: the reset clears stock balances and the seeder
puts them back. It fails on zero rows ("opening stock has not been seeded"),
fails on negative stock, warns when any material sits at zero, and otherwise
reports the count and the lowest material.

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
credit-hold release outside the plant manager, or users / roles / settings /
`platform.*` reaching an operational role.

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
