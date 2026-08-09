# Observability & Infra Runbook

> What the API now emits for operations, how to ship it somewhere useful, and
> the infra items that need an owner decision (they can't be done from CI).
> Companion: `WAVE1-HARDENING-RUNBOOK.md`, `restore-runbook.md`.

## 1. What the code gives you now (no action needed)

**Structured request log.** One JSON line per request on stdout, emitted by
`RequestContextMiddleware` when the response finishes — so it covers *every*
outcome, including guard rejections (401/403) and throttles (429) that never
reach a controller:

```json
{"t":"2026-08-09T10:21:29Z","level":"info","msg":"request","method":"GET",
 "path":"/api/v1/users","status":200,"durationMs":3,"tenantId":"…","userId":"…",
 "userType":"tenant_user","requestId":"…","errorCode":"…"}
```

- `level` is `error` for 5xx, `warn` for 4xx, `info` otherwise — grep by level.
- `tenantId` on every line is what makes per-tenant latency and noisy-neighbour
  problems visible. Bodies are never logged, so no secrets/PII leak in.
- Turn the log off (not the id) with `REQUEST_LOG=off`.

**Correlation id.** Every response carries an `X-Request-Id` header. A user
reporting an error can quote it; it also appears in the error envelope
(`error.requestId`) and in the 5xx stack log, so one id ties the caller's
response, the request log line, and the exception together.

**Liveness vs readiness.**
- `GET /health` — liveness. No dependencies; returns 200 while the process is up.
- `GET /health/ready` — readiness. Runs `SELECT 1`; returns **200** when the DB
  is reachable, **503** (`code: NOT_READY`) when it is not.

Both are unprefixed (not under `/api/v1`).

## 2. Ship the logs somewhere (owner action)

The logs are already JSON on stdout, so this is wiring, not code.

**Option A — Grafana Loki + promtail (self-hosted, cheap).** Point promtail at
the container's stdout (Docker `json-file` driver) and parse the line as JSON so
`tenantId`, `status`, `level`, `requestId` become queryable labels/fields.
Example scrape: relabel `status` and `level`; keep `requestId`/`tenantId` as
structured metadata (do not make high-cardinality ids into labels).

**Option B — a hosted service** (Better Stack, Datadog, Axiom, …). Use the
platform's Docker log driver or a lightweight agent; the JSON is parsed on
ingest with no code change.

**Retention.** Decide a window (e.g. 30–90 days hot). Request logs are metadata
only — the *audit trail* (in Postgres `audit_logs`) is the long-lived
compliance record, not these lines.

## 3. Propagate the request id from nginx (owner action)

So an API log line ties back to the edge access log, forward nginx's own
`$request_id`:

```nginx
# in the location / block that proxies to the API
proxy_set_header X-Request-Id $request_id;
# and log it at the edge too:
log_format main '... rid=$request_id ...';
```

The API honours a **safe** inbound id (`[A-Za-z0-9._-]`, ≤128 chars) and echoes
it back; anything else is replaced with a fresh uuid (no header/log injection).
If nginx does not send one, the API generates it — nothing breaks either way.

## 4. Wire the readiness probe (owner action)

Use `/health/ready` (not `/health`) wherever "should this instance get traffic?"
is decided, and `/health` for "is the process alive?":

- **nginx upstream** / load balancer health check → `/health/ready`.
- **systemd / Docker healthcheck** → `/health` for restart-on-crash;
  `/health/ready` for a deploy gate (wait for 200 before flipping traffic).
- **Kubernetes** (if/when) → `livenessProbe: /health`, `readinessProbe:
  /health/ready`.

A DB blip then pauses traffic to the instance instead of serving a wall of 500s,
without the orchestrator killing an otherwise-healthy process.

## 5. Infra items still needing an owner decision

These are the pieces the audit flagged that a sandbox/CI cannot provision:

| Item | Why | First step |
|---|---|---|
| **Managed Postgres + PITR** | Self-hosted PG on the VPS has no point-in-time recovery; a bad migration or `DELETE` is unrecoverable between nightly dumps. | Move to a managed instance (or enable WAL archiving + a base backup) and confirm a **test restore** to a timestamp. See `restore-runbook.md`. |
| **Staging environment** | The RLS-on-users change and any auth-touching work must be smoke-tested against a prod-like DB before production. | Stand up one small staging stack (same compose, separate DB) and point a staging domain at it. |
| **Secrets management** | JWT/DB/B2 secrets currently live in env files. | Adopt `sops` + `age` (or the host's secret store); keep the encrypted file in the repo, decrypt at deploy. Covered in `WAVE1-HARDENING-RUNBOOK.md`. |
| **Log/metrics backend** | §2 above — logs are ready to ship but no aggregator is running yet. | Pick Option A or B and wire it. |
| **Error alerting** | Built in — see §6. Set `ALERT_WEBHOOK_URL` to page on 5xx, or add a log-based rule on `level=alert`. | Paste an incoming-webhook URL into `ALERT_WEBHOOK_URL`. |
| **Uptime check** | Nothing watches the box from outside. | Point an external monitor at `/health/ready`. |

## 6. Error alerting (built-in)

The API raises an **ops alert on every 5xx** (`ErrorFilter` → `ErrorAlertService`).
It is on by default in log form and needs no external service:

- **Always** emits a structured `{"level":"alert","msg":"error_alert",…}` line
  carrying the status, method, id-normalised path, `requestId`, tenant/user, and
  a **redacted** error message. A log-based rule on `level=alert` (or
  `msg=error_alert`) pages with zero further wiring.
- **When `ALERT_WEBHOOK_URL` is set**, it also POSTs a generic JSON body to that
  URL — a Slack/Discord/incoming-webhook renders it (`text`/`content`), and a
  custom relay can read the structured fields. For PagerDuty, point the webhook
  at a Events-API relay or an email-integration address.

**Noise control** (a broken deploy pages once, not thousands of times):

- only status ≥ `ALERT_MIN_STATUS` (default **500**);
- the same error signature (`status:name:method:path`, ids collapsed) is sent at
  most once per `ALERT_DEDUP_WINDOW_MS` (default **5 min**), and the next alert
  reports how many it suppressed;
- a circuit breaker caps total alerts to `ALERT_MAX_PER_WINDOW` (default **60**)
  per window;
- delivery is bounded by `ALERT_TIMEOUT_MS` (default **3 s**) and is fully
  best-effort — a failed or slow webhook never affects the request.

**Config summary**

| Env | Default | Meaning |
|---|---|---|
| `ALERT_WEBHOOK_URL` | *(unset)* | POST target for push alerts; log-only when unset |
| `ALERT_MIN_STATUS` | `500` | Minimum HTTP status that alerts |
| `ALERT_DEDUP_WINDOW_MS` | `300000` | Per-signature cooldown |
| `ALERT_MAX_PER_WINDOW` | `60` | Circuit-breaker cap per window |
| `ALERT_TIMEOUT_MS` | `3000` | Webhook delivery timeout |

## 7. Metrics (`/metrics`, Prometheus)

The API exposes **`GET /metrics`** in Prometheus text format (unprefixed, like
`/health`) — the third leg alongside logs (§1) and alerts (§6):

- `http_requests_total{method,route,status}` — request rate + error rate.
- `http_request_duration_seconds{method,route}` — latency histogram.
- `process_resident_memory_bytes`, `nodejs_heap_used_bytes`,
  `process_uptime_seconds`, `rmc_build_info`.

The `route` label is the **normalised** path (ids collapsed to `:id`) and the
number of distinct routes is capped (overflow folds into `route="other"`), so
cardinality stays bounded. The scrape endpoint does not count itself.

**Protect it.** `/metrics` leaks operational shape (rates, errors, memory), so on
an internet-facing API either:

- set **`METRICS_TOKEN`** — the endpoint then requires
  `Authorization: Bearer <token>` (Prometheus supports this natively), **or**
- restrict `/metrics` at nginx to the scraper's source (e.g. `allow 10.0.0.0/8;
  deny all;`) and scrape over the private network.

**Prometheus scrape config**

```yaml
scrape_configs:
  - job_name: rmc-api
    metrics_path: /metrics
    authorization:
      credentials: '<METRICS_TOKEN>'   # omit if restricting at nginx instead
    static_configs:
      - targets: ['api.internal:4000']
```

`APP_VERSION` (if set) is surfaced as the `version` label on `rmc_build_info`.

## 8. Remaining infra

None of the remaining infra items block the current release; they are the next
rung of operability once the app-level hardening (Waves 0–2 + RLS) is deployed.
