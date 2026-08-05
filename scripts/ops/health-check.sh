#!/usr/bin/env bash
# =============================================================================
#  Mix Nova RMC — on-box health monitor  (internal, second layer)
# =============================================================================
#  Checks the things an EXTERNAL uptime monitor can't see from outside:
#    - each container's health/running state
#    - the public API health endpoint (end-to-end: nginx + TLS + API)
#    - root filesystem usage
#    - TLS certificate days-to-expiry
#  Logs every run, and — only on a state CHANGE (healthy<->unhealthy) — POSTs a
#  short message to an optional webhook, so you get one ping per incident, not
#  one per minute. Read-only: it never touches data or containers.
#
#  NOTE: a monitor ON the box cannot alert you when the box or its network is
#  down. Pair this with an EXTERNAL check (UptimeRobot/Better Uptime, free) that
#  hits https://api.mixnovas.com/health from outside — see scripts/ops/README.md.
#
#  USAGE:
#    ./scripts/ops/health-check.sh            # run once (logs + maybe alerts)
#    RMC_ALERT_WEBHOOK=https://… ./scripts/ops/health-check.sh
#
#  Config (env or .env.production):
#    RMC_ALERT_WEBHOOK   POST {text:"…"} here on state change (Slack/Discord/Telegram-bridge/n8n…)
#    DOMAIN              defaults to mixnovas.com
#    DISK_WARN_PCT       default 85
#    CERT_WARN_DAYS      default 14
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker/docker-compose.prod.yml}"
STATE_FILE="${STATE_FILE:-/var/lib/rmc/health.state}"

getenv() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
DOMAIN="${DOMAIN:-$(getenv DOMAIN)}"; DOMAIN="${DOMAIN:-mixnovas.com}"
RMC_ALERT_WEBHOOK="${RMC_ALERT_WEBHOOK:-$(getenv RMC_ALERT_WEBHOOK)}"
DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-14}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
problems=()
add() { problems+=("$1"); }

# ---- 1. Containers: any not running / unhealthy? ----
if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  # Lines like "api running healthy", "postgres running healthy", …
  while read -r name state health; do
    [ -z "$name" ] && continue
    if [ "$state" != "running" ]; then
      add "container $name is $state"
    elif [ "$health" = "unhealthy" ]; then
      add "container $name is unhealthy"
    fi
  done < <(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps \
             --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)
else
  add "docker or compose file unavailable"
fi

# ---- 2. Public API health endpoint (end-to-end) ----
if command -v curl >/dev/null 2>&1; then
  body="$(curl -fsS --max-time 12 "https://api.${DOMAIN}/health" 2>/dev/null || echo '')"
  case "$body" in
    *'"ok"'*|*'"status"'*) : ;;    # healthy
    *) add "https://api.${DOMAIN}/health did not return ok" ;;
  esac
fi

# ---- 3. Disk usage on / ----
disk_pct="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
if [ -n "${disk_pct:-}" ] && [ "$disk_pct" -ge "$DISK_WARN_PCT" ]; then
  add "root disk at ${disk_pct}% (>= ${DISK_WARN_PCT}%)"
fi

# ---- 4. TLS certificate expiry ----
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -r "$CERT" ] && command -v openssl >/dev/null 2>&1; then
  end="$(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null | cut -d= -f2)"
  if [ -n "$end" ]; then
    end_epoch="$(date -d "$end" +%s 2>/dev/null || echo 0)"
    now_epoch="$(date +%s)"
    days=$(( (end_epoch - now_epoch) / 86400 ))
    [ "$end_epoch" -gt 0 ] && [ "$days" -lt "$CERT_WARN_DAYS" ] && add "TLS cert expires in ${days}d"
  fi
fi

# ---- Verdict + state-change alerting ----
if [ "${#problems[@]}" -eq 0 ]; then
  status="healthy"; summary="all checks passed"
else
  status="unhealthy"; summary="$(printf '%s; ' "${problems[@]}")"
fi
echo "[$(ts)] $status — $summary"

mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
prev="$(cat "$STATE_FILE" 2>/dev/null || echo unknown)"
echo "$status" > "$STATE_FILE" 2>/dev/null || true

notify() {
  local msg="$1"
  [ -n "$RMC_ALERT_WEBHOOK" ] || return 0
  curl -fsS --max-time 12 -X POST "$RMC_ALERT_WEBHOOK" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"text":"Mix Nova RMC: %s"}' "$(echo "$msg" | sed 's/"/\\"/g')")" \
    >/dev/null 2>&1 || echo "[$(ts)] WARN: alert webhook POST failed"
}

if [ "$status" != "$prev" ]; then
  if [ "$status" = "unhealthy" ]; then
    notify "DOWN — $summary"
  elif [ "$prev" = "unhealthy" ]; then
    notify "RECOVERED — all checks passing again"
  fi
fi

[ "$status" = "healthy" ]
