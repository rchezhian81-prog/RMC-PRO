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
